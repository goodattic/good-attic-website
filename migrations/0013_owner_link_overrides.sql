-- Owner-confirmed links are separate from the immutable Jobber observations.
CREATE TABLE IF NOT EXISTS closed_loop_owner_link_overrides (
 market_key TEXT NOT NULL CHECK (market_key IN ('ut','mo_stl','mo_kc')),
 quote_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 confirmed_by TEXT NOT NULL,
 confirmed_on TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 evidence TEXT NOT NULL,
 PRIMARY KEY (market_key,quote_id)
);
