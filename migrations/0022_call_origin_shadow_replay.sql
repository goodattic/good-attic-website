-- Incremental replay checkpoint for opt-in call-origin shadow observations.
-- Does not affect website attribution or Google upload state.
CREATE TABLE IF NOT EXISTS call_origin_shadow_object_checks (
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  object_type TEXT NOT NULL CHECK (object_type IN ('request', 'quote', 'job')),
  object_id TEXT NOT NULL,
  operational_request_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_updated_at TEXT,
  first_scheduled_at TEXT,
  link_decision_id TEXT,
  link_revision INTEGER,
  direct_call_count INTEGER NOT NULL,
  direct_max_call_id TEXT,
  check_status TEXT NOT NULL CHECK (check_status IN ('resolved', 'held')),
  diagnostic_code TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (market_key, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS call_origin_shadow_object_checks_status_idx
  ON call_origin_shadow_object_checks(check_status, checked_at);

CREATE INDEX IF NOT EXISTS closed_loop_stage1_objects_request_replay_idx
  ON closed_loop_stage1_objects(market_key, request_id, object_type);

-- Historical rows remain an audit trail. Consumers must use this view: it
-- immediately excludes superseded Requests and decisions, including when the
-- active link is corrected back to the original Request.
ALTER TABLE call_origin_shadow_events ADD COLUMN link_decision_id TEXT;
CREATE VIEW IF NOT EXISTS call_origin_shadow_current_events AS
  SELECT e.* FROM call_origin_shadow_events e
  WHERE (e.evidence_kind = 'verified_lineage' AND EXISTS (
    SELECT 1 FROM call_request_lineage_active_links l
    WHERE l.account_id = e.account_id AND l.quo_call_id = e.quo_call_id
      AND l.market_key = e.market_key AND l.client_id = e.client_id
      AND l.original_request_id = e.original_request_id
      AND l.decision_id = e.link_decision_id
      AND l.operational_request_id = e.operational_request_id
  )) OR (e.evidence_kind = 'original_request' AND NOT EXISTS (
    SELECT 1 FROM call_request_lineage_active_links l
    WHERE l.account_id = e.account_id AND l.quo_call_id = e.quo_call_id
  ));
