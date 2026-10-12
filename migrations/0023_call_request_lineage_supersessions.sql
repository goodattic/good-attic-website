-- Corrections never edit or erase the first verified call-to-Request decision.
-- The active view is the only lookup surface for downstream call-origin work.
CREATE TABLE IF NOT EXISTS call_request_lineage_supersessions (
  decision_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  prior_decision_id TEXT NOT NULL,
  operational_request_id TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE (account_id, quo_call_id, revision),
  UNIQUE (account_id, quo_call_id, prior_decision_id)
);

CREATE INDEX IF NOT EXISTS call_request_lineage_supersessions_target_idx
  ON call_request_lineage_supersessions(account_id, operational_request_id);

CREATE VIEW IF NOT EXISTS call_request_lineage_active_links AS
  SELECT l.account_id, l.quo_call_id, l.market_key, l.original_request_id,
    l.operational_request_id, l.client_id, l.call_started_at_utc,
    l.decision_id, l.verified_by, l.evidence_ref, l.verified_at, 0 AS revision
  FROM call_request_lineage_links l
  WHERE NOT EXISTS (
    SELECT 1 FROM call_request_lineage_supersessions s
    WHERE s.account_id = l.account_id AND s.quo_call_id = l.quo_call_id
  )
  UNION ALL
  SELECT l.account_id, l.quo_call_id, l.market_key, l.original_request_id,
    s.operational_request_id, l.client_id, l.call_started_at_utc,
    s.decision_id, s.verified_by, s.evidence_ref, s.verified_at, s.revision
  FROM call_request_lineage_links l
  JOIN call_request_lineage_supersessions s
    ON s.account_id = l.account_id AND s.quo_call_id = l.quo_call_id
  WHERE s.revision = (
    SELECT MAX(newer.revision) FROM call_request_lineage_supersessions newer
    WHERE newer.account_id = l.account_id AND newer.quo_call_id = l.quo_call_id
  );

-- A newly verified base link must not take a target already made active by a
-- correction, or a Request directly captured for another Quo call.
CREATE TRIGGER IF NOT EXISTS call_request_lineage_link_target_guard
BEFORE INSERT ON call_request_lineage_links
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM call_request_lineage_active_links other
    WHERE other.account_id = NEW.account_id
      AND other.quo_call_id <> NEW.quo_call_id
      AND other.operational_request_id = NEW.operational_request_id
  ) OR EXISTS (
    SELECT 1 FROM quo_call_attributions call
    WHERE call.account_id = NEW.account_id
      AND call.quo_call_id <> NEW.quo_call_id
      AND call.jobber_request_id = NEW.operational_request_id
  ) THEN RAISE(ABORT, 'lineage_target_already_claimed') END;
END;

CREATE TRIGGER IF NOT EXISTS call_request_lineage_supersession_guard
BEFORE INSERT ON call_request_lineage_supersessions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM call_request_lineage_active_links current
    WHERE current.account_id = NEW.account_id
      AND current.quo_call_id = NEW.quo_call_id
      AND current.decision_id = NEW.prior_decision_id
      AND current.revision + 1 = NEW.revision
      AND current.operational_request_id <> NEW.operational_request_id
  ) THEN RAISE(ABORT, 'lineage_supersession_stale_or_conflicting') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM call_request_lineage_active_links other
    WHERE other.account_id = NEW.account_id
      AND other.quo_call_id <> NEW.quo_call_id
      AND other.operational_request_id = NEW.operational_request_id
  ) OR EXISTS (
    SELECT 1 FROM quo_call_attributions call
    WHERE call.account_id = NEW.account_id
      AND call.quo_call_id <> NEW.quo_call_id
      AND call.jobber_request_id = NEW.operational_request_id
  ) THEN RAISE(ABORT, 'lineage_supersession_target_conflict') END;
END;

CREATE TRIGGER IF NOT EXISTS call_request_lineage_supersession_audit
AFTER INSERT ON call_request_lineage_supersessions
BEGIN
  INSERT INTO call_request_lineage_reviews (
    decision_id, account_id, quo_call_id, original_request_id,
    candidate_request_ids_json, decision, reason, reviewed_by, evidence_ref, recorded_at
  )
  SELECT NEW.decision_id, NEW.account_id, NEW.quo_call_id, l.original_request_id,
    json_array(NEW.operational_request_id), 'verified', 'explicit_supersession',
    NEW.verified_by, NEW.evidence_ref, NEW.verified_at
  FROM call_request_lineage_links l
  WHERE l.account_id = NEW.account_id AND l.quo_call_id = NEW.quo_call_id;
END;

CREATE TRIGGER IF NOT EXISTS call_request_lineage_supersessions_no_update
BEFORE UPDATE ON call_request_lineage_supersessions
BEGIN SELECT RAISE(ABORT, 'lineage_supersession_immutable'); END;
CREATE TRIGGER IF NOT EXISTS call_request_lineage_supersessions_no_delete
BEFORE DELETE ON call_request_lineage_supersessions
BEGIN SELECT RAISE(ABORT, 'lineage_supersession_immutable'); END;
