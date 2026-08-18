import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import {
  userRoles,
  type DieRecord,
  type ReferenceValue,
  type UploadErrorPage,
  type UploadHistoryPage,
  type UploadSummary,
  type UserRole,
  type WaferDetail,
  type WaferPage,
  type WaferSummary,
} from '../../shared/contracts.js';
import type { UploadParseResult, UploadValidationError, ParsedDie } from './wafer-csv.js';

/** A sample upload that is currently in the database. */
export interface SampleUploadRow {
  uploadId: string;
  lot: string | null;
  waferSequence: number | null;
}
import { apiError } from './security.js';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
}

export interface UploadHistoryFilter {
  status?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface WaferListFilter {
  search?: string;
  lot?: string;
  device?: string;
  program?: string;
  page: number;
  pageSize: number;
}

export interface SaveUploadInput {
  sourceType: 'file' | 'paste';
  fileName: string;
  contentType: string;
  sourceData: Buffer;
  sourceSha256: string;
  deviceCode: string;
  testProgramCode: string;
  submittedByUserId: string;
  parsed: UploadParseResult;
  /** Marks a row created by the Sample wafers loader, so removal can be scoped. */
  isSample?: boolean;
}

export interface ApplicationStore {
  findUserByUsername(username: string): Promise<UserRecord | null>;
  listDevices(): Promise<ReferenceValue[]>;
  listTestPrograms(deviceCode: string): Promise<ReferenceValue[]>;
  findReference(
    deviceCode: string,
    programCode: string,
  ): Promise<{ deviceId: string; testProgramId: string } | null>;
  saveUpload(input: SaveUploadInput): Promise<string>;
  saveUploadsAtomically(inputs: SaveUploadInput[]): Promise<string[]>;
  listUploads(filter: UploadHistoryFilter): Promise<UploadHistoryPage>;
  getUpload(id: string): Promise<UploadSummary | null>;
  listUploadErrors(id: string, page: number, pageSize: number): Promise<UploadErrorPage | null>;
  listWafers(filter: WaferListFilter): Promise<WaferPage>;
  getWafer(waferSequence: number): Promise<WaferDetail | null>;
  deleteUpload(uploadId: string): Promise<boolean>;
  listSampleUploads(): Promise<SampleUploadRow[]>;
  removeSampleUploads(lots: string[]): Promise<number>;
}

interface UploadRow {
  upload_id: string;
  file_name: string;
  device_code: string;
  test_program_code: string;
  lot_code: string | null;
  wafer_number: number | null;
  wafer_sequence: number | null;
  status: string;
  rows_read: number;
  rows_accepted: number;
  rows_rejected: number;
  submitted_by: string;
  submitted_at: string;
  terminal_message: string | null;
}

function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}

interface WaferRow {
  wafer_sequence: number;
  lot_code: string;
  wafer_number: number;
  device_code: string;
  test_program_code: string;
  part_count: number;
  pass_count: number;
  yield: number;
  finish_time: string;
  upload_id: string;
}

interface DieRow {
  die_id: number;
  x: number;
  y: number;
  hard_bin: number;
  hard_bin_name: string | null;
  soft_bin: number;
  soft_bin_name: string | null;
  pass_fail_flag: 'P' | 'F';
}

interface UploadErrorRow {
  upload_error_id: number;
  row_number: number;
  column_name: string;
  error_code: string;
  error_message: string;
  raw_text: string;
}

function toUploadSummary(row: UploadRow): UploadSummary {
  return {
    id: row.upload_id,
    fileName: row.file_name,
    device: row.device_code,
    testProgram: row.test_program_code,
    lot: row.lot_code,
    wafer: row.wafer_number,
    waferSequence: row.wafer_sequence,
    status: row.status as UploadSummary['status'],
    rowsRead: row.rows_read,
    rowsAccepted: row.rows_accepted,
    rowsRejected: row.rows_rejected,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    terminalMessage: row.terminal_message,
  };
}

function toWaferSummary(row: WaferRow): WaferSummary {
  return {
    waferSequence: row.wafer_sequence,
    lot: row.lot_code,
    waferNumber: row.wafer_number,
    device: row.device_code,
    testProgram: row.test_program_code,
    partCount: row.part_count,
    passCount: row.pass_count,
    yield: row.yield,
    finishTime: row.finish_time,
  };
}

