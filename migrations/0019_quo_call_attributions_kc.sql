-- Review-only migration. The live table still has the 0008 CHECK constraints.
-- This preserves the live 0008 Google-upload and consent constraints. The
-- separate, unapplied 0010 must not be applied after this migration because
-- it would exclude Kansas City again. A future upload-status change needs a
-- migration built on this KC-inclusive schema.
-- Back up D1 and verify the live schema before applying this table rebuild.
-- D1 runs SQL imports/migrations in an implicit transaction. Defer checks
-- through the rebuild rather than trying to disable foreign keys or BEGIN.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE quo_call_attributions_next (
  attribution_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('utah','stl','kc')),
  phone_number_id TEXT NOT NULL,
  quo_call_id TEXT NOT NULL,
  caller_phone TEXT NOT NULL,
  call_started_at_original TEXT NOT NULL,
  call_started_at_utc TEXT NOT NULL,
  destination_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction = 'incoming'),
  final_status TEXT NOT NULL,
  duration_seconds INTEGER,
  answered_at TEXT,
  first_time_caller_status TEXT,
  jobber_request_id TEXT,
  jobber_client_id TEXT,
  quote_id TEXT,
  job_id TEXT,
  invoice_id TEXT,
  attribution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (attribution_status IN ('pending','google_matched','not_matched','ineligible','error')),
  google_upload_status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (google_upload_status = 'not_submitted'),
  google_upload_http_status INTEGER,
  google_upload_diagnostic TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (consent_status = 'unknown'),
  consent_evidence TEXT,
  source_event_id TEXT NOT NULL,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, quo_call_id)
);

INSERT INTO quo_call_attributions_next (
  attribution_id,account_id,market,phone_number_id,quo_call_id,caller_phone,
  call_started_at_original,call_started_at_utc,destination_number,direction,
  final_status,duration_seconds,answered_at,first_time_caller_status,jobber_request_id,
  jobber_client_id,quote_id,job_id,invoice_id,attribution_status,
  google_upload_status,google_upload_http_status,google_upload_diagnostic,
  consent_status,consent_evidence,source_event_id,conversation_id,created_at,updated_at
)
SELECT
  attribution_id,account_id,market,phone_number_id,quo_call_id,caller_phone,
  call_started_at_original,call_started_at_utc,destination_number,direction,
  final_status,duration_seconds,NULL,first_time_caller_status,jobber_request_id,
  jobber_client_id,quote_id,job_id,invoice_id,attribution_status,
  google_upload_status,google_upload_http_status,google_upload_diagnostic,
  consent_status,consent_evidence,source_event_id,conversation_id,created_at,updated_at
FROM quo_call_attributions;

DROP TABLE quo_call_attributions;
ALTER TABLE quo_call_attributions_next RENAME TO quo_call_attributions;
CREATE INDEX quo_call_attributions_request_idx
  ON quo_call_attributions(account_id, jobber_request_id);
CREATE INDEX quo_call_attributions_status_idx
  ON quo_call_attributions(market, attribution_status, updated_at);
CREATE INDEX quo_call_attributions_caller_idx
  ON quo_call_attributions(market, caller_phone, call_started_at_utc);

PRAGMA defer_foreign_keys = OFF;
