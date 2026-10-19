-- Separate call-origin lineage from website click attribution. Apply only after
-- the Jobber and Quo snapshots used to verify a link are read authoritatively.
CREATE TABLE IF NOT EXISTS call_request_lineage_links (
  account_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  original_request_id TEXT NOT NULL,
  operational_request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  call_started_at_utc TEXT NOT NULL,
  decision_id TEXT NOT NULL UNIQUE,
  verified_by TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (account_id, quo_call_id),
  UNIQUE (account_id, original_request_id),
  UNIQUE (account_id, operational_request_id),
  CHECK (original_request_id <> operational_request_id)
);

CREATE TABLE IF NOT EXISTS call_request_lineage_reviews (
  decision_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  original_request_id TEXT NOT NULL,
  candidate_request_ids_json TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('proposed', 'verified', 'manual_review', 'rejected')),
  reason TEXT NOT NULL,
  reviewed_by TEXT,
  evidence_ref TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS call_request_lineage_link_audit
AFTER INSERT ON call_request_lineage_links
BEGIN
  INSERT INTO call_request_lineage_reviews (
    decision_id, account_id, quo_call_id, original_request_id,
    candidate_request_ids_json, decision, reason, reviewed_by, evidence_ref, recorded_at
  ) VALUES (
    NEW.decision_id, NEW.account_id, NEW.quo_call_id, NEW.original_request_id,
    json_array(NEW.operational_request_id), 'verified', 'explicit_confirmation',
    NEW.verified_by, NEW.evidence_ref, NEW.verified_at
  );
END;

CREATE TRIGGER IF NOT EXISTS call_request_lineage_links_no_update
BEFORE UPDATE ON call_request_lineage_links BEGIN SELECT RAISE(ABORT, 'lineage_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS call_request_lineage_links_no_delete
BEFORE DELETE ON call_request_lineage_links BEGIN SELECT RAISE(ABORT, 'lineage_link_immutable'); END;
CREATE TRIGGER IF NOT EXISTS call_request_lineage_reviews_no_update
BEFORE UPDATE ON call_request_lineage_reviews BEGIN SELECT RAISE(ABORT, 'lineage_review_immutable'); END;
CREATE TRIGGER IF NOT EXISTS call_request_lineage_reviews_no_delete
BEFORE DELETE ON call_request_lineage_reviews BEGIN SELECT RAISE(ABORT, 'lineage_review_immutable'); END;
