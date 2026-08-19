-- practice-probe-db — SQLite schema for the lightweight wafer-analysis app.
-- Mirrors the columns/constraints of the real app's tables (migrations
-- 0001_foundation + 0002_wafer_ingest), trimmed to the single ingest→view
-- workflow.

CREATE TABLE IF NOT EXISTS app_user
(
    user_id      TEXT PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('viewer', 'dev', 'qa', 'admin')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facility
(
    facility_id TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_center
(
    work_center_id TEXT PRIMARY KEY,
    facility_id    TEXT NOT NULL,
    code           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    stage          TEXT NOT NULL CHECK (stage IN ('wafer-sort', 'final-test')),
    FOREIGN KEY (facility_id) REFERENCES facility(facility_id)
);

CREATE TABLE IF NOT EXISTS device
(
    device_id      TEXT PRIMARY KEY,
    work_center_id TEXT NOT NULL,
    code           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    FOREIGN KEY (work_center_id) REFERENCES work_center(work_center_id)
);

CREATE TABLE IF NOT EXISTS test_program
(
    test_program_id TEXT PRIMARY KEY,
    device_id        TEXT NOT NULL,
    code             TEXT NOT NULL,
    name             TEXT NOT NULL,
    UNIQUE (device_id, code),
    FOREIGN KEY (device_id) REFERENCES device(device_id)
);

CREATE TABLE IF NOT EXISTS lot
(
    lot_id     TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL,
    lot_code   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (device_id, lot_code),
    FOREIGN KEY (device_id) REFERENCES device(device_id)
);

CREATE TABLE IF NOT EXISTS upload
(
    upload_id             TEXT PRIMARY KEY,
    source_type           TEXT NOT NULL CHECK (source_type IN ('file', 'paste')),
    file_name             TEXT NOT NULL,
    content_type          TEXT NOT NULL,
    source_data           BLOB NOT NULL,
    source_byte_count     INTEGER NOT NULL,
    source_sha256         TEXT NOT NULL,
    device_id             TEXT NOT NULL,
    test_program_id       TEXT NOT NULL,
    submitted_by_user_id  TEXT NOT NULL,
    lot_code              TEXT,
    wafer_number          INTEGER,
    status                TEXT NOT NULL DEFAULT 'Queued'
        CHECK (status IN ('Queued', 'Parsing', 'Succeeded', 'Completed with errors', 'Rejected')),
    rows_read             INTEGER NOT NULL DEFAULT 0,
    rows_accepted         INTEGER NOT NULL DEFAULT 0,
    rows_rejected         INTEGER NOT NULL DEFAULT 0,
    terminal_message      TEXT,
    is_sample             INTEGER NOT NULL DEFAULT 0,
    submitted_at          TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at          TEXT,
    FOREIGN KEY (device_id) REFERENCES device(device_id),
    FOREIGN KEY (test_program_id) REFERENCES test_program(test_program_id),
    FOREIGN KEY (submitted_by_user_id) REFERENCES app_user(user_id),
    CHECK (wafer_number IS NULL OR (wafer_number BETWEEN 1 AND 9999)),
    CHECK (rows_read >= 0 AND rows_accepted >= 0 AND rows_rejected >= 0)
);

CREATE TABLE IF NOT EXISTS wafer
(
    wafer_sequence   INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id           TEXT NOT NULL,
    wafer_number     INTEGER NOT NULL,
    test_program_id  TEXT NOT NULL,
    upload_id        TEXT NOT NULL,
    part_count       INTEGER NOT NULL,
    pass_count       INTEGER NOT NULL,
    yield            REAL NOT NULL,
    finish_time      TEXT NOT NULL,
    UNIQUE (lot_id, wafer_number),
    UNIQUE (upload_id),
    CHECK (wafer_number BETWEEN 1 AND 9999),
    CHECK (part_count >= 0 AND pass_count >= 0 AND pass_count <= part_count),
    CHECK (yield >= 0 AND yield <= 100),
    FOREIGN KEY (lot_id) REFERENCES lot(lot_id),
    FOREIGN KEY (test_program_id) REFERENCES test_program(test_program_id),
    FOREIGN KEY (upload_id) REFERENCES upload(upload_id)
);

CREATE TABLE IF NOT EXISTS die
(
    die_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wafer_sequence  INTEGER NOT NULL,
    x               INTEGER NOT NULL,
    y               INTEGER NOT NULL,
    hard_bin        INTEGER NOT NULL,
    hard_bin_name   TEXT,
    soft_bin        INTEGER NOT NULL,
    soft_bin_name   TEXT,
    pass_fail_flag  TEXT NOT NULL CHECK (pass_fail_flag IN ('P', 'F')),
    UNIQUE (wafer_sequence, x, y),
    CHECK (x BETWEEN -32768 AND 32767),
    CHECK (y BETWEEN -32768 AND 32767),
    CHECK (hard_bin >= 0),
    CHECK (soft_bin >= 0),
    FOREIGN KEY (wafer_sequence) REFERENCES wafer(wafer_sequence) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS upload_error
(
    upload_error_id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id       TEXT NOT NULL,
    row_number      INTEGER NOT NULL,
    column_name     TEXT NOT NULL,
    error_code      TEXT NOT NULL,
    error_message   TEXT NOT NULL,
    raw_text        TEXT NOT NULL,
    CHECK (row_number > 0),
    FOREIGN KEY (upload_id) REFERENCES upload(upload_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upload_submitted ON upload(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_status ON upload(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_error_page ON upload_error(upload_id, row_number, upload_error_id);
CREATE INDEX IF NOT EXISTS idx_wafer_finish ON wafer(finish_time DESC, wafer_sequence DESC);
CREATE INDEX IF NOT EXISTS idx_die_wafer ON die(wafer_sequence);

-- Self-recorded PROBE assessment results, one current state per person and
-- assessment. The catalogue itself lives in code (shared/assessments.ts);
-- this table holds only what a person recorded about their own attempt.
CREATE TABLE IF NOT EXISTS assessment_result
(
    user_id       TEXT NOT NULL,
    assessment_id TEXT NOT NULL,
    outcome       TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
    attempts      INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
    -- The pull request the work was submitted through, so a result points at
    -- reviewable evidence instead of standing on its own word.
    evidence_url  TEXT,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, assessment_id),
    FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE CASCADE
);
