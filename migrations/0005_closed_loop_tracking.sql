-- Durable, consent-aware attribution and lifecycle ledger for Utah and St. Louis.
-- Apply to the existing ANGI_ROUTER_DB only after preview tests pass.

CREATE TABLE IF NOT EXISTS closed_loop_leads (
  lead_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
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

CREATE INDEX IF NOT EXISTS closed_loop_leads_market_source
  ON closed_loop_leads (market_key, original_source, inquiry_at);
CREATE INDEX IF NOT EXISTS closed_loop_leads_gclid
  ON closed_loop_leads (gclid) WHERE gclid IS NOT NULL;

CREATE TABLE IF NOT EXISTS closed_loop_events (
  event_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  event_name TEXT NOT NULL CHECK (event_name IN (
    'raw_inquiry',
    'qualified_lead',
    'appointment_set',
    'assessment_completed',
    'quote_approved',
    'sold_job'
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
  FOREIGN KEY (lead_id) REFERENCES closed_loop_leads (lead_id)
);

CREATE INDEX IF NOT EXISTS closed_loop_events_upload_queue
  ON closed_loop_events (upload_status, occurred_at);
CREATE INDEX IF NOT EXISTS closed_loop_events_lead
  ON closed_loop_events (lead_id, event_name, occurred_at);

CREATE TABLE IF NOT EXISTS closed_loop_reconciliation (
  reconciliation_date TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  metric_name TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  destination_count INTEGER NOT NULL,
  difference_count INTEGER NOT NULL,
  difference_rate REAL NOT NULL,
  alert_status TEXT NOT NULL CHECK (alert_status IN ('ok', 'warning', 'critical')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (reconciliation_date, market_key, metric_name)
);
