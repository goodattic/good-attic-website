-- Admit proof-backed Kansas City website leads and Quote checkpoints to the
-- local closed-loop ledger. Existing Utah and St. Louis rows, claims, and
-- indexes are copied intact. D1 applies each migration atomically; do not add
-- BEGIN/COMMIT, which conflict with D1's implicit migration transaction.
-- Deploy the KC source-proof upload gate in the Stage 3c Worker before this
-- migration admits KC leads. Stage 3c discovers candidates from this table.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE closed_loop_leads_kc (
  lead_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  jobber_account_id TEXT,
  jobber_request_id TEXT NOT NULL UNIQUE,
  jobber_client_id TEXT,
  original_source TEXT NOT NULL,
  source_detail TEXT,
  campaign TEXT,
  service TEXT,
  landing_page TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  consent_state TEXT,
  inquiry_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO closed_loop_leads_kc (
  lead_id, submission_id, market_key, jobber_account_id,
  jobber_request_id, jobber_client_id, original_source, source_detail,
  campaign, service, landing_page, gclid, gbraid, wbraid,
  consent_state, inquiry_at, created_at, updated_at
) SELECT
  lead_id, submission_id, market_key, jobber_account_id,
  jobber_request_id, jobber_client_id, original_source, source_detail,
  campaign, service, landing_page, gclid, gbraid, wbraid,
  consent_state, inquiry_at, created_at, updated_at
FROM closed_loop_leads;

CREATE TABLE closed_loop_events_kc (
  event_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  event_name TEXT NOT NULL CHECK (event_name IN (
    'raw_inquiry', 'qualified_lead', 'appointment_set',
    'assessment_completed', 'quote_approved', 'sold_job'
  )),
  jobber_object_type TEXT,
  jobber_object_id TEXT,
  occurred_at TEXT NOT NULL,
  value_micros INTEGER,
  currency_code TEXT,
  google_conversion_action TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN (
    'pending', 'held', 'uploaded', 'retryable', 'manual_review', 'not_eligible'
  )),
  upload_attempts INTEGER NOT NULL DEFAULT 0,
  google_upload_at TEXT,
  google_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES closed_loop_leads_kc (lead_id)
);
INSERT INTO closed_loop_events_kc (
  event_id, lead_id, market_key, event_name, jobber_object_type,
  jobber_object_id, occurred_at, value_micros, currency_code,
  google_conversion_action, upload_status, upload_attempts,
  google_upload_at, google_error_code, created_at, updated_at
) SELECT
  event_id, lead_id, market_key, event_name, jobber_object_type,
  jobber_object_id, occurred_at, value_micros, currency_code,
  google_conversion_action, upload_status, upload_attempts,
  google_upload_at, google_error_code, created_at, updated_at
FROM closed_loop_events;

-- Drop the old child before the old parent. SQLite updates the new child's
-- foreign key when the new parent is renamed below.
DROP TABLE closed_loop_events;
DROP TABLE closed_loop_leads;
ALTER TABLE closed_loop_leads_kc RENAME TO closed_loop_leads;
ALTER TABLE closed_loop_events_kc RENAME TO closed_loop_events;

CREATE INDEX closed_loop_leads_market_source
  ON closed_loop_leads (market_key, original_source, inquiry_at);
CREATE INDEX closed_loop_leads_gclid
  ON closed_loop_leads (gclid) WHERE gclid IS NOT NULL;
CREATE INDEX closed_loop_events_upload_queue
  ON closed_loop_events (upload_status, occurred_at);
CREATE INDEX closed_loop_events_lead
  ON closed_loop_events (lead_id, event_name, occurred_at);

CREATE TABLE closed_loop_reconciliation_kc (
  reconciliation_date TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  metric_name TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  destination_count INTEGER NOT NULL,
  difference_count INTEGER NOT NULL,
  difference_rate REAL NOT NULL,
  alert_status TEXT NOT NULL CHECK (alert_status IN ('ok', 'warning', 'critical')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (reconciliation_date, market_key, metric_name)
);
INSERT INTO closed_loop_reconciliation_kc (
  reconciliation_date, market_key, metric_name, source_count,
  destination_count, difference_count, difference_rate,
  alert_status, created_at
) SELECT
  reconciliation_date, market_key, metric_name, source_count,
  destination_count, difference_count, difference_rate,
  alert_status, created_at
FROM closed_loop_reconciliation;
DROP TABLE closed_loop_reconciliation;
ALTER TABLE closed_loop_reconciliation_kc RENAME TO closed_loop_reconciliation;

CREATE TABLE closed_loop_quote_attributions_kc (
  quote_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  jobber_request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'applied', 'skipped', 'retryable', 'manual_review'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  claim_token TEXT,
  claim_expires_at INTEGER
);
INSERT INTO closed_loop_quote_attributions_kc (
  quote_id, lead_id, market_key, jobber_request_id, status,
  attempt_count, last_error_code, created_at, updated_at,
  completed_at, claim_token, claim_expires_at
) SELECT
  quote_id, lead_id, market_key, jobber_request_id, status,
  attempt_count, last_error_code, created_at, updated_at,
  completed_at, claim_token, claim_expires_at
FROM closed_loop_quote_attributions;
DROP TABLE closed_loop_quote_attributions;
ALTER TABLE closed_loop_quote_attributions_kc RENAME TO closed_loop_quote_attributions;
CREATE INDEX closed_loop_quote_attributions_status_idx
  ON closed_loop_quote_attributions (status, updated_at);
CREATE INDEX closed_loop_quote_attributions_claim_idx
  ON closed_loop_quote_attributions (quote_id, claim_token, claim_expires_at);
CREATE INDEX closed_loop_quote_attributions_call_lead_idx
  ON closed_loop_quote_attributions (lead_id, status, created_at);
