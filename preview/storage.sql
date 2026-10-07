CREATE TABLE IF NOT EXISTS angi_router_jobber_auth (
account_key TEXT PRIMARY KEY, access_token TEXT, access_expires_at INTEGER,
refresh_token TEXT, refresh_revision INTEGER DEFAULT 0, refresh_status TEXT DEFAULT 'ready',
refresh_lease_token TEXT, refresh_lease_expires_at INTEGER, last_error_code TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS preview_test_leads (
id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, response_json TEXT, http_status INTEGER,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
