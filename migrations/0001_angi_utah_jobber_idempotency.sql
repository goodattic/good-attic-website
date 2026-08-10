CREATE TABLE IF NOT EXISTS angi_utah_jobber_deliveries (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'processing',
      'client_creating',
      'client_created',
      'request_creating',
      'request_created',
      'note_creating',
      'completed',
      'failed_retryable',
      'needs_review'
    )
  ),
  payload_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  next_attempt_at INTEGER,
  lease_token TEXT,
  lease_expires_at INTEGER,
  client_id TEXT,
  property_id TEXT,
  request_id TEXT,
  note_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS angi_utah_jobber_deliveries_status_idx
  ON angi_utah_jobber_deliveries (status, updated_at);