function toDie(row: DieRow): DieRecord {
  return {
    dieId: row.die_id,
    x: row.x,
    y: row.y,
    hardBin: row.hard_bin,
    hardBinName: row.hard_bin_name,
    softBin: row.soft_bin,
    softBinName: row.soft_bin_name,
    passFailFlag: row.pass_fail_flag,
  };
}

export class SqliteApplicationStore implements ApplicationStore {
  private readonly db: Database.Database;

  public constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  /** Idempotent: brings a database created before a column existed up to date. */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(upload)').all() as Array<{ name: string }>;
    if (columns.length > 0 && !columns.some((column) => column.name === 'is_sample')) {
      this.db.exec('ALTER TABLE upload ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0');
    }
  }

  public async findUserByUsername(username: string): Promise<UserRecord | null> {
    const row = this.db
      .prepare('SELECT user_id, username, password_hash, role FROM app_user WHERE username = ?')
      .get(username) as
      { user_id: string; username: string; password_hash: string; role: string } | undefined;
    if (!row) return null;
    if (!userRoles.some((role) => role === row.role)) {
      throw new Error(`Database returned invalid user role '${row.role}'.`);
    }
    return {
      id: row.user_id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role as UserRole,
    };
  }

  public async listDevices(): Promise<ReferenceValue[]> {
    return this.db
      .prepare('SELECT device_id AS id, code, name FROM device ORDER BY code')
      .all() as ReferenceValue[];
  }

  public async listTestPrograms(deviceCode: string): Promise<ReferenceValue[]> {
    return this.db
      .prepare(
        `SELECT p.test_program_id AS id, p.code, p.name FROM test_program p
         JOIN device d ON d.device_id = p.device_id WHERE d.code = ? ORDER BY p.code`,
      )
      .all(deviceCode) as ReferenceValue[];
  }

  public async findReference(
    deviceCode: string,
    programCode: string,
  ): Promise<{ deviceId: string; testProgramId: string } | null> {
    const row = this.db
      .prepare(
        `SELECT d.device_id, p.test_program_id FROM device d
         JOIN test_program p ON p.device_id = d.device_id WHERE d.code = ? AND p.code = ?`,
      )
      .get(deviceCode, programCode) as { device_id: string; test_program_id: string } | undefined;
    return row ? { deviceId: row.device_id, testProgramId: row.test_program_id } : null;
  }

  public async saveUpload(input: SaveUploadInput): Promise<string> {
    const reference = await this.findReference(input.deviceCode, input.testProgramCode);
    if (!reference) {
      throw apiError(
        400,
        'INVALID_REFERENCE',
        'The selected Device and Test Program combination does not exist.',
      );
    }

    return this.db.transaction(() => this.persistUpload(input, reference))();
  }

  public async saveUploadsAtomically(inputs: SaveUploadInput[]): Promise<string[]> {
    const references = await Promise.all(
      inputs.map((input) => this.findReference(input.deviceCode, input.testProgramCode)),
    );
    if (references.some((reference) => reference === null)) {
      throw apiError(
        400,
        'INVALID_REFERENCE',
        'A selected Device and Test Program combination does not exist.',
      );
    }

    return this.db.transaction(() =>
      inputs.map((input, index) => this.persistUpload(input, references[index]!)),
    )();
  }

  private persistUpload(
    input: SaveUploadInput,
    reference: { deviceId: string; testProgramId: string },
  ): string {
    const uploadId = randomUUID();
    const parsed = input.parsed;
    const now = new Date().toISOString();
    let lot: string | null;
    let waferNumber: number | null;
    let status: string;
    let rowsAccepted: number;
    let rowsRejected: number;
    let terminalMessage: string | null;
    let acceptedDies: ParsedDie[];
    let errors: UploadValidationError[];
    if (parsed.kind === 'ready') {
      lot = parsed.lot;
      waferNumber = parsed.wafer;
      status = parsed.status;
      acceptedDies = parsed.acceptedDies;
      errors = parsed.errors;
      rowsAccepted = acceptedDies.length;
      rowsRejected = errors.length;
      terminalMessage = null;
    } else {
      lot = null;
      waferNumber = null;
      status = 'Rejected';
      acceptedDies = [];
      errors = parsed.errors;
      rowsAccepted = 0;
      rowsRejected = errors.length;
      terminalMessage = parsed.message;
    }

    this.db
      .prepare(
        `INSERT INTO upload (upload_id, source_type, file_name, content_type, source_data,
           source_byte_count, source_sha256, device_id, test_program_id, submitted_by_user_id,
           lot_code, wafer_number, status, rows_read, rows_accepted, rows_rejected,
           terminal_message, is_sample, submitted_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uploadId,
        input.sourceType,
        input.fileName,
        input.contentType,
        input.sourceData,
        input.sourceData.byteLength,
        input.sourceSha256,
        reference.deviceId,
        reference.testProgramId,
        input.submittedByUserId,
        lot,
        waferNumber,
        status,
        parsed.rowsRead,
        rowsAccepted,
        rowsRejected,
        terminalMessage,
        input.isSample === true ? 1 : 0,
        now,
        now,
      );

    if (parsed.kind === 'ready') {
      let lotId = (
        this.db
          .prepare('SELECT lot_id FROM lot WHERE device_id = ? AND lot_code = ?')
          .get(reference.deviceId, lot) as { lot_id: string } | undefined
      )?.lot_id;
      if (!lotId) {
        lotId = randomUUID();
        this.db
          .prepare('INSERT INTO lot (lot_id, device_id, lot_code) VALUES (?, ?, ?)')
          .run(lotId, reference.deviceId, lot);
      }

      const existing = this.db
        .prepare('SELECT 1 FROM wafer WHERE lot_id = ? AND wafer_number = ?')
        .get(lotId, waferNumber);
      if (existing) {
        throw apiError(409, 'WAFER_EXISTS', 'This lot and wafer have already been uploaded.');
      }

      const passCount = acceptedDies.filter((die) => die.passFailFlag === 'P').length;
      const partCount = acceptedDies.length;
      const yieldPct = partCount === 0 ? 0 : (passCount / partCount) * 100;
      const info = this.db
        .prepare(
          `INSERT INTO wafer (lot_id, wafer_number, test_program_id, upload_id, part_count,
             pass_count, yield, finish_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          lotId,
          waferNumber,
          reference.testProgramId,
          uploadId,
          partCount,
          passCount,
          yieldPct,
          now,
        );
      const waferSequence = Number(info.lastInsertRowid);

      const insertDie = this.db.prepare(
        `INSERT INTO die (wafer_sequence, x, y, hard_bin, hard_bin_name, soft_bin, soft_bin_name, pass_fail_flag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const die of acceptedDies) {
        insertDie.run(
          waferSequence,
          die.x,
          die.y,
          die.hardBin,
          die.hardBinName,
          die.softBin,
          die.softBinName,
          die.passFailFlag,
        );
      }
    }

    const insertError = this.db.prepare(
      `INSERT INTO upload_error (upload_id, row_number, column_name, error_code, error_message, raw_text)
           VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const error of errors) {
      insertError.run(
        uploadId,
        error.rowNumber,
        error.column,
        error.code,
        error.message,
        error.rawText,
      );
    }
    return uploadId;
  }

  public async listUploads(filter: UploadHistoryFilter): Promise<UploadHistoryPage> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      clauses.push('u.status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      clauses.push("(u.file_name LIKE ? ESCAPE '\\' OR u.lot_code LIKE ? ESCAPE '\\')");
      const like = containsPattern(filter.search);
      params.push(like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM upload u ${where}`).get(...params) as { n: number }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT u.upload_id, u.file_name, d.code AS device_code, p.code AS test_program_code,
           u.lot_code, u.wafer_number, w.wafer_sequence, u.status, u.rows_read, u.rows_accepted, u.rows_rejected,
           usr.username AS submitted_by, u.submitted_at, u.terminal_message
         FROM upload u
         JOIN device d ON d.device_id = u.device_id
         JOIN test_program p ON p.test_program_id = u.test_program_id
         JOIN app_user usr ON usr.user_id = u.submitted_by_user_id
         LEFT JOIN wafer w ON w.upload_id = u.upload_id
         ${where}
         ORDER BY u.submitted_at DESC, u.upload_id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, (filter.page - 1) * filter.pageSize) as UploadRow[];

    return {
      items: rows.map(toUploadSummary),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
    };
  }

  public async getUpload(id: string): Promise<UploadSummary | null> {
    const row = this.db
      .prepare(
        `SELECT u.upload_id, u.file_name, d.code AS device_code, p.code AS test_program_code,
           u.lot_code, u.wafer_number, w.wafer_sequence, u.status, u.rows_read, u.rows_accepted, u.rows_rejected,
           usr.username AS submitted_by, u.submitted_at, u.terminal_message
         FROM upload u
         JOIN device d ON d.device_id = u.device_id
         JOIN test_program p ON p.test_program_id = u.test_program_id
         JOIN app_user usr ON usr.user_id = u.submitted_by_user_id
         LEFT JOIN wafer w ON w.upload_id = u.upload_id
         WHERE u.upload_id = ?`,
      )
      .get(id) as UploadRow | undefined;
    return row ? toUploadSummary(row) : null;
  }

  public async listUploadErrors(
    id: string,
    page: number,
    pageSize: number,
  ): Promise<UploadErrorPage | null> {
    const exists = this.db.prepare('SELECT 1 FROM upload WHERE upload_id = ?').get(id);
    if (!exists) return null;

    const total = (
      this.db.prepare('SELECT COUNT(*) AS n FROM upload_error WHERE upload_id = ?').get(id) as {
        n: number;
      }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT upload_error_id, row_number, column_name, error_code, error_message, raw_text
         FROM upload_error WHERE upload_id = ?
         ORDER BY row_number, upload_error_id LIMIT ? OFFSET ?`,
      )
      .all(id, pageSize, (page - 1) * pageSize) as UploadErrorRow[];

    return {
      items: rows.map((row) => ({
        id: row.upload_error_id,
        rowNumber: row.row_number,
        column: row.column_name,
        code: row.error_code,
        message: row.error_message,
        rawText: row.raw_text,
      })),
      page,
      pageSize,
      total,
    };
  }

  public async listWafers(filter: WaferListFilter): Promise<WaferPage> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.lot) {
      clauses.push("l.lot_code LIKE ? ESCAPE '\\'");
      params.push(containsPattern(filter.lot));
    }
    if (filter.device) {
      clauses.push("d.code LIKE ? ESCAPE '\\'");
      params.push(containsPattern(filter.device));
    }
    if (filter.program) {
      clauses.push("p.code LIKE ? ESCAPE '\\'");
      params.push(containsPattern(filter.program));
    }
    const search = filter.search?.trim();
    if (search) {
      const terms = [
        `l.lot_code LIKE ? ESCAPE '\\'`,
        `d.code LIKE ? ESCAPE '\\'`,
        `p.code LIKE ? ESCAPE '\\'`,
      ];
      const textPattern = containsPattern(search);
      params.push(textPattern, textPattern, textPattern);

      const sequenceMatch = /^#(\d+)$/u.exec(search);
      const waferMatch = /^(?:w|wafer)\s*0*(\d+)$/iu.exec(search);
      const numberMatch = /^(\d+)$/u.exec(search);
      if (sequenceMatch) {
        terms.push('w.wafer_sequence = ?');
        params.push(Number(sequenceMatch[1]));
      } else if (waferMatch) {
        terms.push('w.wafer_number = ?');
        params.push(Number(waferMatch[1]));
      } else if (numberMatch) {
        terms.push('w.wafer_sequence = ?', 'w.wafer_number = ?');
        params.push(Number(numberMatch[1]), Number(numberMatch[1]));
      }
      clauses.push(`(${terms.join(' OR ')})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM wafer w
         JOIN lot l ON l.lot_id = w.lot_id
         JOIN device d ON d.device_id = l.device_id
         JOIN test_program p ON p.test_program_id = w.test_program_id ${where}`,
        )
        .get(...params) as { n: number }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT w.wafer_sequence, l.lot_code, w.wafer_number, d.code AS device_code,
           p.code AS test_program_code, w.part_count, w.pass_count, w.yield, w.finish_time
         FROM wafer w
         JOIN lot l ON l.lot_id = w.lot_id
         JOIN device d ON d.device_id = l.device_id
         JOIN test_program p ON p.test_program_id = w.test_program_id
         ${where}
         ORDER BY w.finish_time DESC, w.wafer_sequence DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.pageSize, (filter.page - 1) * filter.pageSize) as WaferRow[];

    return { items: rows.map(toWaferSummary), page: filter.page, pageSize: filter.pageSize, total };
  }

  public async getWafer(waferSequence: number): Promise<WaferDetail | null> {
    const row = this.db
      .prepare(
        `SELECT w.wafer_sequence, l.lot_code, w.wafer_number, d.code AS device_code,
           p.code AS test_program_code, w.part_count, w.pass_count, w.yield, w.finish_time,
           w.upload_id
         FROM wafer w
         JOIN lot l ON l.lot_id = w.lot_id
         JOIN device d ON d.device_id = l.device_id
         JOIN test_program p ON p.test_program_id = w.test_program_id
         WHERE w.wafer_sequence = ?`,
      )
      .get(waferSequence) as WaferRow | undefined;
    if (!row) return null;

    const dies = this.db
      .prepare(
        `SELECT die_id, x, y, hard_bin, hard_bin_name, soft_bin, soft_bin_name, pass_fail_flag
         FROM die WHERE wafer_sequence = ? ORDER BY y, x, die_id`,
      )
      .all(waferSequence) as DieRow[];

    return { ...toWaferSummary(row), uploadId: row.upload_id, dies: dies.map(toDie) };
  }

  /**
   * Deletes one upload and everything it created — its wafer, that wafer's dies,
   * its validation rows, and the lot if no other wafer is left in it. Returns
   * false when the id is unknown so the route can answer 404.
   */
  public async deleteUpload(uploadId: string): Promise<boolean> {
    const exists = this.db.prepare('SELECT 1 FROM upload WHERE upload_id = ?').get(uploadId);
    if (!exists) return false;
    const lot = this.db.prepare('SELECT lot_id FROM wafer WHERE upload_id = ?').get(uploadId) as
      { lot_id: string } | undefined;
    this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM die WHERE wafer_sequence IN (SELECT wafer_sequence FROM wafer WHERE upload_id = ?)',
        )
        .run(uploadId);
      this.db.prepare('DELETE FROM wafer WHERE upload_id = ?').run(uploadId);
      this.db.prepare('DELETE FROM upload_error WHERE upload_id = ?').run(uploadId);
      this.db.prepare('DELETE FROM upload WHERE upload_id = ?').run(uploadId);
      if (lot) {
        this.db
          .prepare('DELETE FROM lot WHERE lot_id = ? AND lot_id NOT IN (SELECT lot_id FROM wafer)')
          .run(lot.lot_id);
      }
    })();
    return true;
  }

  public async listSampleUploads(): Promise<SampleUploadRow[]> {
    return this.db
      .prepare(
        `SELECT u.upload_id, u.lot_code, w.wafer_sequence
           FROM upload u LEFT JOIN wafer w ON w.upload_id = u.upload_id
          WHERE u.is_sample = 1`,
      )
      .all()
      .map((row) => {
        const typed = row as {
          upload_id: string;
          lot_code: string | null;
          wafer_sequence: number | null;
        };
        return {
          uploadId: typed.upload_id,
          lot: typed.lot_code,
          waferSequence: typed.wafer_sequence,
        };
      });
  }

  /**
   * Removes sample uploads for the named lots — or all of them when the list is
   * empty. Scoped by is_sample as well as by lot, so a user's own upload can
   * never be caught by it even if the lot codes were to collide.
   */
  public async removeSampleUploads(lots: string[]): Promise<number> {
    const rows = await this.listSampleUploads();
    const wanted =
      lots.length === 0 ? rows : rows.filter((row) => row.lot !== null && lots.includes(row.lot));
    let removed = 0;
    for (const row of wanted) {
      if (await this.deleteUpload(row.uploadId)) removed += 1;
    }
    return removed;
  }

  public isReady(): boolean {
    try {
      const required = [
        'app_user',
        'device',
        'test_program',
        'upload',
        'upload_error',
        'wafer',
        'die',
      ];
      const rows = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const available = new Set(rows.map((row) => row.name));
      return required.every((table) => available.has(table));
    } catch {
      return false;
    }
  }

  public close(): void {
    this.db.close();
  }
}
