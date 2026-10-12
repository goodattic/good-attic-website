-- Shadow observations only. This table has no Google outbox or upload trigger.
CREATE TABLE IF NOT EXISTS invoice_lineage_shadow (
  account_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  invoice_client_id TEXT,
  job_id TEXT,
  quote_id TEXT,
  operational_request_id TEXT,
  invoice_status TEXT,
  invoice_total_micros INTEGER,
  payments_total_micros INTEGER,
  invoice_balance_micros INTEGER,
  jobber_updated_at TEXT,
  lineage_status TEXT NOT NULL CHECK (lineage_status IN ('resolved', 'held')),
  hold_reasons_json TEXT NOT NULL,
  call_origin_status TEXT NOT NULL CHECK (call_origin_status IN ('unassessed', 'resolved', 'not_call_origin', 'held')),
  call_origin_hold_reason TEXT,
  quo_call_id TEXT,
  original_request_id TEXT,
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS invoice_lineage_shadow_request_idx
  ON invoice_lineage_shadow(account_id, operational_request_id);
CREATE INDEX IF NOT EXISTS invoice_lineage_shadow_call_idx
  ON invoice_lineage_shadow(account_id, quo_call_id);

-- Each distinct provider observation is retained so later payments, refunds,
-- and link corrections can be compared with the earlier Jobber snapshot.
CREATE TABLE IF NOT EXISTS invoice_lineage_shadow_revisions (
  account_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, invoice_id, evidence_hash)
);
