CREATE TABLE IF NOT EXISTS closed_loop_google_uploads (
 event_id TEXT PRIMARY KEY, market_key TEXT NOT NULL, action_id TEXT NOT NULL,
 status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
 auto_retry INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT,
 claimed_at TEXT NOT NULL, submitted_at TEXT, completed_at TEXT,
 request_json TEXT NOT NULL, request_id TEXT, http_status INTEGER, response_raw TEXT,
 diagnostics_status INTEGER, diagnostics_raw TEXT, diagnostics_at TEXT, next_diagnostics_at TEXT,
 error_category TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS closed_loop_google_upload_attempts (
 event_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, started_at TEXT NOT NULL,
 request_json TEXT NOT NULL, request_id TEXT, http_status INTEGER, response_raw TEXT,
 PRIMARY KEY(event_id,attempt_number)
);
CREATE TABLE IF NOT EXISTS closed_loop_google_diagnostics (
 event_id TEXT NOT NULL, request_id TEXT NOT NULL, checked_at TEXT NOT NULL,
 http_status INTEGER NOT NULL, response_raw TEXT NOT NULL,
 PRIMARY KEY(event_id,request_id,checked_at)
);
CREATE INDEX IF NOT EXISTS google_diagnostics_due ON closed_loop_google_uploads(next_diagnostics_at);
