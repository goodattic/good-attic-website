-- Additive website form identity and a dormant conversion-adjustment outbox.
-- Apply separately after review; /initialize must not import this migration.
-- A submission ID is generated once in the browser and doubles as Google's
-- transaction ID. A completed Request can be reused; uncertain deliveries
-- may create another Request and are retained for staff reconciliation.
CREATE TABLE IF NOT EXISTS website_form_conversions (
  submission_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc', 'general')),
  jobber_account_id TEXT,
  jobber_request_id TEXT,
  jobber_client_id TEXT,
  conversion_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed', 'delivery_uncertain')),
  conversion_state TEXT NOT NULL DEFAULT 'not_confirmed'
    CHECK (conversion_state IN ('not_confirmed', 'client_signaled')),
  reconciliation_required INTEGER NOT NULL DEFAULT 0
    CHECK (reconciliation_required IN (0, 1)),
  reconciliation_reason TEXT,
  reconciliation_retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (transaction_id = submission_id),
  UNIQUE (market_key, jobber_request_id)
);

CREATE INDEX IF NOT EXISTS website_form_conversions_request_idx
  ON website_form_conversions (market_key, jobber_request_id)
  WHERE jobber_request_id IS NOT NULL;

-- Successful fail-open retries are retained individually for staff review.
-- A retry must never overwrite the original Request link on the conversion row.
CREATE TABLE IF NOT EXISTS website_form_reconciliation_attempts (
  attempt_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc', 'general')),
  reason TEXT NOT NULL,
  jobber_account_id TEXT,
  jobber_request_id TEXT,
  jobber_client_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS website_form_reconciliation_submission_idx
  ON website_form_reconciliation_attempts (submission_id, created_at);

-- There is deliberately no writer or scheduled consumer for this table yet.
-- Any future sender must atomically claim a row here before making a Google
-- request and must not retry an ambiguous delivery automatically.
CREATE TABLE IF NOT EXISTS website_form_retraction_outbox (
  transaction_id TEXT PRIMARY KEY REFERENCES website_form_conversions(transaction_id),
  market_key TEXT NOT NULL CHECK (market_key IN ('ut', 'mo_stl', 'mo_kc')),
  jobber_request_id TEXT NOT NULL,
  marker TEXT NOT NULL CHECK (marker IN ('junk', 'duplicate')),
  state TEXT NOT NULL CHECK (state IN ('shadow', 'submitting', 'submitted', 'failed', 'held')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  diagnostic_code TEXT,
  adjustment_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
