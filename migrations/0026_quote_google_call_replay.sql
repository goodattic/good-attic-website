-- Reconcile a call-origin Quote after a later unique Google forwarding call match.
-- This records only the bounded replay outcome; the original Quote checkpoint
-- remains intact for audit and first-write idempotency.
CREATE TABLE IF NOT EXISTS quote_google_call_replays (
  quote_id TEXT PRIMARY KEY,
  quo_call_id TEXT NOT NULL,
  google_resource TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'retryable', 'applied', 'held')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claim_expires_at INTEGER,
  next_attempt_at INTEGER,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS quote_google_call_replays_state_idx
  ON quote_google_call_replays (state, next_attempt_at, claim_expires_at);
CREATE INDEX IF NOT EXISTS closed_loop_quote_attributions_call_lead_idx
  ON closed_loop_quote_attributions (lead_id, status, created_at);
