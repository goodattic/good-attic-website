ALTER TABLE angi_router_jobber_auth
  ADD COLUMN refresh_revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE angi_router_jobber_auth
  ADD COLUMN refresh_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (refresh_status IN ('ready', 'in_flight', 'refresh_outcome_unknown'));

ALTER TABLE angi_router_jobber_auth
  ADD COLUMN refresh_lease_token TEXT;

ALTER TABLE angi_router_jobber_auth
  ADD COLUMN refresh_lease_expires_at INTEGER;

ALTER TABLE angi_router_jobber_auth
  ADD COLUMN last_error_code TEXT;

CREATE INDEX IF NOT EXISTS angi_router_jobber_auth_refresh_state_idx
  ON angi_router_jobber_auth (refresh_status, refresh_lease_expires_at);
