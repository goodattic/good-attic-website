-- Additive capture-first ledger. The existing Pages broker remains the sole
-- writer of quo_call_attributions while automatic call Requests are enabled.
-- Canonical Quo evidence is kept here until a separately reviewed cutover.
CREATE TABLE IF NOT EXISTS quo_call_capture_stage (
  account_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('utah','stl','kc')),
  phone_number_id TEXT NOT NULL,
  caller_phone TEXT NOT NULL,
  call_started_at_original TEXT NOT NULL,
  call_started_at_utc TEXT NOT NULL,
  destination_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction = 'incoming'),
  final_status TEXT NOT NULL,
  duration_seconds INTEGER,
  answered_at TEXT,
  first_time_caller_status TEXT,
  source_event_id TEXT NOT NULL,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merged_at TEXT,
  hold_reason TEXT,
  UNIQUE (account_id, quo_call_id)
);

CREATE INDEX IF NOT EXISTS quo_call_capture_stage_caller_idx
  ON quo_call_capture_stage(market, caller_phone, call_started_at_utc);
