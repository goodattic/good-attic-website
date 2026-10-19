-- Read-only Google call_view / Quo evidence. No conversion action or upload path.
CREATE TABLE IF NOT EXISTS google_call_match_shadow (
  google_resource TEXT PRIMARY KEY,
  campaign_id TEXT,
  campaign_name TEXT,
  market_key TEXT,
  call_started_at_original TEXT,
  call_started_at_utc TEXT,
  call_duration_seconds INTEGER,
  caller_area_code TEXT,
  call_status TEXT,
  match_state TEXT NOT NULL CHECK (match_state IN ('matched', 'held')),
  diagnostic_code TEXT,
  quo_call_id TEXT,
  match_delta_seconds REAL,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  CHECK ((match_state = 'matched' AND quo_call_id IS NOT NULL AND diagnostic_code IS NULL)
    OR (match_state = 'held' AND quo_call_id IS NULL AND diagnostic_code IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS google_call_match_shadow_unique_quo
  ON google_call_match_shadow(quo_call_id) WHERE match_state = 'matched';
CREATE INDEX IF NOT EXISTS google_call_match_shadow_state_idx
  ON google_call_match_shadow(match_state, market_key, last_checked_at);

CREATE TABLE IF NOT EXISTS google_call_match_shadow_checks (
  check_id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL,
  google_resource TEXT NOT NULL,
  match_state TEXT NOT NULL CHECK (match_state IN ('matched', 'held')),
  diagnostic_code TEXT,
  quo_call_id TEXT,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS google_call_match_shadow_checks_resource_idx
  ON google_call_match_shadow_checks(google_resource, checked_at);

CREATE TABLE IF NOT EXISTS google_call_match_shadow_runs (
  run_key TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  google_calls INTEGER,
  matched INTEGER,
  held INTEGER,
  diagnostic_code TEXT
);
