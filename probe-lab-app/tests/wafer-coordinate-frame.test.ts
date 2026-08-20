/*
 * The wafer coordinate frame — which way the source file says its die
 * coordinates grow, and what the wafer map owes that declaration.
 *
 * Regression coverage for the mirrored wafer map: an ATDF whose WCR record
 * declares POS_X = L ("positive X grows to the left") was drawn with the
 * smallest X on the left, so every die landed in the mirrored column and a
 * rim failure appeared on the wrong side of the wafer. The reader never read
 * WCR, so nothing downstream could correct it.
 *
 * Every expected value below comes from the fixture's own WCR record, or from
 * arithmetic on the coordinate extents — never from the reader or the display
 * mapping under test.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { buildApplication } from '../api/src/app.js';
import { matchWaferSignature } from '../api/src/signature-match.js';
import { SqliteApplicationStore } from '../api/src/store.js';
import { parseWaferAtdf } from '../api/src/wafer-atdf.js';
import { parseWaferCsv } from '../api/src/wafer-csv.js';
import type { DieRecord } from '../shared/contracts.js';
import { dieLattice, displayColumn, displayRow } from '../shared/die-lattice.js';

const appRoot = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(appRoot, 'database', 'sample-wafer.atdf');
const atdfFixture = (): string => readFileSync(fixturePath, 'utf8');

/**
 * The independent oracle: read the frame straight out of the fixture's WCR
 * line. ATDF orders WCR as WF_FLAT | POS_X | POS_Y | WAFR_SIZ | DIE_HT |
 * DIE_WID | WF_UNITS, so the two directions are fields 2 and 3 of the record.
 */
function declaredFrame(text: string): { posX: string; posY: string } {
  const line = text.split(/\r?\n/u).find((candidate) => candidate.startsWith('WCR:'));
  assert.ok(line, 'the fixture must carry a WCR record for this test to mean anything');
  const fields = line.slice('WCR:'.length).split('|');
  return { posX: fields[1] ?? '', posY: fields[2] ?? '' };
}

function replaceWcr(text: string, replacement: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => (line.startsWith('WCR:') ? replacement : line))
    .join('\n');
}

function removeWcr(text: string): string {
  return text
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith('WCR:'))
    .join('\n');
}

test('the ATDF reader takes the coordinate frame from the WCR record the file carries', () => {
  const text = atdfFixture();
  const declared = declaredFrame(text);
  // Sanity-check the oracle itself before trusting it: L = left, D = down.
  assert.equal(declared.posX, 'L');
  assert.equal(declared.posY, 'D');

  const result = parseWaferAtdf(text);
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.positiveX, 'left');
  assert.equal(result.positiveY, 'down');
});

test('a right/up declaration is read as declared, not assumed', () => {
  const flipped = replaceWcr(atdfFixture(), 'WCR:|R|U|152.4|1.48|1.019|3');
  const result = parseWaferAtdf(flipped);
  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.positiveX, 'right');
  assert.equal(result.positiveY, 'up');
});

test('a file that states no frame leaves it undeclared rather than guessing one', () => {
  const withoutWcr = parseWaferAtdf(removeWcr(atdfFixture()));
  assert.equal(withoutWcr.kind, 'ready');
  if (withoutWcr.kind !== 'ready') return;
  assert.equal(withoutWcr.positiveX, null);
  assert.equal(withoutWcr.positiveY, null);

  // A blank POS_X/POS_Y is a file that did not say, not a file that said right.
  const blank = parseWaferAtdf(replaceWcr(atdfFixture(), 'WCR:|||152.4|1.48|1.019|3'));
  assert.equal(blank.kind, 'ready');
  if (blank.kind !== 'ready') return;
  assert.equal(blank.positiveX, null);
  assert.equal(blank.positiveY, null);

  // A CSV has no way to declare a frame, so it never claims one.
  const csv = parseWaferCsv('Lot,Wafer,X,Y,HB#,SB#,PF_Flag\nLOT-FRAME-01,1,0,0,1,1,P\n');
  assert.equal(csv.kind, 'ready');
  if (csv.kind !== 'ready') return;
  assert.equal(csv.positiveX, null);
  assert.equal(csv.positiveY, null);
});

/*
 * Display geometry. The extents are the real file's: X from -60 to +75 and Y
 * from -48 to +37, both stepping by 5, which is a 28 x 18 grid.
 */
const pitch = 5;
const gridDies = (): Array<{ x: number; y: number }> => {
  const dies: Array<{ x: number; y: number }> = [];
  for (let x = -60; x <= 75; x += pitch) for (let y = -48; y <= 37; y += pitch) dies.push({ x, y });
  return dies;
};

