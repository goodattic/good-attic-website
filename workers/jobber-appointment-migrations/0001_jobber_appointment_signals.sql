CREATE TABLE IF NOT EXISTS jobber_appointment_signals (
  event_id TEXT PRIMARY KEY,
  jobber_account_id TEXT NOT NULL,
  jobber_assessment_id TEXT NOT NULL,
  market_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'not_scheduled', 'failed_retryable', 'delivered')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS jobber_appointment_signals_object_idx
  ON jobber_appointment_signals (jobber_account_id, jobber_assessment_id);

CREATE INDEX IF NOT EXISTS jobber_appointment_signals_status_idx
  ON jobber_appointment_signals (status, lease_expires_at, updated_at);
