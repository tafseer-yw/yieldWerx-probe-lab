import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

import Database from 'better-sqlite3';

import { hashPassword } from '../api/src/password.js';
import { resolveDatabasePath } from '../api/src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function seedReferenceData(db: Database.Database): void {
  const insertFacility = db.prepare(
    'INSERT OR IGNORE INTO facility (facility_id, code, name) VALUES (?, ?, ?)',
  );
  insertFacility.run(randomUUID(), 'PROBE-FAB-1', 'Probe Practice Facility');
  const facilityId = (
    db.prepare('SELECT facility_id FROM facility WHERE code = ?').get('PROBE-FAB-1') as {
      facility_id: string;
    }
  ).facility_id;

  const insertWorkCenter = db.prepare(
    'INSERT OR IGNORE INTO work_center (work_center_id, facility_id, code, name, stage) VALUES (?, ?, ?, ?, ?)',
  );
  insertWorkCenter.run(randomUUID(), facilityId, 'PROBE-WC-SORT', 'Probe Wafer Sort', 'wafer-sort');
  const workCenterId = (
    db.prepare('SELECT work_center_id FROM work_center WHERE code = ?').get('PROBE-WC-SORT') as {
      work_center_id: string;
    }
  ).work_center_id;

  const insertDevice = db.prepare(
    'INSERT OR IGNORE INTO device (device_id, work_center_id, code, name) VALUES (?, ?, ?, ?)',
  );
  insertDevice.run(randomUUID(), workCenterId, 'PROBE-DEV-1', 'Probe Practice Device 1');
  insertDevice.run(randomUUID(), workCenterId, 'PROBE-DEV-2', 'Probe Practice Device 2');
  const deviceId1 = (
    db.prepare('SELECT device_id FROM device WHERE code = ?').get('PROBE-DEV-1') as {
      device_id: string;
    }
  ).device_id;
  const deviceId2 = (
    db.prepare('SELECT device_id FROM device WHERE code = ?').get('PROBE-DEV-2') as {
      device_id: string;
    }
  ).device_id;

  const insertProgram = db.prepare(
    'INSERT OR IGNORE INTO test_program (test_program_id, device_id, code, name) VALUES (?, ?, ?, ?)',
  );
  insertProgram.run(randomUUID(), deviceId1, 'PROBE-PGM-1', 'Probe Practice Program 1');
  insertProgram.run(randomUUID(), deviceId2, 'PROBE-PGM-2', 'Probe Practice Program 2');
}

async function seedUsers(db: Database.Database): Promise<void> {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO app_user (user_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
  );
  const [viewer, engineer, admin] = await Promise.all([
    hashPassword('viewer'),
    hashPassword('engineer'),
    hashPassword('admin'),
  ]);
  insert.run(randomUUID(), 'viewer', viewer, 'viewer');
  insert.run(randomUUID(), 'engineer', engineer, 'engineer');
  insert.run(randomUUID(), 'admin', admin, 'admin');
}

async function main(): Promise<void> {
  const configuredPath = resolveDatabasePath(process.env);
  const dbPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(root, configuredPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));

  db.transaction(() => seedReferenceData(db))();
  await seedUsers(db);
  db.close();

  process.stdout.write(`practice-probe-db ready at ${dbPath}\n`);
  process.stdout.write('Seeded users: viewer/viewer, engineer/engineer, admin/admin\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Setup failed: ${message}\n`);
  process.exitCode = 1;
});
