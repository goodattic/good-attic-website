-- Additive Stage 1 ledger; old lead/event tables remain compatible with website.
CREATE TABLE IF NOT EXISTS closed_loop_stage1_leads (
 market_key TEXT NOT NULL, request_id TEXT NOT NULL, lead_id TEXT NOT NULL,
 inquiry_at TEXT NOT NULL, gclid TEXT, gbraid TEXT, wbraid TEXT,
 source TEXT NOT NULL, conflict INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 PRIMARY KEY(market_key,request_id)
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_objects (
 market_key TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
 request_id TEXT, client_id TEXT, source_created_at TEXT, source_updated_at TEXT,
 object_json TEXT NOT NULL, first_scheduled_at TEXT, observed_at TEXT NOT NULL,
 PRIMARY KEY(market_key,object_type,object_id)
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_scan (
 market_key TEXT NOT NULL, object_type TEXT NOT NULL, cursor TEXT, completed_at TEXT,
 page_count INTEGER NOT NULL DEFAULT 0, object_count INTEGER NOT NULL DEFAULT 0,
 error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(market_key,object_type)
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_events (
 outcome_id TEXT PRIMARY KEY, market_key TEXT NOT NULL, event_name TEXT NOT NULL,
 request_id TEXT, quote_id TEXT, job_id TEXT, conversion_at TEXT, value_micros INTEGER,
 payload_json TEXT, hold_reasons_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_webhooks (
 event_key TEXT PRIMARY KEY, market_key TEXT NOT NULL, topic TEXT NOT NULL,
 item_id TEXT NOT NULL, occurred_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT, received_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_reports (
 report_date TEXT NOT NULL, market_key TEXT NOT NULL, report_json TEXT NOT NULL,
 updated_at TEXT NOT NULL, PRIMARY KEY(report_date,market_key)
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_baseline (
 event_id TEXT PRIMARY KEY, row_json TEXT NOT NULL, captured_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS closed_loop_stage1_control (
 name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
