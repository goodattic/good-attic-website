CREATE TABLE IF NOT EXISTS fieldflow_attribution_outbox (
  idempotency_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'failed_retryable',
      'sent',
      'needs_review'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS fieldflow_attribution_outbox_queue_idx
  ON fieldflow_attribution_outbox (
    status,
    next_attempt_at,
    created_at
  );
