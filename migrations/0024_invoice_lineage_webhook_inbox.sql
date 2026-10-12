-- Apply after 0019. This inbox is shadow-only and has no Google upload trigger.
CREATE TABLE IF NOT EXISTS invoice_lineage_webhook_inbox (
  event_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  topic TEXT NOT NULL CHECK (topic IN ('INVOICE_CREATE', 'INVOICE_UPDATE', 'LINEAGE_REPLAY', 'JOB_DISCOVERY')),
  invoice_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'retryable', 'processing', 'done', 'manual_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  next_retry_at TEXT,
  last_error TEXT,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS invoice_lineage_webhook_pending_idx
  ON invoice_lineage_webhook_inbox(state, next_retry_at, received_at);
CREATE INDEX IF NOT EXISTS invoice_lineage_webhook_invoice_idx
  ON invoice_lineage_webhook_inbox(account_id, invoice_id, received_at);

-- A bounded, round-robin read of Stage 3c Job snapshots is a fallback when
-- Invoice webhook subscriptions are unavailable. The cursor survives cron runs.
CREATE TABLE IF NOT EXISTS invoice_lineage_discovery_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  job_key TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_lineage_job_discovery (
  account_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl')),
  job_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('checked', 'held')),
  diagnostic_code TEXT,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (account_id, job_id)
);

ALTER TABLE invoice_lineage_shadow ADD COLUMN call_origin_evidence_kind TEXT;
ALTER TABLE invoice_lineage_shadow ADD COLUMN link_decision_id TEXT;
ALTER TABLE invoice_lineage_shadow ADD COLUMN link_revision INTEGER;

-- Historical invoice snapshots remain auditable. This is the only current
-- call-attributed invoice view; a superseded decision disappears immediately.
CREATE VIEW IF NOT EXISTS invoice_lineage_shadow_current_calls AS
  SELECT i.* FROM invoice_lineage_shadow i
  WHERE i.lineage_status = 'resolved' AND i.call_origin_status = 'resolved'
    AND (
      (i.call_origin_evidence_kind = 'verified_lineage' AND EXISTS (
        SELECT 1 FROM call_request_lineage_active_links l
        WHERE l.account_id = i.account_id AND l.market_key = i.market_key
          AND l.quo_call_id = i.quo_call_id
          AND l.original_request_id = i.original_request_id
          AND l.operational_request_id = i.operational_request_id
          AND l.client_id = i.invoice_client_id
          AND l.decision_id = i.link_decision_id AND l.revision = i.link_revision
      )) OR
      (i.call_origin_evidence_kind = 'original_request' AND EXISTS (
        SELECT 1 FROM quo_call_attributions q
        WHERE q.account_id = i.account_id AND q.quo_call_id = i.quo_call_id
          AND q.jobber_request_id = i.operational_request_id
          AND q.jobber_client_id = i.invoice_client_id
      ) AND NOT EXISTS (
        SELECT 1 FROM call_request_lineage_active_links l
        WHERE l.account_id = i.account_id AND l.quo_call_id = i.quo_call_id
      ))
    );
