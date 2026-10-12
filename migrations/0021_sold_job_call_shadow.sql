-- Shadow-only sold-job-from-call candidates. No outbox trigger or upload route.
-- Migration 0020_google_call_match_shadow.sql must be applied first.
CREATE TABLE IF NOT EXISTS sold_job_call_shadow_candidates (
  candidate_id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  quo_call_id TEXT NOT NULL,
  original_request_id TEXT NOT NULL,
  operational_request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  job_id TEXT,
  google_resource TEXT,
  quote_approved_at TEXT,
  value_micros INTEGER,
  google_conversion_action TEXT NOT NULL CHECK (google_conversion_action = '7788072382'),
  identity_verified INTEGER NOT NULL CHECK (identity_verified IN (0, 1)),
  consent_status TEXT NOT NULL CHECK (consent_status IN ('unknown', 'granted', 'denied')),
  state TEXT NOT NULL CHECK (state IN ('held', 'shadow_ready')),
  hold_reasons_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, quote_id, google_conversion_action),
  UNIQUE (account_id, quo_call_id, google_conversion_action)
);
CREATE INDEX IF NOT EXISTS sold_job_call_shadow_state_idx
  ON sold_job_call_shadow_candidates(state, updated_at);

-- Each distinct source snapshot is kept for review, even when a later scan
-- changes a held candidate into a shadow-ready one. Repeated scans dedupe.
CREATE TABLE IF NOT EXISTS sold_job_call_shadow_evidence (
  observation_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'shadow_ready')),
  hold_reasons_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  payload_json TEXT,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sold_job_call_shadow_evidence_candidate_idx
  ON sold_job_call_shadow_evidence(candidate_id, observed_at);
