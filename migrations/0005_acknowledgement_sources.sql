-- Server-authored proof of a successful public website intake. No raw customer phone, name, email or address.
-- Immutable rows tie the form's server UUID to the exact account and Request.
CREATE TABLE IF NOT EXISTS acknowledgement_sources (
  account_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  client_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind = 'website'),
  source_lead_id TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  phone_sha256 TEXT,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (account_id, request_id),
  UNIQUE (market_key, source_lead_id)
);
