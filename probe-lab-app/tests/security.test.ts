import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';
// fast-jwt is @fastify/jwt's own engine, so tokens signed here are exactly
// the shape the app verifies — no second JWT implementation to disagree.
import { createSigner } from 'fast-jwt';

import { buildApplication } from '../api/src/app.js';

const appRoot = path.resolve(import.meta.dirname, '..');

/*
 * Executable security regression suite — the access-control and authentication
 * boundaries this app claims to enforce, each tried the way an attacker would,
 * against a real running application instance.
 *
 * This is the layer no scanner writes: a scanner cannot know that a viewer must
 * not upload, or that qa must not manage sample wafers. Route these cases from
 * /yw:forge-security-tests; the scanners (npm run security:*) cover what CAN be
 * automated generically. OWASP 2025 categories are named per test so coverage
 * is reportable: A01 Broken Access Control, A07 Authentication Failures.
 */

function createTestDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'yw-security-'));
  const databasePath = path.join(directory, 'test.db');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.exec(readFileSync(path.join(appRoot, 'database', 'schema.sql'), 'utf8'));
  const insert = database.prepare(
    'INSERT INTO app_user (user_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
  );
  for (const role of ['viewer', 'dev', 'qa', 'admin'] as const) {
    insert.run(`user-${role}`, role, 'unused', role);
  }
  /* Reference data, so an upload can resolve its device and program. */
  database
    .prepare('INSERT INTO facility (facility_id, code, name) VALUES (?, ?, ?)')
    .run('facility', 'PROBE-FAB-1', 'Test facility');
  database
    .prepare(
      'INSERT INTO work_center (work_center_id, facility_id, code, name, stage) VALUES (?, ?, ?, ?, ?)',
    )
    .run('work-center', 'facility', 'PROBE-WC-SORT', 'Test sort', 'wafer-sort');
  database
    .prepare('INSERT INTO device (device_id, work_center_id, code, name) VALUES (?, ?, ?, ?)')
    .run('device', 'work-center', 'PROBE-DEV-1', 'Test device');
  database
    .prepare(
      'INSERT INTO test_program (test_program_id, device_id, code, name) VALUES (?, ?, ?, ?)',
    )
    .run('program', 'device', 'PROBE-PGM-1', 'Test program');
  database.close();
  return { directory, databasePath };
}

const SECRET = 'security-test-secret';

async function buildApp(context: { after: (fn: () => Promise<void> | void) => void }) {
  const fixture = createTestDatabase();
  const app = await buildApplication({
    authSecret: SECRET,
    tokenTtlSeconds: 60,
    databasePath: fixture.databasePath,
  });
  context.after(async () => {
    await app.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });
  await app.ready();
  const tokenFor = (role: 'viewer' | 'dev' | 'qa' | 'admin') =>
    app.jwt.sign({ sub: `user-${role}`, username: role, role });
  return { app, tokenFor };
}

test('A01 — every write surface refuses the roles below its bar', async (context) => {
  const { app, tokenFor } = await buildApp(context);

  /* Surface × minimum role, asserted as a table so a NEW write route added
     without a row here is a review question, not a silent hole. */
  const surfaces: Array<{ method: 'POST' | 'DELETE'; url: string; deniedRoles: string[] }> = [
    { method: 'POST', url: '/api/uploads?device=X&program=Y', deniedRoles: ['viewer'] },
    { method: 'DELETE', url: '/api/uploads/some-id', deniedRoles: ['viewer'] },
    { method: 'POST', url: '/api/sample-data', deniedRoles: ['viewer', 'dev', 'qa'] },
    { method: 'DELETE', url: '/api/sample-data', deniedRoles: ['viewer', 'dev', 'qa'] },
  ];

  for (const surface of surfaces) {
    for (const role of surface.deniedRoles) {
      const response = await app.inject({
        method: surface.method,
        url: surface.url,
        headers: { authorization: `Bearer ${tokenFor(role as 'viewer')}` },
      });
      assert.equal(
        response.statusCode,
        403,
        `${role} must get 403 on ${surface.method} ${surface.url}, got ${response.statusCode}`,
      );
    }
  }
});

