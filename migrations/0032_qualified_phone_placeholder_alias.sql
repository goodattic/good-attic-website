-- Independent default-off identity resolver. Original conversion ledger IDs stay unchanged.
-- Only provenance IDs/decision codes are stored; no inquiry text or payment details.
CREATE TABLE IF NOT EXISTS qualified_phone_alias_resolutions (
 google_resource TEXT PRIMARY KEY, market_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('original','resolved','held')), reason TEXT,
 original_client_id TEXT, original_request_id TEXT,
 operational_client_id TEXT, operational_request_id TEXT,
 evidence_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_checked_at TEXT NOT NULL
);
