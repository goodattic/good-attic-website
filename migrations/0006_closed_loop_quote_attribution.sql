-- Idempotent first-quote attribution checkpoints for Utah and St. Louis.
CREATE TABLE IF NOT EXISTS closed_loop_quote_attributions (
  quote_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  jobber_request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'applied', 'skipped', 'retryable', 'manual_review'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS closed_loop_quote_attributions_status_idx
  ON closed_loop_quote_attributions (status, updated_at);