test('A01 — nobody can record an assessment result for someone else', async (context) => {
  const { app, tokenFor } = await buildApp(context);
  /* The API derives the owner from the token, full stop — there is no
     parameter to name another user. Record as dev, then confirm admin's own
     view carries no result: the write landed on dev, not on anyone else. */
  await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-01/result',
    headers: { authorization: `Bearer ${tokenFor('dev')}` },
    payload: { outcome: 'passed' },
  });
  const adminView = await app.inject({
    method: 'GET',
    url: '/api/assessments',
    headers: { authorization: `Bearer ${tokenFor('admin')}` },
  });
  assert.equal(adminView.json().summary.passed, 0, 'the result must not leak across users');
});

test('A07 — a missing, malformed, or expired token fails closed with 401', async (context) => {
  const { app, tokenFor } = await buildApp(context);
  const url = '/api/wafers';

  const missing = await app.inject({ method: 'GET', url });
  assert.equal(missing.statusCode, 401);

  const malformed = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer not-a-token' },
  });
  assert.equal(malformed.statusCode, 401);

  /* Signed with the right secret but already expired. */
  const expired = createSigner({ key: SECRET, expiresIn: -1000 })({
    sub: 'user-qa',
    username: 'qa',
    role: 'qa',
  });
  const expiredResponse = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${expired}` },
  });
  assert.equal(expiredResponse.statusCode, 401, 'an expired token must be refused');

  /* Correct shape, wrong signing key — a forged token. */
  const forged = createSigner({ key: 'wrong-secret' })({
    sub: 'user-admin',
    username: 'admin',
    role: 'admin',
  });
  const forgedResponse = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${forged}` },
  });
  assert.equal(forgedResponse.statusCode, 401, 'a token signed with another key must be refused');

  /* And a valid token still works, so the failures above are not blanket 401s. */
  const valid = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${tokenFor('viewer')}` },
  });
  assert.equal(valid.statusCode, 200);
});

test('A07 — a token carrying an unknown role is refused, not ranked', async (context) => {
  const { app } = await buildApp(context);
  /* Signed correctly, but the role does not exist. requireRole derives its
     rank table from the role list, so an unknown role must fall out as 401
     rather than land on some default rank. */
  const alien = createSigner({ key: SECRET })({
    sub: 'user-admin',
    username: 'admin',
    role: 'superadmin',
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/wafers',
    headers: { authorization: `Bearer ${alien}` },
  });
  assert.equal(response.statusCode, 401);
});

test('A07 — sign-in refuses a wrong password and an unknown user identically', async (context) => {
  const { app } = await buildApp(context);
  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'incorrect' },
  });
  const unknownUser = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'nobody', password: 'incorrect' },
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(unknownUser.statusCode, 401);
  /* Identical bodies, so the response does not reveal which half was wrong —
     an account-enumeration guard. */
  assert.deepEqual(wrongPassword.json(), unknownUser.json());
});

test('A01 — the sample-data remover cannot be aimed at ordinary uploads', async (context) => {
  const { app, tokenFor } = await buildApp(context);
  /* The DELETE endpoint's scope is rows the sample loader created. An admin
     "remove all" with a normal upload present must not touch it. */
  const admin = { authorization: `Bearer ${tokenFor('admin')}` };
  const upload = await app.inject({
    method: 'POST',
    url: '/api/uploads?device=PROBE-DEV-1&program=PROBE-PGM-1',
    headers: { ...admin, 'content-type': 'text/csv' },
    payload: 'Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-SEC-01,1,0,0,1,1,P\n',
  });
  assert.equal(upload.statusCode, 202, `upload failed: ${upload.body}`);

  /* The upload is queued; wait until the wafer lands before wiping. */
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const wafers = await app.inject({ method: 'GET', url: '/api/wafers', headers: admin });
    if (wafers.json().total === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const wipe = await app.inject({ method: 'DELETE', url: '/api/sample-data', headers: admin });
  assert.equal(wipe.statusCode, 200);

  const wafers = await app.inject({ method: 'GET', url: '/api/wafers', headers: admin });
  assert.equal(wafers.json().total, 1, 'the ordinary upload must survive a sample-data wipe');
});
