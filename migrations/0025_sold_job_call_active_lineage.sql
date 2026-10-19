-- Rebuild the shadow projection so a corrected call can have a new Quote.
-- The append-only evidence table retains every prior candidate snapshot.
ALTER TABLE sold_job_call_shadow_candidates RENAME TO sold_job_call_shadow_candidates_v1;
CREATE TABLE sold_job_call_shadow_candidates (
  candidate_id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  quo_call_id TEXT NOT NULL,
  original_request_id TEXT NOT NULL,
  operational_request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  job_id TEXT,
  google_resource TEXT,
  quote_approved_at TEXT,
  value_micros INTEGER,
  google_conversion_action TEXT NOT NULL CHECK (google_conversion_action = '7788072382'),
  identity_verified INTEGER NOT NULL CHECK (identity_verified IN (0, 1)),
  consent_status TEXT NOT NULL CHECK (consent_status IN ('unknown', 'granted', 'denied')),
  state TEXT NOT NULL CHECK (state IN ('held', 'shadow_ready')),
  hold_reasons_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, quote_id, google_conversion_action)
);
INSERT INTO sold_job_call_shadow_candidates SELECT * FROM sold_job_call_shadow_candidates_v1;
DROP TABLE sold_job_call_shadow_candidates_v1;
CREATE INDEX sold_job_call_shadow_state_idx
  ON sold_job_call_shadow_candidates(state, updated_at);
CREATE INDEX sold_job_call_shadow_call_idx
  ON sold_job_call_shadow_candidates(account_id, quo_call_id, google_conversion_action);

-- This is the only shadow view a future sender may consider. An active lineage
-- correction, demoted Google match, competing Quote, or late website click
-- removes a row immediately, before another collector pass can run.
CREATE VIEW IF NOT EXISTS sold_job_call_shadow_current_ready AS
  SELECT c.* FROM sold_job_call_shadow_candidates c
  JOIN call_origin_shadow_current_events e ON e.event_id = c.source_event_id
    AND e.account_id = c.account_id AND e.quo_call_id = c.quo_call_id
    AND e.market_key = c.market_key AND e.client_id = c.client_id
    AND e.original_request_id = c.original_request_id
    AND e.operational_request_id = c.operational_request_id
    AND e.quote_id = c.quote_id
  JOIN google_call_match_shadow g ON g.google_resource = c.google_resource
    AND g.match_state = 'matched' AND g.quo_call_id = c.quo_call_id
    AND g.market_key = c.market_key
  WHERE c.state = 'shadow_ready' AND c.identity_verified = 1
    AND c.consent_status = 'granted' AND c.payload_json IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM closed_loop_stage1_leads l
      WHERE l.market_key = c.market_key
        AND l.request_id IN (c.original_request_id, c.operational_request_id)
        AND (LENGTH(TRIM(COALESCE(l.gclid, ''))) > 0
          OR LENGTH(TRIM(COALESCE(l.gbraid, ''))) > 0
          OR LENGTH(TRIM(COALESCE(l.wbraid, ''))) > 0)
    )
    AND (SELECT COUNT(*) FROM call_origin_shadow_current_events other
      WHERE other.account_id = c.account_id AND other.quo_call_id = c.quo_call_id
        AND other.event_name = 'quote_approved') = 1;

-- Existing rows may predate migration 0022 and its active-event view.
INSERT OR IGNORE INTO sold_job_call_shadow_evidence
  (observation_id, candidate_id, source_event_id, state, hold_reasons_json,
   evidence_json, payload_json, observed_at)
  SELECT 'lineage-reconciliation:' || c.candidate_id, c.candidate_id,
    c.source_event_id, 'held', '["lineage_not_current"]',
    json_set(c.evidence_json, '$.lineage_reconciliation', '0025'), NULL,
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM sold_job_call_shadow_candidates c
  WHERE NOT EXISTS (SELECT 1 FROM call_origin_shadow_current_events e
    WHERE e.event_id = c.source_event_id);
UPDATE sold_job_call_shadow_candidates
  SET state = 'held', hold_reasons_json = '["lineage_not_current"]',
    evidence_json = json_set(evidence_json, '$.lineage_reconciliation', '0025'),
    payload_json = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE NOT EXISTS (SELECT 1 FROM call_origin_shadow_current_events e
    WHERE e.event_id = sold_job_call_shadow_candidates.source_event_id);

-- A newly verified replacement makes any prior direct-Request candidate stale.
CREATE TRIGGER IF NOT EXISTS sold_job_call_shadow_on_base_link
AFTER INSERT ON call_request_lineage_links
BEGIN
  INSERT OR IGNORE INTO sold_job_call_shadow_evidence
    (observation_id, candidate_id, source_event_id, state, hold_reasons_json,
     evidence_json, payload_json, observed_at)
    SELECT 'lineage-link:' || NEW.decision_id || ':' || c.candidate_id,
      c.candidate_id, c.source_event_id, 'held', '["lineage_superseded"]',
      json_set(c.evidence_json, '$.superseded_by_decision_id', NEW.decision_id),
      NULL, NEW.verified_at
    FROM sold_job_call_shadow_candidates c
    WHERE c.account_id = NEW.account_id AND c.quo_call_id = NEW.quo_call_id;
  UPDATE sold_job_call_shadow_candidates
    SET state = 'held', hold_reasons_json = '["lineage_superseded"]',
      evidence_json = json_set(evidence_json, '$.superseded_by_decision_id', NEW.decision_id),
      payload_json = NULL, updated_at = NEW.verified_at
    WHERE account_id = NEW.account_id AND quo_call_id = NEW.quo_call_id;
END;

-- Supersession is append-only in 0023; this projection is invalidated in the
-- same D1 transaction that installs the new active decision.
CREATE TRIGGER IF NOT EXISTS sold_job_call_shadow_on_supersession
AFTER INSERT ON call_request_lineage_supersessions
BEGIN
  INSERT OR IGNORE INTO sold_job_call_shadow_evidence
    (observation_id, candidate_id, source_event_id, state, hold_reasons_json,
     evidence_json, payload_json, observed_at)
    SELECT 'lineage-supersession:' || NEW.decision_id || ':' || c.candidate_id,
      c.candidate_id, c.source_event_id, 'held', '["lineage_superseded"]',
      json_set(c.evidence_json, '$.superseded_by_decision_id', NEW.decision_id),
      NULL, NEW.verified_at
    FROM sold_job_call_shadow_candidates c
    WHERE c.account_id = NEW.account_id AND c.quo_call_id = NEW.quo_call_id;
  UPDATE sold_job_call_shadow_candidates
    SET state = 'held', hold_reasons_json = '["lineage_superseded"]',
      evidence_json = json_set(evidence_json, '$.superseded_by_decision_id', NEW.decision_id),
      payload_json = NULL, updated_at = NEW.verified_at
    WHERE account_id = NEW.account_id AND quo_call_id = NEW.quo_call_id;
END;

CREATE TRIGGER IF NOT EXISTS sold_job_call_shadow_evidence_no_update
BEFORE UPDATE ON sold_job_call_shadow_evidence
BEGIN SELECT RAISE(ABORT, 'sold_job_call_evidence_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sold_job_call_shadow_evidence_no_delete
BEFORE DELETE ON sold_job_call_shadow_evidence
BEGIN SELECT RAISE(ABORT, 'sold_job_call_evidence_immutable'); END;
