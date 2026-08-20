import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

import {
  userRoles,
  type DieCoordinateFrame,
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
import { parseWaferAtdf } from './wafer-atdf.js';
import type { UploadParseResult, UploadValidationError, ParsedDie } from './wafer-upload.js';

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
  listAssessmentResults(userId: string): Promise<AssessmentResultRow[]>;
  listAllAssessmentResults(): Promise<AssessmentStandingRow[]>;
  recordAssessmentResult(
    userId: string,
    assessmentId: string,
    outcome: 'passed' | 'failed',
    evidenceUrl: string | null,
  ): Promise<void>;
  clearAssessmentResult(userId: string, assessmentId: string): Promise<boolean>;
}

/** One person's current state on one assessment. */
export interface AssessmentResultRow {
  assessmentId: string;
  outcome: 'passed' | 'failed';
  attempts: number;
  /** The pull request the work was submitted through, when one was recorded. */
  evidenceUrl: string | null;
  updatedAt: string;
}

/** A result joined to its owner, for the team standings. */
export interface AssessmentStandingRow extends AssessmentResultRow {
  username: string;
  role: string;
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
  positive_x: string | null;
  positive_y: string | null;
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

/**
 * A stored frame is text, so it is validated on the way out rather than cast:
 * a row written before the columns existed, or by hand, reads as undeclared.
 */
function toCoordinateFrame(row: WaferRow): DieCoordinateFrame {
  return {
    positiveX: row.positive_x === 'left' || row.positive_x === 'right' ? row.positive_x : null,
    positiveY: row.positive_y === 'up' || row.positive_y === 'down' ? row.positive_y : null,
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
    /* A wafer landed before the coordinate frame was carried has no columns to
       read it from, and its map would 500 rather than fall back. Both stay
       nullable, so existing rows read as "the file declared no frame" — which
       is what the app knew about them. */
    const waferColumns = this.db.prepare('PRAGMA table_info(wafer)').all() as Array<{
      name: string;
    }>;
    if (waferColumns.length > 0 && !waferColumns.some((column) => column.name === 'positive_x')) {
      this.db.exec(
        `ALTER TABLE wafer ADD COLUMN positive_x TEXT
           CHECK (positive_x IS NULL OR positive_x IN ('left', 'right'))`,
      );
      this.db.exec(
        `ALTER TABLE wafer ADD COLUMN positive_y TEXT
           CHECK (positive_y IS NULL OR positive_y IN ('up', 'down'))`,
      );
      this.backfillCoordinateFrames();
    }
    this.assertWaferRangesAreCurrent();
    /* A database created before assessments existed, opened by `npm run dev`
       (which skips setup), would otherwise 500 on the first assessments read. */
    this.db.exec(`CREATE TABLE IF NOT EXISTS assessment_result
      (
          user_id       TEXT NOT NULL,
          assessment_id TEXT NOT NULL,
          outcome       TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
          attempts      INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
          evidence_url  TEXT,
          updated_at    TEXT NOT NULL,
          PRIMARY KEY (user_id, assessment_id),
          FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE CASCADE
      )`);
    /* Same self-heal as is_sample above: IF NOT EXISTS skips a table created by
       an earlier version, so a column added later must be checked for by name. */
    const resultColumns = this.db.prepare('PRAGMA table_info(assessment_result)').all() as Array<{
      name: string;
    }>;
    if (
      resultColumns.length > 0 &&
      !resultColumns.some((column) => column.name === 'evidence_url')
    ) {
      this.db.exec('ALTER TABLE assessment_result ADD COLUMN evidence_url TEXT');
    }
  }

  /**
   * A wafer that landed before the frame was carried would keep drawing
   * mirrored until somebody re-uploaded its file — which is the defect, not a
   * fix. The upload's bytes are retained, so the frame is recovered from the
   * file that landed it: the ATDF reader refuses anything that is not an ATDF,
   * so a CSV upload simply stays undeclared.
   *
   * Runs once, in the same step that adds the columns. A single unreadable blob
   * must not stop the application from opening, so each is attempted alone.
   */
  private backfillCoordinateFrames(): void {
    const rows = this.db
      .prepare(
        `SELECT w.wafer_sequence, u.source_data
         FROM wafer w JOIN upload u ON u.upload_id = w.upload_id`,
      )
      .all() as Array<{ wafer_sequence: number; source_data: Buffer }>;
    const update = this.db.prepare(
      'UPDATE wafer SET positive_x = ?, positive_y = ? WHERE wafer_sequence = ?',
    );
    for (const row of rows) {
      try {
        const parsed = parseWaferAtdf(row.source_data);
        if (parsed.kind !== 'ready') continue;
        if (parsed.positiveX === null && parsed.positiveY === null) continue;
        update.run(parsed.positiveX, parsed.positiveY, row.wafer_sequence);
      } catch {
        // An unreadable stored file leaves that wafer undeclared, as before.
        continue;
      }
    }
  }

  /**
   * ATDF support widened wafer numbers past 25 and made die coordinates signed.
   * SQLite cannot alter a CHECK constraint in place, so a database created under
   * the old limits would reject valid wafer files with a confusing row error.
   * The practice database is disposable, so refuse to open plainly rather than
   * rebuild the tables underneath someone.
   */
  private assertWaferRangesAreCurrent(): void {
    const stale = this.db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('die', 'wafer')
           AND (sql LIKE '%BETWEEN 0 AND 99%' OR sql LIKE '%BETWEEN 1 AND 25%')
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    if (stale.length === 0) return;
    throw new Error(
      `Table${stale.length > 1 ? 's' : ''} ${stale.map((row) => row.name).join(' and ')} still ` +
        'carry the pre-ATDF wafer and coordinate limits. Delete ' +
        'data/practice-probe-db.sqlite* and run `npm run setup` to recreate the database.',
    );
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

  /**
   * A JWT names its user by id. When that row is gone — most often because the
   * database was re-seeded while a token was still inside its eight-hour life —
   * the insert would fail on the app_user foreign key and surface as a 500. Answer
   * 401 instead, which the web client turns into a fresh sign-in.
   */
  private assertSubmitterExists(userId: string): void {
    const row = this.db
      .prepare('SELECT 1 AS present FROM app_user WHERE user_id = ?')
      .get(userId) as { present: number } | undefined;
    if (!row) {
      throw apiError(
        401,
        'UNAUTHORIZED',
        'Your session refers to a user that no longer exists. Sign in again.',
      );
    }
  }

  public async saveUpload(input: SaveUploadInput): Promise<string> {
    this.assertSubmitterExists(input.submittedByUserId);
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
    for (const input of inputs) this.assertSubmitterExists(input.submittedByUserId);
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
             pass_count, yield, finish_time, positive_x, positive_y)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          parsed.positiveX,
          parsed.positiveY,
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
           w.upload_id, w.positive_x, w.positive_y
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

    return {
      ...toWaferSummary(row),
      ...toCoordinateFrame(row),
      uploadId: row.upload_id,
      dies: dies.map(toDie),
    };
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

  public async listAssessmentResults(userId: string): Promise<AssessmentResultRow[]> {
    return this.db
      .prepare(
        `SELECT assessment_id, outcome, attempts, evidence_url, updated_at
           FROM assessment_result WHERE user_id = ?`,
      )
      .all(userId)
      .map((row) => {
        const typed = row as {
          assessment_id: string;
          outcome: 'passed' | 'failed';
          attempts: number;
          evidence_url: string | null;
          updated_at: string;
        };
        return {
          assessmentId: typed.assessment_id,
          outcome: typed.outcome,
          attempts: typed.attempts,
          evidenceUrl: typed.evidence_url,
          updatedAt: typed.updated_at,
        };
      });
  }

  public async listAllAssessmentResults(): Promise<AssessmentStandingRow[]> {
    return this.db
      .prepare(
        `SELECT u.username, u.role, r.assessment_id, r.outcome, r.attempts,
                r.evidence_url, r.updated_at
           FROM assessment_result r
           JOIN app_user u ON u.user_id = r.user_id
          ORDER BY u.username`,
      )
      .all()
      .map((row) => {
        const typed = row as {
          username: string;
          role: string;
          assessment_id: string;
          outcome: 'passed' | 'failed';
          attempts: number;
          evidence_url: string | null;
          updated_at: string;
        };
        return {
          username: typed.username,
          role: typed.role,
          assessmentId: typed.assessment_id,
          outcome: typed.outcome,
          attempts: typed.attempts,
          evidenceUrl: typed.evidence_url,
          updatedAt: typed.updated_at,
        };
      });
  }

  public async recordAssessmentResult(
    userId: string,
    assessmentId: string,
    outcome: 'passed' | 'failed',
    evidenceUrl: string | null,
  ): Promise<void> {
    /* Re-recording replaces the state and counts the attempt — the row is the
       person's current word on the assessment, not a history. A re-record that
       omits the link keeps the previous one: forgetting to re-paste a PR URL
       should not erase the evidence. */
    this.db
      .prepare(
        `INSERT INTO assessment_result
           (user_id, assessment_id, outcome, attempts, evidence_url, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (user_id, assessment_id)
         DO UPDATE SET outcome = excluded.outcome,
                       attempts = attempts + 1,
                       evidence_url = COALESCE(excluded.evidence_url, evidence_url),
                       updated_at = excluded.updated_at`,
      )
      .run(userId, assessmentId, outcome, evidenceUrl, new Date().toISOString());
  }

  public async clearAssessmentResult(userId: string, assessmentId: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM assessment_result WHERE user_id = ? AND assessment_id = ?')
      .run(userId, assessmentId);
    return result.changes > 0;
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
