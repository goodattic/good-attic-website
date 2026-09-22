-- Quo intake mutations are independent checkpoints. An unfinished *_creating
-- checkpoint is never repeated automatically, even after a lease expires.
CREATE TABLE IF NOT EXISTS quo_intake_operations (
  operation_id TEXT PRIMARY KEY,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('intake','note')),
  parent_operation_id TEXT,
  account_id TEXT NOT NULL,
  market TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  intent_sha256 TEXT NOT NULL,
  source_json TEXT NOT NULL,
  operation_state TEXT NOT NULL,
  classification TEXT,
  reason TEXT,
  client_id TEXT,
  request_id TEXT,
  note_id TEXT,
  jobber_web_uri TEXT,
  uncertain INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quo_intake_phone_guards (
  account_id TEXT NOT NULL,
  phone_sha256 TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, phone_sha256)
);
CREATE INDEX IF NOT EXISTS quo_intake_operations_parent_idx ON quo_intake_operations(parent_operation_id);
CREATE INDEX IF NOT EXISTS quo_intake_operations_state_idx ON quo_intake_operations(operation_state, updated_at);

CREATE TABLE IF NOT EXISTS quo_intake_source_guards (
  account_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS quo_intake_operations_request_idx
  ON quo_intake_operations(account_id, request_id, operation_kind);
