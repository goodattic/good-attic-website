-- Shadow-only qualified-phone call identity. No upload is enabled by this migration.
ALTER TABLE google_ads_outcome_outbox ADD COLUMN google_call_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS google_ads_outcome_outbox_google_call_key_idx
  ON google_ads_outcome_outbox(google_call_key)
  WHERE google_call_key IS NOT NULL;

-- Applied separately, never from /initialize. The deployment runner checks the
-- column first; the migration journal prevents repeating the ALTER statement.
CREATE TABLE IF NOT EXISTS qualified_phone_calls (
 google_resource TEXT PRIMARY KEY,
 market_key TEXT,
 google_call_json TEXT NOT NULL,
 outcome_id TEXT UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('held','excluded','ready','submitting','uploaded','failed','retryable')),
 diagnostic_code TEXT,
 attempt_count INTEGER NOT NULL DEFAULT 0,
 next_retry_at TEXT,
 http_status INTEGER,
 response_json TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS qualified_phone_runs (
 run_key TEXT PRIMARY KEY,
 started_at TEXT NOT NULL,
 completed_at TEXT,
 status TEXT NOT NULL,
 diagnostic_code TEXT
);
