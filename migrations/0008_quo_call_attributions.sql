-- Phase 1 only: durable, Google-disabled call evidence for Utah and St. Louis.
-- The Quo call ID is the permanent external identity. This record is separate
-- from the phone guard: later distinct calls must remain attributable even when
-- the intake flow correctly suppresses a second Jobber Request.
CREATE TABLE IF NOT EXISTS quo_call_attributions (
  attribution_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('utah','stl')),
  phone_number_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  caller_phone TEXT NOT NULL,
  call_started_at_original TEXT NOT NULL,
  call_started_at_utc TEXT NOT NULL,
  destination_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction = 'incoming'),
  final_status TEXT NOT NULL,
  duration_seconds INTEGER,
  first_time_caller_status TEXT,
  jobber_request_id TEXT,
  jobber_client_id TEXT,
  quote_id TEXT,
  job_id TEXT,
  invoice_id TEXT,
  attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','google_matched','not_matched','ineligible','error')),
  google_upload_status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (google_upload_status = 'not_submitted'),
  google_upload_http_status INTEGER,
  google_upload_diagnostic TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (consent_status = 'unknown'),
  consent_evidence TEXT,
  source_event_id TEXT NOT NULL,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, quo_call_id)
);

CREATE INDEX IF NOT EXISTS quo_call_attributions_request_idx
  ON quo_call_attributions(account_id, jobber_request_id);
CREATE INDEX IF NOT EXISTS quo_call_attributions_status_idx
  ON quo_call_attributions(market, attribution_status, updated_at);
