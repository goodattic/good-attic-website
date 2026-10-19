-- Preserve the server-verified paid source before an STL form can use the
-- Website Jobber app during a Google app authorization outage. Once a Jobber
-- write starts, an uncertain result must be reconciled, never retried.
CREATE TABLE IF NOT EXISTS website_stl_google_source_proofs (
  submission_id TEXT PRIMARY KEY NOT NULL,
  source_lead_id TEXT NOT NULL UNIQUE,
  market_key TEXT NOT NULL CHECK (market_key = 'mo_stl'),
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

CREATE INDEX IF NOT EXISTS website_stl_google_source_proofs_request_idx
  ON website_stl_google_source_proofs (account_id, jobber_request_id)
  WHERE jobber_request_id IS NOT NULL;
