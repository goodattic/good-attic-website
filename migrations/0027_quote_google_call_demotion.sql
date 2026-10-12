-- Preserve the paid campaign and proof of our write before attempting a
-- conservative correction when Google later demotes the call match.
ALTER TABLE quote_google_call_replays ADD COLUMN campaign_written TEXT;
ALTER TABLE quote_google_call_replays ADD COLUMN promotion_write_verified INTEGER NOT NULL DEFAULT 0
  CHECK (promotion_write_verified IN (0, 1));

CREATE TABLE IF NOT EXISTS quote_google_call_demotions (
  quote_id TEXT PRIMARY KEY,
  quo_call_id TEXT NOT NULL,
  google_resource TEXT NOT NULL,
  campaign_written TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'retryable', 'reverted', 'held')),
  diagnostic_code TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claim_expires_at INTEGER,
  next_attempt_at INTEGER,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS quote_google_call_demotions_state_idx
  ON quote_google_call_demotions (state, next_attempt_at, claim_expires_at);
