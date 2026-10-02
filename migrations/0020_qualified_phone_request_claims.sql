-- Apply only after 0016 and the KC call-ledger migration. This is additive and
-- has no Jobber or Google side effects. A Request may have several Quo calls,
-- but at most one of them may claim its qualified-phone conversion.
CREATE TABLE IF NOT EXISTS qualified_phone_request_claims (
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  jobber_request_id TEXT NOT NULL,
  google_resource TEXT NOT NULL UNIQUE,
  quo_call_id TEXT NOT NULL,
  match_origin TEXT NOT NULL CHECK (match_origin IN ('prelinked', 'manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (market_key, jobber_request_id)
);

-- Reserve Requests already represented by the live phone stage. Uploaded and
-- uncertain-delivery calls win over pending calls if old data contains several
-- calls for one Request. Review such duplicates before activating manual match.
INSERT OR IGNORE INTO qualified_phone_request_claims
  (market_key, jobber_request_id, google_resource, quo_call_id, match_origin, created_at, updated_at)
SELECT o.market_key, o.jobber_request_id, p.google_resource, o.quo_call_id,
       'prelinked', p.created_at, p.updated_at
FROM qualified_phone_calls p
JOIN google_ads_outcome_outbox o ON o.outcome_id = p.outcome_id
WHERE o.attribution_path = 'quo_call'
  AND o.event_name = 'qualified_lead'
  AND o.jobber_request_id IS NOT NULL
  AND o.quo_call_id IS NOT NULL
  AND p.state IN ('uploaded', 'submitting', 'failed', 'ready', 'retryable')
ORDER BY CASE p.state
  WHEN 'uploaded' THEN 0 WHEN 'submitting' THEN 1 WHEN 'failed' THEN 2
  WHEN 'ready' THEN 3 ELSE 4 END, p.created_at, p.google_resource;
