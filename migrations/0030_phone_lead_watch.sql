-- Additive, isolated watch ledger. Never read by the real upload transport.
CREATE TABLE IF NOT EXISTS phone_lead_watch_runs (
 run_key TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
 diagnostic_code TEXT, summary_json TEXT
);
CREATE TABLE IF NOT EXISTS phone_lead_watch_sources (
 source_key TEXT PRIMARY KEY, path TEXT NOT NULL, market_key TEXT NOT NULL,
 source_at TEXT NOT NULL, retry_until TEXT NOT NULL, state TEXT NOT NULL,
 evidence_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_lead_watch_results (
 source_key TEXT NOT NULL, result_id TEXT NOT NULL, state TEXT NOT NULL,
 result_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_checked_at TEXT NOT NULL,
 PRIMARY KEY(source_key,result_id)
);
CREATE INDEX IF NOT EXISTS phone_lead_watch_sources_pending ON phone_lead_watch_sources(state,retry_until);
