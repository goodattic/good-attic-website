-- Server-classified KC non-paid website source, recorded before any Jobber
-- write. A completed attestation is separate from the paid Google proof and
-- cannot be inferred from its absence. Quote fields still require the exact
-- completed form transaction and website acknowledgement receipt.
CREATE TABLE IF NOT EXISTS kc_website_nonpaid_source_attestations (
  submission_id TEXT PRIMARY KEY NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key = 'mo_kc'),
  source_key TEXT NOT NULL CHECK (source_key = 'website'),
  source_label TEXT NOT NULL CHECK (source_label = 'Organic Online'),
  source_detail TEXT NOT NULL CHECK (source_detail IN ('organic_online', 'ai_referral')),
  source_reason TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'completed')),
  account_id TEXT NOT NULL,
  jobber_request_id TEXT UNIQUE,
  jobber_client_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state <> 'completed' OR
    (jobber_request_id IS NOT NULL AND jobber_client_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS kc_website_nonpaid_source_request_idx
  ON kc_website_nonpaid_source_attestations (account_id, jobber_request_id)
  WHERE jobber_request_id IS NOT NULL;

-- The two source classes are mutually exclusive even when concurrent intake
-- requests pass an application-level read at the same time.
CREATE TRIGGER IF NOT EXISTS kc_nonpaid_reject_existing_paid
BEFORE INSERT ON kc_website_nonpaid_source_attestations
WHEN EXISTS (SELECT 1 FROM website_google_source_proofs
  WHERE submission_id = NEW.submission_id)
BEGIN
  SELECT RAISE(ABORT, 'kc_source_conflict');
END;

CREATE TRIGGER IF NOT EXISTS kc_paid_reject_existing_nonpaid
BEFORE INSERT ON website_google_source_proofs
WHEN EXISTS (SELECT 1 FROM kc_website_nonpaid_source_attestations
  WHERE submission_id = NEW.submission_id)
BEGIN
  SELECT RAISE(ABORT, 'kc_source_conflict');
END;
