# Stage 3c: automatic Google Data Manager uploads

Production worker: `good-attic-jobber-phase2-backfill`, deployed from `workers/stage3c-live.js` using `workers/jobber-phase2-backfill.wrangler.toml`. Cloudflare cron runs every five minutes. Jobber webhooks and periodic reconciliation feed the same D1 ledger for Utah, St. Louis, and Kansas City.

The two Google Ads Drive connections were set to **Not scheduled** on September 24, 2026 before enabling API uploads. They were not deleted; mappings, filters, the Sheet, and conversion-action settings were not modified. Do not manually run either connection during the API cutover.

## Upload eligibility and safety

- `GOOGLE_ADS_UPLOAD_ENABLED=true` and `GOOGLE_ADS_TRANSPORT=data_manager_api` are required, as are D1 activation and Sheet-pause records.
- Only ready website events for account 4800890529 and the three allowlisted conversion actions can upload. The existing owner overrides, excluded tests, and staff-deleted dispositions remain authoritative.
- Assessment and approved-quote events retain their original deterministic IDs, UTC times, and values. One identifier is selected in order GCLID, GBRAID, WBRAID.
- Appointments scheduled before cutover are frozen in the historical table. New appointments use the pipeline's first scheduled observation, not the appointment's service time.
- The already accepted canary `gae-stl-sold-65203544` is explicitly excluded. Its one-off upload route remains permanently closed.
- Every Google ingestion request contains one event and uses its event ID as `transactionId`. The per-event atomic D1 claim and outbox fence prevent concurrent duplicate sends.
- HTTP 200 with a request ID means **processing**, not final acceptance. Cloud cron retrieves diagnostics starting 30 minutes after submission, then every five minutes while pending. Raw HTTP responses and request IDs are stored.
- Accepted events are never resent. Duplicate transaction/click errors become `duplicate_of_sheet_import`; their outbox state is accepted to prevent retries, and the reporting count is separate from actual Google successes. This category is an operational label; the API error alone does not identify the original import source.
- Explicit Google failures remain retryable, with a 24-hour delay. Network timeouts, server errors, and interrupted delivery are ambiguous and require manual review before any resend.

## Cloud-only state

Migration `0015_data_manager_live.sql` adds per-event state, immutable request-attempt history, and diagnostic history. OAuth credentials remain Cloudflare secret bindings. No scheduled operation depends on a browser, this Mac, the Sheet, or HighLevel. The separate legacy uploader stays disabled.

Public `/health` reports aggregate counts and successful-run timestamps only. Authenticated `/uploads/tick` can invoke the same cloud upload cycle; production cron does not require this endpoint to be invoked manually.

## Operational checks

- Confirm the public health endpoint reports live mode, Data Manager transport, all three markets, and fresh scheduled-run timestamps.
- Inspect `closed_loop_google_uploads`, `closed_loop_google_upload_attempts`, and `closed_loop_google_diagnostics` for exact request/response evidence.
- Never clear an accepted event, edit its transaction ID to defeat duplicate detection, or replay an ambiguous delivery without investigation.
- Emergency stop: deploy with `GOOGLE_ADS_UPLOAD_ENABLED=false`. Keep both Sheet connections unscheduled while investigating; a rollback must not create concurrent import paths.

## Verification

The focused pipeline suite covers concurrency, duplicate classification, deferred diagnostics, exact error preservation, ambiguous-delivery fencing, disabled flags, canary exclusion, owner overrides, excluded tests, historical appointments, UTC formatting, and identifier precedence. The broad repository suite also contains historical release-snapshot guards that predate the closed-loop pipeline; those guards reject the already expanded branch file set and are not runtime pipeline tests.
