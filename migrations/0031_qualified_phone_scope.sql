-- Independent of watch mode. Positive quoted/sold scope survives deletion.
-- Contains service codes and Jobber IDs only, never inquiry or line-item text.
CREATE TABLE IF NOT EXISTS qualified_phone_scope_work (
 market_key TEXT NOT NULL, client_id TEXT NOT NULL,
 object_type TEXT NOT NULL CHECK(object_type IN ('quote','job')),
 object_id TEXT NOT NULL, scope_json TEXT NOT NULL,
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 PRIMARY KEY(market_key,client_id,object_type,object_id)
);
