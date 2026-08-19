import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { buildApplication } from '../api/src/app.js';
import {
  ASSESSMENT_LEVELS,
  assessmentCatalogue,
  EFFORT_POINTS,
  levelForScore,
  MAX_ASSESSMENT_SCORE,
  nextLevelAfter,
  penaltyFor,
  scoreResults,
} from '../shared/assessments.js';

const appRoot = path.resolve(import.meta.dirname, '..');

/*
 * Assessment ladder: the catalogue's own promises, the scoring arithmetic, and
 * the API around both. Expected values are written out by hand — a test that
 * derives its expectation from the module it checks cannot fail.
 */

function createTestDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'yw-assessments-'));
  const databasePath = path.join(directory, 'test.db');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.exec(readFileSync(path.join(appRoot, 'database', 'schema.sql'), 'utf8'));
  const insert = database.prepare(
    'INSERT INTO app_user (user_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
  );
  insert.run('user-dev', 'dev', 'unused', 'dev');
  insert.run('user-qa', 'qa', 'unused', 'qa');
  database.close();
  return { directory, databasePath };
}

test('the catalogue keeps its structural promises', () => {
  assert.equal(assessmentCatalogue.length, 30);
  for (const track of ['dev', 'qa'] as const) {
    const entries = assessmentCatalogue.filter((entry) => entry.track === track);
    assert.equal(entries.length, 15, `${track} track must have 15 assessments`);
    // Ordered 1..15 with no gaps, so "first skills first" is real, not implied.
    assert.deepEqual(
      entries.map((entry) => entry.order).sort((a, b) => a - b),
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
  }
  const ids = new Set(assessmentCatalogue.map((entry) => entry.id));
  assert.equal(ids.size, 30, 'ids must be unique — recorded results reference them');
  for (const entry of assessmentCatalogue) {
    assert.ok(entry.skills.length > 0, `${entry.id} names no skills`);
    assert.ok(
      entry.skills.every((skill) => skill.startsWith('/yw:')),
      `${entry.id} has a skill without the /yw: namespace`,
    );
    assert.ok(entry.passWhen.length >= 3, `${entry.id} needs at least 3 pass checks`);
    assert.ok(entry.mission.length > 80, `${entry.id} mission is too thin to act on`);
  }
});

test('the qa track covers API automation, performance, and security', () => {
  const qaSkills = assessmentCatalogue
    .filter((entry) => entry.track === 'qa')
    .flatMap((entry) => entry.skills);
  for (const required of [
    '/yw:forge-api-tests',
    '/yw:forge-performance-tests',
    '/yw:forge-security-tests',
  ]) {
    assert.ok(qaSkills.includes(required), `qa track must exercise ${required}`);
  }
});

test('scoring: pass adds points, a standing fail subtracts half, floor is zero', () => {
  // dev-01 is a starter: 10 points, penalty ceil(10/2) = 5.
  assert.equal(scoreResults([{ assessmentId: 'dev-01', outcome: 'passed' }]), 10);
  assert.equal(scoreResults([{ assessmentId: 'dev-01', outcome: 'failed' }]), 0, 'floored at 0');
  assert.equal(
    scoreResults([
      { assessmentId: 'dev-01', outcome: 'passed' }, // +10
      { assessmentId: 'qa-15', outcome: 'failed' }, //  −30 (expert 60 → penalty 30)
      { assessmentId: 'qa-01', outcome: 'passed' }, //  +10
    ]),
    0,
    '10 + 10 − 30 floors at 0',
  );
  assert.equal(
    scoreResults([
      { assessmentId: 'dev-15', outcome: 'passed' }, // +60
      { assessmentId: 'dev-01', outcome: 'failed' }, //  −5
    ]),
    55,
  );
  // Unknown ids degrade to nothing rather than throwing.
  assert.equal(scoreResults([{ assessmentId: 'renamed-away', outcome: 'passed' }]), 0);
});

test('levels: thresholds hold, and the top is reachable without perfection', () => {
  assert.equal(levelForScore(0).name, 'Cleanroom Visitor');
  assert.equal(levelForScore(39).name, 'Cleanroom Visitor');
  assert.equal(levelForScore(40).name, 'Probe Trainee');
  assert.equal(levelForScore(620).name, 'Fab Master');
  assert.equal(nextLevelAfter(620), null);
  assert.equal(nextLevelAfter(0)?.minPoints, 40);
  // Hand check of the maximum: per track 3×10 + 6×20 + 5×35 + 1×60 = 385.
  assert.equal(MAX_ASSESSMENT_SCORE, 770);
  const top = ASSESSMENT_LEVELS[ASSESSMENT_LEVELS.length - 1]!;
  assert.ok(top.minPoints < MAX_ASSESSMENT_SCORE, 'top level must not demand a perfect score');
  // Effort points are what the catalogue advertises.
  assert.deepEqual(EFFORT_POINTS, { starter: 10, core: 20, advanced: 35, expert: 60 });
  assert.equal(penaltyFor({ effort: 'advanced' }), 18, 'ceil(35 / 2)');
});

test('the API records, de-accumulates, clears, and refuses what it should', async (context) => {
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

  const asDev = {
    authorization: `Bearer ${app.jwt.sign({ sub: 'user-dev', username: 'dev', role: 'dev' })}`,
  };
  const asQa = {
    authorization: `Bearer ${app.jwt.sign({ sub: 'user-qa', username: 'qa', role: 'qa' })}`,
  };

  // Signed out: refused.
  const anonymous = await app.inject({ method: 'GET', url: '/api/assessments' });
  assert.equal(anonymous.statusCode, 401);

  // Fresh state: full catalogue, zero score, no standings yet.
  const fresh = await app.inject({ method: 'GET', url: '/api/assessments', headers: asDev });
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.json().assessments.length, 30);
  assert.equal(fresh.json().summary.score, 0);
  assert.deepEqual(fresh.json().standings, []);

  // Record a pass with the PR it was submitted through.
  const pass = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-01/result',
    headers: asDev,
    payload: { outcome: 'passed', evidenceUrl: 'https://github.com/x/y/pull/1' },
  });
  assert.equal(pass.statusCode, 200);
  assert.equal(pass.json().summary.score, 10);
  const entry = pass
    .json()
    .assessments.find((candidate: { id: string }) => candidate.id === 'dev-01');
  assert.equal(entry.status, 'passed');
  assert.equal(entry.evidenceUrl, 'https://github.com/x/y/pull/1');
  assert.equal(entry.attempts, 1);

  // A fail on an expert assessment de-accumulates: 10 − 30 floors at 0.
  const fail = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-15/result',
    headers: asDev,
    payload: { outcome: 'failed' },
  });
  assert.equal(fail.json().summary.score, 0);
  assert.equal(fail.json().summary.failed, 1);

  // Re-recording the fail as a pass recovers the ground and counts the attempt.
  const retry = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-15/result',
    headers: asDev,
    payload: { outcome: 'passed' },
  });
  assert.equal(retry.json().summary.score, 70);
  const capstone = retry
    .json()
    .assessments.find((candidate: { id: string }) => candidate.id === 'dev-15');
  assert.equal(capstone.attempts, 2);

  // A re-record without a link keeps the previously recorded evidence.
  const rerecord = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-01/result',
    headers: asDev,
    payload: { outcome: 'passed' },
  });
  const kept = rerecord
    .json()
    .assessments.find((candidate: { id: string }) => candidate.id === 'dev-01');
  assert.equal(kept.evidenceUrl, 'https://github.com/x/y/pull/1');

  // Another user's results are their own; standings show both, best first.
  await app.inject({
    method: 'POST',
    url: '/api/assessments/qa-01/result',
    headers: asQa,
    payload: { outcome: 'passed' },
  });
  const board = await app.inject({ method: 'GET', url: '/api/assessments', headers: asQa });
  assert.equal(board.json().summary.score, 10, 'qa sees only their own score');
  assert.deepEqual(
    board.json().standings.map((row: { username: string; score: number }) => row.username),
    ['dev', 'qa'],
    'ordered by score, best first',
  );

  // Refusals: unknown assessment, bad outcome, bad evidence link.
  const unknown = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-99/result',
    headers: asDev,
    payload: { outcome: 'passed' },
  });
  assert.equal(unknown.statusCode, 404);
  const badOutcome = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-01/result',
    headers: asDev,
    payload: { outcome: 'maybe' },
  });
  assert.equal(badOutcome.statusCode, 400);
  const badLink = await app.inject({
    method: 'POST',
    url: '/api/assessments/dev-02/result',
    headers: asDev,
    payload: { outcome: 'passed', evidenceUrl: 'not a url' },
  });
  assert.equal(badLink.statusCode, 400);
  assert.equal(badLink.json().code, 'INVALID_EVIDENCE_URL');

  // Clearing removes the record and the score it carried.
  const cleared = await app.inject({
    method: 'DELETE',
    url: '/api/assessments/dev-15/result',
    headers: asDev,
  });
  assert.equal(cleared.json().summary.score, 10, 'back to just dev-01');
  const gone = cleared
    .json()
    .assessments.find((candidate: { id: string }) => candidate.id === 'dev-15');
  assert.equal(gone.status, null);
});
