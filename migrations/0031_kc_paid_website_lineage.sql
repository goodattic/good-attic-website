-- Read-only Jobber lifecycle observations for proof-backed KC paid website Requests.
-- Apply after 0030. No row in these tables is a Google Ads upload instruction.
CREATE TABLE IF NOT EXISTS kc_paid_lineage_objects (
  account_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('assessment', 'quote', 'job', 'invoice')),
  object_id TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES closed_loop_leads(lead_id),
  request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  parent_quote_id TEXT,
  parent_job_ids_json TEXT,
  jobber_status TEXT,
  source_created_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('linked', 'held', 'unverified')),
  hold_code TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (account_id, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS kc_paid_lineage_objects_lead_idx
  ON kc_paid_lineage_objects (lead_id, object_type, status);

CREATE TABLE IF NOT EXISTS kc_paid_lineage_polls (
  lead_id TEXT PRIMARY KEY REFERENCES closed_loop_leads(lead_id),
  account_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('linked', 'held', 'retryable')),
  hold_code TEXT,
  object_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kc_paid_lineage_polls_due_idx
  ON kc_paid_lineage_polls (last_polled_at, status);

-- A completed paid form can outlive a transient failure of the optional
-- closed-loop ledger write. Record bounded repair attempts separately because
-- no lineage poll row exists until the missing lead has been recovered.
CREATE TABLE IF NOT EXISTS kc_paid_ledger_reconciliations (
  submission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('recovered', 'verified', 'held', 'retryable')),
  reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kc_paid_ledger_reconciliations_status_idx
  ON kc_paid_ledger_reconciliations (status, last_checked_at);

-- One production poll at a time. The claim is an atomic conditional UPDATE;
-- a crashed run can be reclaimed after the lease expires.
CREATE TABLE IF NOT EXISTS kc_paid_lineage_poll_lock (
  lock_name TEXT PRIMARY KEY CHECK (lock_name = 'kc_paid_website'),
  lease_token TEXT,
  lease_expires_at INTEGER,
  updated_at TEXT NOT NULL
);
