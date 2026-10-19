-- Preserve the server-verified paid source before a KC form can use the
-- Website Jobber app during a Google app authorization outage. A write_started
-- row is an idempotency fence: it must be reconciled, never automatically
-- replayed as a second Jobber Client or Request.
CREATE TABLE IF NOT EXISTS website_google_source_proofs (
  submission_id TEXT PRIMARY KEY NOT NULL,
  source_lead_id TEXT NOT NULL UNIQUE,
  market_key TEXT NOT NULL CHECK (market_key = 'mo_kc'),
  account_id TEXT NOT NULL,
  source_key TEXT NOT NULL CHECK (source_key = 'google'),
  source_detail TEXT NOT NULL CHECK (source_detail = 'google_ads'),
  source_reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'write_started', 'completed')),
  jobber_source_app TEXT CHECK (jobber_source_app IN ('google', 'website')),
  fallback_reason TEXT,
  jobber_request_id TEXT UNIQUE,
  jobber_client_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state <> 'completed' OR
    (jobber_source_app IS NOT NULL AND jobber_request_id IS NOT NULL AND jobber_client_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS website_google_source_proofs_request_idx
  ON website_google_source_proofs (account_id, jobber_request_id)
  WHERE jobber_request_id IS NOT NULL;

-- Manual, read-only-first reconciliation of historic failed submissions.
-- No code path consumes this table to create or retry a Jobber Request.
-- Unknown click/UTM evidence stays explicitly unavailable; never infer it
-- from a manually created Client or Request.
CREATE TABLE IF NOT EXISTS website_lead_intake_reconciliations (
  submission_id TEXT PRIMARY KEY NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  source_key TEXT NOT NULL CHECK (source_key IN ('google', 'website')),
  disposition TEXT NOT NULL CHECK (disposition IN
    ('matched_existing', 'recovered_new', 'not_found', 'duplicate', 'deferred')),
  jobber_account_id TEXT,
  jobber_client_id TEXT,
  jobber_request_id TEXT,
  click_evidence TEXT NOT NULL CHECK (click_evidence IN
    ('verified_original', 'unavailable')),
  evidence_provenance TEXT NOT NULL CHECK (evidence_provenance IN
    ('original_form_payload', 'jobber_live_reconciliation', 'manual_review')),
  evidence_note TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CHECK (disposition NOT IN ('matched_existing', 'recovered_new') OR
    (jobber_account_id IS NOT NULL AND jobber_client_id IS NOT NULL AND jobber_request_id IS NOT NULL)),
  CHECK (click_evidence <> 'unavailable' OR evidence_note <> '')
);
