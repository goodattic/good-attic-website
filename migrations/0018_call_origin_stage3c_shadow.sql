-- Shadow only: no Google outbox, conversion action, or upload trigger.
CREATE TABLE IF NOT EXISTS call_origin_shadow_events (
  event_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  quo_call_id TEXT NOT NULL,
  original_request_id TEXT NOT NULL,
  operational_request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  call_started_at_utc TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('original_request', 'verified_lineage')),
  event_name TEXT NOT NULL CHECK (event_name IN (
    'appointment_set', 'assessment_completed', 'quote_approved', 'job_created'
  )),
  source_object_type TEXT NOT NULL CHECK (source_object_type IN ('request', 'quote', 'job')),
  source_object_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  assessment_id TEXT,
  quote_id TEXT,
  job_id TEXT,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS call_origin_shadow_events_call_idx
  ON call_origin_shadow_events(account_id, quo_call_id, occurred_at);
CREATE INDEX IF NOT EXISTS call_origin_shadow_events_request_idx
  ON call_origin_shadow_events(account_id, operational_request_id, event_name);