test('a left-positive frame mirrors the display column and leaves the row alone', () => {
  const dies = gridDies();
  const lattice = dieLattice(dies);
  assert.equal(lattice.columns, 28);
  assert.equal(lattice.rows, 18);

  for (const die of dies) {
    // Independent arithmetic: with +X to the left, the largest X is column 0.
    assert.equal(
      displayColumn(lattice, { positiveX: 'left', positiveY: 'down' }, die.x),
      (75 - die.x) / pitch,
    );
    assert.equal(
      displayRow(lattice, { positiveX: 'left', positiveY: 'down' }, die.y),
      (die.y + 48) / pitch,
    );
  }

  // The rim failure that made the defect visible: X = +65 belongs two columns
  // in from the left, not one column in from the right.
  assert.equal(displayColumn(lattice, { positiveX: 'left', positiveY: 'down' }, 65), 2);
});

test('an undeclared or right-positive frame keeps the smallest X on the left', () => {
  const dies = gridDies();
  const lattice = dieLattice(dies);

  for (const frame of [
    { positiveX: null, positiveY: null },
    { positiveX: 'right' as const, positiveY: 'down' as const },
  ]) {
    for (const die of dies) {
      assert.equal(displayColumn(lattice, frame, die.x), (die.x + 60) / pitch);
      assert.equal(displayRow(lattice, frame, die.y), (die.y + 48) / pitch);
    }
  }
});

test('an up-positive frame mirrors the display row and leaves the column alone', () => {
  const dies = gridDies();
  const lattice = dieLattice(dies);

  for (const die of dies) {
    assert.equal(
      displayRow(lattice, { positiveX: 'right', positiveY: 'up' }, die.y),
      (37 - die.y) / pitch,
    );
    assert.equal(
      displayColumn(lattice, { positiveX: 'right', positiveY: 'up' }, die.x),
      (die.x + 60) / pitch,
    );
  }
});

function createFrameDatabase(schema: (sql: string) => string = (sql) => sql): {
  directory: string;
  databasePath: string;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'yw-probe-frame-'));
  const databasePath = path.join(directory, 'test.db');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.exec(schema(readFileSync(path.join(appRoot, 'database', 'schema.sql'), 'utf8')));
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

