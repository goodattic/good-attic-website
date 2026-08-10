CREATE TABLE IF NOT EXISTS angi_router_locks (
  lock_name TEXT PRIMARY KEY,
  lease_token TEXT,
  lease_expires_at INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS angi_router_jobber_auth (
  account_key TEXT PRIMARY KEY,
  access_token TEXT,
  access_expires_at INTEGER,
  refresh_token TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS angi_utah_jobber_deliveries_queue_idx
  ON angi_utah_jobber_deliveries (
    status,
    next_attempt_at,
    lease_expires_at,
    created_at
  );
