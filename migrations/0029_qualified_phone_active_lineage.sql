-- Resolve an imported qualified phone conversion to the Request where staff
-- actually worked the inquiry. The upload/outbox identity remains immutable:
-- the original Request, Quo call, caller, and Google call resource are evidence.
-- This view follows only the currently reviewed lineage decision, including a
-- later append-only supersession. Consumers must use operational_request_id
-- only when resolution_status is original_request or verified_lineage.
CREATE VIEW IF NOT EXISTS qualified_phone_request_lineage_current AS
WITH evidence AS (
  SELECT o.outcome_id, p.google_resource, p.state AS phone_state,
    o.upload_state, o.market_key, o.jobber_account_id,
    o.quo_call_id, o.caller_phone, o.call_started_at_utc,
    o.jobber_request_id AS original_request_id,
    o.jobber_client_id AS client_id,
    q.account_id AS source_account_id,
    q.jobber_request_id AS source_request_id,
    q.jobber_client_id AS source_client_id,
    q.call_started_at_utc AS source_call_started_at_utc,
    l.original_request_id AS link_original_request_id,
    l.operational_request_id AS link_operational_request_id,
    l.client_id AS link_client_id,
    l.call_started_at_utc AS link_call_started_at_utc,
    l.market_key AS link_market_key,
    l.decision_id AS link_decision_id,
    l.revision AS link_revision,
    l.verified_at AS link_verified_at,
    (SELECT COUNT(*) FROM call_request_lineage_active_links active
      WHERE active.account_id = q.account_id
        AND active.quo_call_id = q.quo_call_id) AS active_link_count,
    CASE WHEN q.quo_call_id IS NOT NULL
      AND o.jobber_account_id = CASE o.market_key
        WHEN 'ut' THEN '2498432' WHEN 'mo_stl' THEN '2498453' END
      AND q.market = CASE o.market_key
        WHEN 'ut' THEN 'utah' WHEN 'mo_stl' THEN 'stl' END
      AND q.destination_number = CASE o.market_key
        WHEN 'ut' THEN '+13853364442' WHEN 'mo_stl' THEN '+13149312620' END
      AND q.direction = 'incoming'
      AND q.caller_phone = o.caller_phone
      AND q.jobber_request_id = o.jobber_request_id
      AND q.jobber_client_id = o.jobber_client_id
      AND o.jobber_request_id IS NOT NULL AND o.jobber_client_id IS NOT NULL
      AND strftime('%s', o.call_started_at_utc) IS NOT NULL
      AND strftime('%s', q.call_started_at_utc) IS NOT NULL
      AND ABS(strftime('%s', o.call_started_at_utc)
        - strftime('%s', q.call_started_at_utc)) <= 120
      AND p.google_resource = o.google_call_key
      AND o.google_account_id = '4800890529'
      AND o.google_conversion_action = '7742989654'
      THEN 1 ELSE 0 END AS source_verified
  FROM qualified_phone_calls p
  JOIN google_ads_outcome_outbox o ON o.outcome_id = p.outcome_id
    AND o.event_name = 'qualified_lead' AND o.attribution_path = 'quo_call'
  LEFT JOIN quo_call_attributions q ON q.quo_call_id = o.quo_call_id
    AND q.account_id = CASE o.market_key
      WHEN 'ut' THEN 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg=='
      WHEN 'mo_stl' THEN 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==' END
  LEFT JOIN call_request_lineage_active_links l
    ON l.account_id = q.account_id AND l.quo_call_id = q.quo_call_id
    AND (SELECT COUNT(*) FROM call_request_lineage_active_links unique_link
      WHERE unique_link.account_id = q.account_id
        AND unique_link.quo_call_id = q.quo_call_id) = 1
), resolved AS (
  SELECT e.*,
    CASE
      WHEN source_verified <> 1 THEN 'held_source_conflict'
      WHEN active_link_count = 0 THEN 'original_request'
      WHEN active_link_count <> 1
        OR link_original_request_id <> original_request_id
        OR link_client_id <> client_id
        OR link_call_started_at_utc <> source_call_started_at_utc
        OR link_market_key <> market_key
        OR link_operational_request_id IS NULL
        OR link_operational_request_id = original_request_id
        OR link_decision_id IS NULL OR link_revision IS NULL
        OR link_verified_at IS NULL
        OR EXISTS (SELECT 1 FROM quo_call_attributions competing_call
          WHERE competing_call.account_id = source_account_id
            AND competing_call.jobber_request_id = link_operational_request_id
            AND competing_call.quo_call_id <> e.quo_call_id)
        OR EXISTS (SELECT 1 FROM call_request_lineage_active_links competing_link
          WHERE competing_link.account_id = source_account_id
            AND competing_link.operational_request_id = link_operational_request_id
            AND competing_link.quo_call_id <> e.quo_call_id)
        THEN 'held_lineage_conflict'
      ELSE 'verified_lineage'
    END AS resolution_status
  FROM evidence AS e
)
SELECT outcome_id, google_resource, phone_state, upload_state,
  market_key, jobber_account_id, quo_call_id, caller_phone,
  call_started_at_utc, original_request_id, client_id,
  CASE resolution_status
    WHEN 'original_request' THEN original_request_id
    WHEN 'verified_lineage' THEN link_operational_request_id
    ELSE NULL END AS operational_request_id,
  resolution_status,
  CASE WHEN resolution_status = 'verified_lineage'
    THEN link_decision_id ELSE NULL END AS lineage_decision_id,
  CASE WHEN resolution_status = 'verified_lineage'
    THEN link_revision ELSE NULL END AS lineage_revision,
  CASE WHEN resolution_status = 'verified_lineage'
    THEN link_verified_at ELSE NULL END AS lineage_verified_at
FROM resolved;