test('the frame the file declared survives to the wafer detail response', async (context) => {
  const fixture = createFrameDatabase();
  const store = new SqliteApplicationStore(fixture.databasePath);
  const app = await buildApplication({
    authSecret: 'test-secret',
    tokenTtlSeconds: 60,
    databasePath: fixture.databasePath,
  });
  context.after(async () => {
    await app.close();
    store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });
  await app.ready();

  const sourceData = Buffer.from(atdfFixture(), 'utf8');
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
  const waferSequence = wafers.items[0]?.waferSequence ?? 0;
  assert.ok(waferSequence > 0);

  // Through the store...
  const detail = await store.getWafer(waferSequence);
  assert.equal(detail?.positiveX, 'left');
  assert.equal(detail?.positiveY, 'down');

  // ...and through the route, whose response schema strips any property it does
  // not declare, so this also proves the served API document carries the frame.
  const response = await app.inject({
    method: 'GET',
    url: `/api/wafers/${waferSequence}`,
    headers: {
      authorization: `Bearer ${app.jwt.sign({ sub: 'test-user', username: 'dev', role: 'dev' })}`,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().positiveX, 'left');
  assert.equal(response.json().positiveY, 'down');

  const documented = app.swagger().paths?.['/api/wafers/{waferSequence}']?.get;
  assert.match(JSON.stringify(documented?.responses?.['200']), /positiveX/u);
});

/* The pre-change schema, derived from the current file so it cannot drift: the
   same tables without the two columns this fix added. */
const withoutFrameColumns = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !/positive_[xy]/u.test(line))
    .join('\n');

test('a database written before the frame existed still opens and reads', async (context) => {
  const fixture = createFrameDatabase(withoutFrameColumns);
  const store = new SqliteApplicationStore(fixture.databasePath);
  context.after(() => {
    store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });

  const sourceData = Buffer.from(atdfFixture(), 'utf8');
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

  // Opening it migrated the columns in, so the wafer lands and reads normally.
  const wafers = await store.listWafers({ page: 1, pageSize: 25 });
  const detail = await store.getWafer(wafers.items[0]?.waferSequence ?? 0);
  assert.equal(detail?.dies.length, 6);
  assert.equal(detail?.positiveX, 'left');

  // And a row that predates the columns reads as undeclared rather than failing.
  const legacy = new Database(fixture.databasePath);
  legacy.prepare('UPDATE wafer SET positive_x = NULL, positive_y = NULL').run();
  legacy.close();
  const undeclared = await store.getWafer(wafers.items[0]?.waferSequence ?? 0);
  assert.equal(undeclared?.positiveX, null);
  assert.equal(undeclared?.positiveY, null);
});

test('a wafer that landed before the fix recovers its frame from the file it landed', async (context) => {
  const fixture = createFrameDatabase(withoutFrameColumns);
  const sourceData = Buffer.from(atdfFixture(), 'utf8');

  /* The pre-change state, written the way the pre-change code wrote it: an
     upload whose bytes are retained, and a wafer with no frame to read. */
  const legacy = new Database(fixture.databasePath);
  legacy
    .prepare('INSERT INTO lot (lot_id, device_id, lot_code) VALUES (?, ?, ?)')
    .run('lot', 'device', 'LOT-ATDF-01');
  legacy
    .prepare(
      `INSERT INTO upload (upload_id, source_type, file_name, content_type, source_data,
         source_byte_count, source_sha256, device_id, test_program_id, submitted_by_user_id,
         status, rows_read, rows_accepted, rows_rejected, submitted_at)
         VALUES (?, 'file', 'sample-wafer.atdf', 'text/plain', ?, ?, ?, 'device', 'program',
           'test-user', 'Succeeded', 6, 6, 0, '2026-01-01T00:00:00.000Z')`,
    )
    .run(
      'upload',
      sourceData,
      sourceData.byteLength,
      createHash('sha256').update(sourceData).digest('hex'),
    );
  legacy
    .prepare(
      `INSERT INTO wafer (lot_id, wafer_number, test_program_id, upload_id, part_count,
         pass_count, yield, finish_time)
         VALUES ('lot', 42, 'program', 'upload', 6, 4, 66.667, '2026-01-01T00:00:00.000Z')`,
    )
    .run();
  legacy.close();

  const store = new SqliteApplicationStore(fixture.databasePath);
  context.after(() => {
    store.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  });

  // Opening the store migrated the columns in and read the frame back out of
  // the retained file, so the wafer stops drawing mirrored without a re-upload.
  const wafers = await store.listWafers({ page: 1, pageSize: 25 });
  const detail = await store.getWafer(wafers.items[0]?.waferSequence ?? 0);
  assert.equal(detail?.positiveX, 'left');
  assert.equal(detail?.positiveY, 'down');
});

/*
 * Signature matching compares quadrant failure rates against references built
 * from CSV practice wafers, which carry no declared frame. A wafer read from a
 * left-positive file is the same physical wafer as its mirrored twin recorded
 * in the default frame, so it must score identically — otherwise "upper left"
 * describes the file's convention rather than the wafer.
 */
function asymmetricWafer(mirrored: boolean): DieRecord[] {
  const dies: DieRecord[] = [];
  let dieId = 1;
  for (let x = -10; x <= 10; x += 1) {
    for (let y = -10; y <= 10; y += 1) {
      // A dense knot in one X half only, so mirroring it is observable.
      const failed = x >= 4 && x <= 9 && y >= -9 && y <= -4;
      dies.push({
        dieId: dieId++,
        x: mirrored ? -x : x,
        y,
        hardBin: failed ? 7 : 1,
        softBin: failed ? 7 : 1,
        passFailFlag: failed ? 'F' : 'P',
      });
    }
  }
  return dies;
}

test('the same physical wafer scores the same however its file declares the frame', () => {
  const asRecorded = matchWaferSignature(1, asymmetricWafer(false), {
    positiveX: 'left',
    positiveY: 'down',
  });
  const asMirroredTwin = matchWaferSignature(1, asymmetricWafer(true), {
    positiveX: 'right',
    positiveY: 'down',
  });

  assert.equal(asRecorded.bestMatch?.referenceKey, asMirroredTwin.bestMatch?.referenceKey);
  assert.deepEqual(
    asRecorded.alternatives.map((candidate) => [candidate.referenceKey, candidate.matchScore]),
    asMirroredTwin.alternatives.map((candidate) => [candidate.referenceKey, candidate.matchScore]),
  );
});

test('the declared frame reaches the matcher rather than being ignored', () => {
  // The same coordinates under opposite declarations describe two different
  // wafers, so the chirally asymmetric pattern above cannot score the same.
  const leftPositive = matchWaferSignature(1, asymmetricWafer(false), {
    positiveX: 'left',
    positiveY: 'down',
  });
  const rightPositive = matchWaferSignature(1, asymmetricWafer(false), {
    positiveX: 'right',
    positiveY: 'down',
  });

  assert.notDeepEqual(
    leftPositive.alternatives.map((candidate) => candidate.matchScore),
    rightPositive.alternatives.map((candidate) => candidate.matchScore),
  );
});
