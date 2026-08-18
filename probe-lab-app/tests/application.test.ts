import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { buildApplication } from '../api/src/app.js';
import { detectClusters } from '../api/src/cluster-detection.js';
import { loadApplicationConfig, resolveDatabasePath } from '../api/src/config.js';
import { sampleWafers } from '../api/src/sample-data.js';
import type { ClusterDetectionResult, DieRecord, UserRole } from '../shared/contracts.js';
import { axisPitch, dieLattice, latticeColumn, latticeRow } from '../shared/die-lattice.js';
import { matchWaferSignature } from '../api/src/signature-match.js';
import { SqliteApplicationStore, type SaveUploadInput } from '../api/src/store.js';
import { parseWaferAtdf } from '../api/src/wafer-atdf.js';
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
    .run('test-user', 'dev', 'unused', 'dev');
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

test('uploading admits dev and qa as peers but refuses viewer', async (context) => {
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

  // A distinct lot per role keeps each submission clear of the duplicate-wafer guard.
  const submitAs = (role: UserRole) =>
    app.inject({
      method: 'POST',
      url: '/api/uploads?device=PROBE-DEV-1&program=PROBE-PGM-1',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: 'test-user', username: role, role })}`,
        'content-type': 'text/csv',
      },
      payload: `Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-RBAC-${role.toUpperCase()},1,0,0,1,1,P\n`,
    });

  // dev and qa sit at the same rank, so neither may be refused what the other gets.
  assert.equal((await submitAs('dev')).statusCode, 202);
  assert.equal((await submitAs('qa')).statusCode, 202);

  const refused = await submitAs('viewer');
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, 'FORBIDDEN');
});

/*
 * ATDF ingest. The expected numbers come from the fixture's own summary records,
 * not from the parser: database/sample-wafer.atdf declares PCR/WRR part count 6
 * and good count 4, so yield must be 4/6 = 66.667%.
 */
const atdfFixture = (): Buffer => readFileSync(path.join(appRoot, 'database', 'sample-wafer.atdf'));

test('ATDF parsing reads the lot, wafer, dies and bin names its records declare', () => {
  const result = parseWaferAtdf(atdfFixture());
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;

  // The MIR is split across a continuation line, so a folded record is required
  // to read the lot at all.
  assert.equal(result.lot, 'LOT-ATDF-01');
  // Above the 25 the CSV format used to cap wafer numbers at.
  assert.equal(result.wafer, 42);
  assert.equal(result.status, 'Succeeded');
  assert.equal(result.errors.length, 0);
  assert.equal(result.rowsRead, 6);
  assert.equal(result.acceptedDies.length, 6);

  const passed = result.acceptedDies.filter((die) => die.passFailFlag === 'P');
  assert.equal(passed.length, 4, 'WRR declares a good count of 4');

  // Negative coordinates are stored as recorded, never shifted into a positive frame.
  assert.deepEqual(
    result.acceptedDies.map((die) => [die.x, die.y]),
    [
      [-2, -1],
      [-1, -1],
      [0, -1],
      [-2, 0],
      [-1, 0],
      [0, 0],
    ],
  );

  // Soft bin names come from the SBR records; the CSV path leaves these null.
  const failed = result.acceptedDies.find((die) => die.passFailFlag === 'F');
  assert.equal(failed?.hardBin, 5);
  assert.equal(failed?.softBinName, 'Leakage fail');
  assert.equal(passed[0]?.softBinName, 'Pass');
});

test('ATDF flags a PRR whose result contradicts the bin disposition its HBR declares', () => {
  // Bin 5 is declared F by HBR, so a part reported P on bin 5 is a contradiction.
  const contradicted = atdfFixture()
    .toString('utf8')
    .replace('PRR:1|1|3.1|3|F|5|5|0|-1|||100', 'PRR:1|1|3.1|3|P|5|5|0|-1|||100');

  const result = parseWaferAtdf(contradicted);
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.status, 'Completed with errors');
  assert.equal(result.acceptedDies.length, 5);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.code, 'FLAG_BIN_MISMATCH');
  assert.match(result.errors[0]?.message ?? '', /HBR declares hard bin 5 as F/u);
});

test('ATDF rejects a file that is not ATDF and one that carries no parts', () => {
  const notAtdf = parseWaferAtdf('Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-1,1,0,0,1,1,P\n');
  assert.equal(notAtdf.kind, 'rejected');
  if (notAtdf.kind === 'rejected') assert.match(notAtdf.message, /not an ATDF/u);

  const noParts = atdfFixture()
    .toString('utf8')
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith('PRR:'))
    .join('\n');
  const emptyResult = parseWaferAtdf(noParts);
  assert.equal(emptyResult.kind, 'rejected');
  if (emptyResult.kind === 'rejected') assert.match(emptyResult.message, /no PRR part records/u);
});

test('an ATDF upload lands a wafer whose stored yield matches its declared good count', async (context) => {
  const fixture = createTestDatabase();
  const store = new SqliteApplicationStore(fixture.databasePath);
  context.after(() => {
    store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });

  const sourceData = atdfFixture();
  await store.saveUpload({
    sourceType: 'file',
    fileName: 'sample-wafer.atdf',
    contentType: 'text/plain',
    sourceData,
    sourceSha256: createHash('sha256').update(sourceData).digest('hex'),
    deviceCode: 'PROBE-DEV-1',
    testProgramCode: 'PROBE-PGM-1',
    submittedByUserId: 'test-user',
    parsed: parseWaferAtdf(sourceData),
  });

  const wafers = await store.listWafers({ page: 1, pageSize: 25 });
  assert.equal(wafers.total, 1);
  const summary = wafers.items[0];
  assert.equal(summary?.waferNumber, 42, 'a wafer number the old CHECK constraint refused');
  assert.equal(summary?.partCount, 6);
  assert.equal(summary?.passCount, 4);
  // 4 good of 6 parts, exactly as the fixture's PCR and WRR records declare.
  assert.equal(Math.round((summary?.yield ?? 0) * 1000) / 1000, 66.667);

  const detail = await store.getWafer(summary?.waferSequence ?? 0);
  assert.equal(detail?.dies.length, 6);
  // Negative coordinates survived the CHECK constraint and the round trip.
  assert.ok(detail?.dies.some((die) => die.x === -2 && die.y === -1));
  assert.equal(detail?.dies.filter((die) => die.passFailFlag === 'F').length, 2);
});

test('CSV now accepts the wafer numbers and signed coordinates ATDF requires', () => {
  const csv = 'Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-WIDE-01,42,-60,-48,1,1,P\n';
  const result = parseWaferCsv(csv);
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.errors.length, 0);
  assert.equal(result.wafer, 42);
  assert.equal(result.acceptedDies[0]?.x, -60);
  assert.equal(result.acceptedDies[0]?.y, -48);

  // The widened span still has edges.
  const beyond = parseWaferCsv('Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-WIDE-01,10000,0,0,1,1,P\n');
  assert.equal(beyond.kind, 'rejected');
});

/*
 * Cluster adjacency across die pitches.
 *
 * A wafer's X/Y are lattice positions whose step is whatever the tester recorded:
 * 1 in the CSV practice files, 5 in the ATDF sample. Detection must therefore be
 * invariant under a uniform coordinate scaling — the same physical wafer written
 * with a wider pitch is still the same wafer. That property is the independent
 * check here: it holds only if adjacency is walked in lattice indices.
 */

/** A 5x3 wafer whose failures form a C of five, plus one isolated die. */
const clusterLayout = ['F F . . .', 'F . . . F', 'F F . . .'];

function waferAtPitch(pitch: number): DieRecord[] {
  const dies: DieRecord[] = [];
  let dieId = 1;
  for (const [row, line] of clusterLayout.entries()) {
    for (const [column, mark] of line.split(' ').entries()) {
      const failing = mark === 'F';
      dies.push({
        dieId: dieId++,
        x: column * pitch,
        y: row * pitch,
        hardBin: failing ? 4 : 1,
        softBin: failing ? 4 : 1,
        passFailFlag: failing ? 'F' : 'P',
      });
    }
  }
  return dies;
}

const clusterShape = (result: ClusterDetectionResult): unknown =>
  result.clusters.map((cluster) => cluster.dieCount);

test('axisPitch reads the lattice step from the coordinates present', () => {
  assert.equal(axisPitch([0, 1, 2, 3]), 1);
  assert.equal(axisPitch([0, 5, 10, 15]), 5);
  assert.equal(axisPitch([-60, -55, -50, 75]), 5);
  // Uneven gaps fall back to their greatest common divisor.
  assert.equal(axisPitch([0, 5, 10, 20]), 5);
  assert.equal(axisPitch([0, 4, 6]), 2);
  // Nothing to measure a step against.
  assert.equal(axisPitch([7]), 1);
  assert.equal(axisPitch([]), 1);
  // Coordinates that share no common step are treated as already unit-pitch.
  assert.equal(axisPitch([0, 2, 3]), 1);
});

test('dieLattice measures the grid in dies, not in raw coordinate units', () => {
  // The ATDF sample's span: X -60..75 and Y -48..37, both stepping by 5. Counted
  // off the distinct values in the source file, that is a 28 x 18 die grid — not
  // the 136 x 86 a raw-coordinate span would claim.
  const dies = [];
  for (let x = -60; x <= 75; x += 5) {
    for (let y = -48; y <= 37; y += 5) dies.push({ x, y });
  }
  const lattice = dieLattice(dies);
  assert.equal(lattice.pitchX, 5);
  assert.equal(lattice.pitchY, 5);
  assert.equal(lattice.columns, 28);
  assert.equal(lattice.rows, 18);
  assert.equal(latticeColumn(lattice, -60), 0);
  assert.equal(latticeColumn(lattice, 75), 27);
  assert.equal(latticeRow(lattice, -48), 0);
  assert.equal(latticeRow(lattice, 37), 17);
});

test('a wafer written with a wider die pitch yields the same clusters', () => {
  const options = { adjacency: '4-way', minimumConnectedDies: 2 } as const;

  const unit = detectClusters(1, waferAtPitch(1), options);
  // Counted off clusterLayout by hand: (0,0)-(1,0)-(0,1)-(0,2)-(1,2) is one
  // 4-way-connected C of five, and the lone failure at (4,1) cannot meet a
  // minimum of 2.
  assert.equal(unit.clustersFound, 1);
  assert.deepEqual(clusterShape(unit), [5]);

  // The same wafer recorded at the ATDF sample's pitch must not change the answer.
  for (const pitch of [2, 5, 25]) {
    const scaled = detectClusters(1, waferAtPitch(pitch), options);
    assert.equal(scaled.clustersFound, unit.clustersFound, `pitch ${pitch} cluster count`);
    assert.deepEqual(clusterShape(scaled), clusterShape(unit), `pitch ${pitch} cluster sizes`);
  }
});

test('cluster coordinates are reported as recorded, not as lattice indices', () => {
  const result = detectClusters(1, waferAtPitch(5), {
    adjacency: '4-way',
    minimumConnectedDies: 2,
  });
  const coordinates = result.clusters[0]?.coordinates ?? [];
  // Column 0 rows 0-2 plus column 1 row 0 and row 2, at pitch 5.
  assert.deepEqual(coordinates, [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: 0, y: 10 },
    { x: 5, y: 10 },
  ]);
});

test('a gap still breaks adjacency at a wide pitch', () => {
  // Two failures two lattice steps apart, with a passing die between them.
  const dies: DieRecord[] = [
    { dieId: 1, x: 0, y: 0, hardBin: 4, softBin: 4, passFailFlag: 'F' },
    { dieId: 2, x: 5, y: 0, hardBin: 1, softBin: 1, passFailFlag: 'P' },
    { dieId: 3, x: 10, y: 0, hardBin: 4, softBin: 4, passFailFlag: 'F' },
  ];
  const result = detectClusters(1, dies, { adjacency: '8-way', minimumConnectedDies: 2 });
  assert.equal(result.clustersFound, 0, 'CLD-11: a gap cannot join two components');

  // Remove the gap and the same two failures do connect.
  const touching = detectClusters(1, [dies[0] as DieRecord, { ...(dies[2] as DieRecord), x: 5 }], {
    adjacency: '8-way',
    minimumConnectedDies: 2,
  });
  assert.equal(touching.clustersFound, 1);
  assert.deepEqual(clusterShape(touching), [2]);
});

/*
 * Multipart robustness. A body the caller sent badly is a 4xx, never a 5xx —
 * busboy rejects a truncated body with a plain Error, which would otherwise reach
 * the error handler with no status and be reported as INTERNAL_ERROR.
 */
test('an unreadable multipart body is a client error, not an internal one', async (context) => {
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

  const boundary = '----WebKitFormBoundaryTest';
  const partHead =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="wafer 3 1.atdf"\r\n' +
    'Content-Type: application/octet-stream\r\n\r\n';
  const submit = async (body: string) =>
    app.inject({
      method: 'POST',
      url: '/api/uploads?device=PROBE-DEV-1&program=PROBE-PGM-1',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: 'test-user', username: 'dev', role: 'dev' })}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

  // Truncated mid-upload: no closing delimiter ever arrives.
  const truncated = await submit(`${partHead}FAR:A|4|2\r\n`);
  assert.equal(truncated.statusCode, 400);
  assert.equal(truncated.json().code, 'MALFORMED_UPLOAD');

  // A well-formed body carrying no bytes is a different thing: it is readable, so
  // it is accepted and then rejected by the parser with a report to show.
  const empty = await submit(`${partHead}\r\n--${boundary}--\r\n`);
  assert.equal(empty.statusCode, 202);
  const summary = await app.inject({
    method: 'GET',
    url: `/api/uploads/${empty.json().uploadId}`,
    headers: {
      authorization: `Bearer ${app.jwt.sign({ sub: 'test-user', username: 'dev', role: 'dev' })}`,
    },
  });
  assert.equal(summary.json().status, 'Rejected');
  assert.equal(summary.json().terminalMessage, 'File is empty.');

  // A filename with spaces still resolves to the ATDF reader.
  const real = await submit(`${partHead}${atdfFixture().toString('utf8')}\r\n--${boundary}--\r\n`);
  assert.equal(real.statusCode, 202);
});

/*
 * A token outliving the row it names. The practice database is disposable, so a
 * re-seed while a browser still holds an eight-hour token used to leave the token
 * pointing at a user_id that no longer existed: reads kept working and the first
 * write failed on the app_user foreign key as a 500. It must be a 401 so the web
 * client's existing unauthorized handler can ask for a fresh sign-in.
 */
test('a token naming a user that no longer exists is refused, not crashed', async (context) => {
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

  const submitAs = async (userId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/uploads?device=PROBE-DEV-1&program=PROBE-PGM-1',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: userId, username: 'dev', role: 'dev' })}`,
        'content-type': 'text/csv',
      },
      payload: 'Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-STALE-01,1,0,0,1,1,P\n',
    });

  // Well-formed and correctly signed, but its subject was never seeded here.
  const stale = await submitAs('11111111-2222-4333-8444-555555555555');
  assert.equal(stale.statusCode, 401, 'must not be a 500 foreign-key failure');
  assert.equal(stale.json().code, 'UNAUTHORIZED');
  assert.match(stale.json().message, /no longer exists/u);

  // The seeded user of the same fixture still works, so the check is not blanket.
  const valid = await submitAs('test-user');
  assert.equal(valid.statusCode, 202);
});
