CREATE TABLE IF NOT EXISTS closed_loop_owner_request_links (
 market_key TEXT NOT NULL, replacement_request_id TEXT NOT NULL,
 source_request_id TEXT NOT NULL, evidence_quote_id TEXT,
 allowed_stage TEXT NOT NULL CHECK(allowed_stage='assessment_completed'),
 confirmed_by TEXT NOT NULL, confirmed_on TEXT NOT NULL, recorded_at TEXT NOT NULL,
 evidence TEXT NOT NULL,
 PRIMARY KEY(market_key,replacement_request_id), UNIQUE(market_key,source_request_id)
);
CREATE TABLE IF NOT EXISTS closed_loop_lead_dispositions (
 market_key TEXT NOT NULL, request_id TEXT NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('test_excluded','closed_deleted_by_staff')),
 confirmed_by TEXT NOT NULL, confirmed_on TEXT NOT NULL, recorded_at TEXT NOT NULL,
 evidence TEXT NOT NULL, PRIMARY KEY(market_key,request_id)
);
