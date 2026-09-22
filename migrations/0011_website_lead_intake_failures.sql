-- Durable recovery records for website leads that could not complete Jobber intake.
-- A scheduled retry/alert worker can claim these records after authorization is restored.
CREATE TABLE IF NOT EXISTS website_lead_intake_failures (
  submission_id TEXT PRIMARY KEY,
  market_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  error_code TEXT NOT NULL,
  error_status INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'retrying', 'resolved', 'manual_review', 'expired')),
  next_retry_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS website_lead_intake_failures_queue_idx
  ON website_lead_intake_failures (state, next_retry_at, expires_at);
