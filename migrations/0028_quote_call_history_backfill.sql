-- Audit and lease for opt-in historical call-origin Quote attribution.
-- This does not enqueue Google uploads or change the Stage 1 shadow ledger.
CREATE TABLE IF NOT EXISTS quote_call_history_backfill (
  quote_id TEXT PRIMARY KEY,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  account_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'retryable', 'applied', 'held')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claim_expires_at INTEGER,
  next_attempt_at INTEGER,
  result_status TEXT,
  diagnostic_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS quote_call_history_backfill_pending_idx
  ON quote_call_history_backfill (state, next_attempt_at, claim_expires_at);
