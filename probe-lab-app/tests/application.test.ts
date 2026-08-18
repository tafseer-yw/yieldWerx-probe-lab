import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { buildApplication } from '../api/src/app.js';
import { loadApplicationConfig, resolveDatabasePath } from '../api/src/config.js';
import { sampleWafers } from '../api/src/sample-data.js';
import { matchWaferSignature } from '../api/src/signature-match.js';
import { SqliteApplicationStore, type SaveUploadInput } from '../api/src/store.js';
import { parseWaferCsv } from '../api/src/wafer-csv.js';

const appRoot = path.resolve(import.meta.dirname, '..');

function createTestDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'yw-probe-lab-'));
  const databasePath = path.join(directory, 'test.db');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.exec(readFileSync(path.join(appRoot, 'database', 'schema.sql'), 'utf8'));
  database
    .prepare('INSERT INTO app_user (user_id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('test-user', 'engineer', 'unused', 'engineer');
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

function uploadInput(csv: string, fileName: string): SaveUploadInput {
  const sourceData = Buffer.from(csv, 'utf8');
  return {
    sourceType: 'file',
    fileName,
    contentType: 'text/csv',
    sourceData,
    sourceSha256: createHash('sha256').update(sourceData).digest('hex'),
    deviceCode: 'PROBE-DEV-1',
    testProgramCode: 'PROBE-PGM-1',
    submittedByUserId: 'test-user',
    parsed: parseWaferCsv(sourceData),
    isSample: true,
  };
}

test('CSV integers outside JavaScript safe range are rejected instead of rounded', () => {
  const parsed = parseWaferCsv(
    'Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-SAFE,1,9007199254740993,0,1,1,P',
  );
  assert.equal(parsed.kind, 'rejected');
  assert.equal(parsed.errors[0]?.code, 'OUT_OF_RANGE');
  assert.match(parsed.errors[0]?.message ?? '', /safe whole number/u);
});

test('YW configuration uses the current environment variable names only', () => {
  assert.equal(resolveDatabasePath({ YW_DB_PATH: 'new.db' }), 'new.db');
  assert.equal(resolveDatabasePath({}), './data/practice-probe-db.sqlite');
  const config = loadApplicationConfig({
    YW_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
  });
  assert.equal(config.api.host, '127.0.0.1');
  assert.equal(config.database.path, './data/practice-probe-db.sqlite');
});

test('signature matching recognizes each deterministic fixed reference', () => {
  const expected = new Map([
    ['baseline', 'Healthy baseline'],
    ['scratch', 'Handling scratch'],
    ['edge-ring', 'Edge ring'],
  ]);

  for (const sample of sampleWafers()) {
    const label = expected.get(sample.key);
    if (!label) continue;
    const parsed = parseWaferCsv(sample.csv);
    assert.equal(parsed.kind, 'ready');
    if (parsed.kind !== 'ready') continue;
    const result = matchWaferSignature(1, parsed.acceptedDies);
    assert.equal(result.status, 'matched');
    assert.equal(result.bestMatch?.label, label);
    assert.equal(result.bestMatch?.matchScore, 1);
    assert.equal(result.matcher.algorithm, 'weighted-pattern-distance');
  }
});

test('signature matching refuses to infer a spatial pattern from too few failures', () => {
  const result = matchWaferSignature(1, [
    { x: 0, y: 0, hardBin: 2, passFailFlag: 'F' },
    { x: 1, y: 0, hardBin: 2, passFailFlag: 'F' },
    { x: 0, y: 1, hardBin: 1, passFailFlag: 'P' },
  ]);
  assert.equal(result.status, 'insufficient-data');
  assert.equal(result.bestMatch, null);
  assert.match(result.evidence[0] ?? '', /at least 3/u);
});

test('signature matching returns no close match for the unfamiliar cross fixture', () => {
  const parsed = parseWaferCsv(
    readFileSync(path.join(appRoot, 'database', 'sample-wafer.csv'), 'utf8'),
  );
  assert.equal(parsed.kind, 'ready');
  if (parsed.kind !== 'ready') return;
  const result = matchWaferSignature(1, parsed.acceptedDies);
  assert.equal(result.status, 'no-close-match');
  assert.ok(result.bestMatch);
  assert.ok(result.bestMatch.matchScore < result.threshold);
  assert.match(result.disclaimer, /not a root-cause diagnosis/u);
});

test('wafer lookup accepts human identifiers while keeping sequence as the API key', async (context) => {
  const fixture = createTestDatabase();
  const store = new SqliteApplicationStore(fixture.databasePath);
  context.after(() => {
    store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });
  const sample = sampleWafers().find((wafer) => wafer.key === 'scratch');
  assert.ok(sample);
  await store.saveUpload(uploadInput(sample.csv, `${randomUUID()}-scratch.csv`));

  const page = await store.listWafers({ page: 1, pageSize: 10 });
  const wafer = page.items[0];
  assert.ok(wafer);

  for (const search of [
    `#${wafer.waferSequence}`,
    String(wafer.waferSequence),
    wafer.device,
    wafer.lot,
    `W${String(wafer.waferNumber).padStart(2, '0')}`,
    wafer.testProgram,
  ]) {
    const result = await store.listWafers({ search, page: 1, pageSize: 10 });
    assert.equal(result.total, 1, `expected ${search} to find the wafer`);
    assert.equal(result.items[0]?.waferSequence, wafer.waferSequence);
  }

  const literalWildcard = await store.listWafers({ search: '%', page: 1, pageSize: 10 });
  assert.equal(literalWildcard.total, 0);

  for (const filter of [{ lot: '%' }, { device: '_' }, { program: '%' }]) {
    const result = await store.listWafers({ ...filter, page: 1, pageSize: 10 });
    assert.equal(result.total, 0, `expected ${JSON.stringify(filter)} to be treated literally`);
  }

  const uploadWildcard = await store.listUploads({ search: '%', page: 1, pageSize: 25 });
  assert.equal(uploadWildcard.total, 0);
});

test('OpenAPI describes request bodies, errors, and operation IDs', async (context) => {
  const fixture = createTestDatabase();
  const app = await buildApplication({
    authSecret: 'test-secret',
    tokenTtlSeconds: 60,
    databasePath: fixture.databasePath,
  });
  context.after(async () => {
    await app.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });
  await app.ready();

  const readiness = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(readiness.statusCode, 200);
  assert.equal(readiness.json().dependencies.database, 'available');

  const upload = app.swagger().paths?.['/api/uploads']?.post;
  assert.equal(upload?.operationId, 'postUploads');
  assert.ok(upload && 'requestBody' in upload && upload.requestBody);
  assert.ok(upload?.responses?.['400']);
  const accepted = upload?.responses?.['202'];
  assert.ok(accepted && !('$ref' in accepted));
  assert.notEqual(accepted.description, 'Default Response');

  const signatureMatch = app.swagger().paths?.['/api/wafers/{waferSequence}/signature-match']?.get;
  assert.equal(signatureMatch?.operationId, 'getWafersByWaferSequenceSignatureMatch');
  assert.match(signatureMatch?.description ?? '', /not a confidence/u);
  assert.ok(signatureMatch?.responses?.['404']);
  assert.match(JSON.stringify(signatureMatch?.responses?.['200']), /weighted-pattern-distance/u);
  assert.doesNotMatch(JSON.stringify(signatureMatch?.responses?.['200']), /"model"/u);

  const waferList = app.swagger().paths?.['/api/wafers']?.get;
  const waferParameters = waferList?.parameters as
    Array<{ name?: string; description?: string }> | undefined;
  const searchParameter = waferParameters?.find((parameter) => parameter.name === 'search');
  assert.ok(searchParameter);
  assert.match(searchParameter.description ?? '', /device, lot, wafer number/u);

  const invalidLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
  assert.equal(invalidLogin.statusCode, 400);
});

test('a multi-wafer sample load rolls back completely when any wafer conflicts', async (context) => {
  const fixture = createTestDatabase();
  const store = new SqliteApplicationStore(fixture.databasePath);
  context.after(() => {
    store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });
  const sample = sampleWafers()[0]!;

  await assert.rejects(
    store.saveUploadsAtomically([
      uploadInput(sample.csv, `${randomUUID()}-first.csv`),
      uploadInput(sample.csv, `${randomUUID()}-duplicate.csv`),
    ]),
    /already been uploaded/u,
  );
  const uploads = await store.listUploads({ page: 1, pageSize: 25 });
  assert.equal(uploads.total, 0);
});
