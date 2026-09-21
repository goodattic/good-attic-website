-- Phase 2: dry-run Google Ads outcome watcher for Utah and St. Louis.
-- This table is an immutable/idempotent preparation ledger. It deliberately
-- has no upload trigger and no foreign-key dependency on mutable Jobber data.
CREATE TABLE IF NOT EXISTS google_ads_outcome_outbox (
  outcome_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (event_name IN (
    'qualified_lead', 'appointment_set', 'assessment_completed',
    'sold_job', 'revenue_restatement', 'cancellation'
  )),
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  attribution_path TEXT NOT NULL CHECK (attribution_path IN ('website', 'quo_call')),
  attribution_status TEXT NOT NULL DEFAULT 'pending' CHECK (attribution_status IN (
    'pending', 'google_matched', 'not_matched', 'ineligible', 'error'
  )),
  source_lead_id TEXT,
  submission_id TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  quo_call_id TEXT,
  caller_phone TEXT,
  call_started_at_original TEXT,
  call_started_at_utc TEXT,
  call_timezone TEXT,
  jobber_account_id TEXT,
  jobber_request_id TEXT,
  jobber_client_id TEXT,
  jobber_appointment_id TEXT,
  jobber_quote_id TEXT,
  jobber_job_id TEXT,
  jobber_invoice_id TEXT,
  google_account_id TEXT,
  google_conversion_action TEXT,
  milestone_at TEXT NOT NULL,
  conversion_at TEXT,
  value_micros INTEGER,
  currency_code TEXT CHECK (currency_code IS NULL OR currency_code = 'USD'),
  revenue_source TEXT,
  revenue_version TEXT,
  prior_reported_value_micros INTEGER,
  service_type TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN (
    'unknown', 'granted', 'denied'
  )),
  consent_evidence TEXT,
  upload_state TEXT NOT NULL DEFAULT 'held' CHECK (upload_state IN (
    'held', 'pending', 'validating', 'submitted', 'accepted', 'rejected',
    'retryable', 'permanently_failed', 'retracted'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  google_response_category TEXT,
  diagnostic_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS google_ads_outcome_outbox_status_idx
  ON google_ads_outcome_outbox(market_key, upload_state, updated_at);
CREATE INDEX IF NOT EXISTS google_ads_outcome_outbox_request_idx
  ON google_ads_outcome_outbox(jobber_request_id, event_name);
CREATE INDEX IF NOT EXISTS google_ads_outcome_outbox_call_idx
  ON google_ads_outcome_outbox(quo_call_id, event_name);
