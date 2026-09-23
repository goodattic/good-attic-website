# Stage 2 — in progress, September 23, 2026

Uploads remain OFF. Worker deployed at 2026-09-23T19:09:26.554894Z. No real Google conversion transport is installed or invoked. Sheet, Data Manager connections, conversion actions, campaigns and HighLevel remain unchanged.

## Transport decision

Use Data Manager API events:ingest, one event per request, always validateOnly=true during this stage. OAuth scope: https://www.googleapis.com/auth/datamanager. Destination account 4800890529; conversion action 7754270382 for sales and 7754270379 for the extra assessment. Exactly one identifier, GCLID > GBRAID > WBRAID. RFC3339 eventTimestamp carries explicit +00:00; USD values and original deterministic IDs retained.

Google Ads API UploadClickConversions is restricted for adopters whose developer tokens had no offline-upload activity December 17, 2025–June 15, 2026. Current docs say the restriction survives the subsequent September 9 developer-token sunset. The existing Sheet/Data Manager imports do not establish eligibility for the Google Ads API. No grandfathered integration has been identified; account-specific legacy eligibility has not been proved by an authenticated request. Data Manager is Google's documented route for new offline-upload integrations. Actual authorization for this account still requires OAuth and validation.

Data Manager does not offer the same partialFailure model. One event per request isolates synchronous success/errors; future real uploads can associate request-status diagnostics with that sole event. validateOnly validates but does not execute. Google supplies no asynchronous diagnostics for validation requests, so validation cannot prove click matching or attribution.

Sources checked September 23:
- https://developers.google.com/google-ads/api/docs/deprecations
- https://developers.google.com/data-manager/api/devguides/events/google-ads/offline
- https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade/field-mappings
- https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest
- https://developers.google.com/data-manager/api/devguides/diagnostics

## Credentials — user setup underway

The user enabled Data Manager API in existing Google Cloud project ultra-guard-495221-h7 (My First Project), signed in as patrick@goodattic.energy. Google Auth Platform audience is Internal. A dedicated OAuth web client is being created by the user; no new project or account is required. No developer token application is needed for Data Manager.

Required Cloudflare secrets on good-attic-jobber-phase2-backfill:
- GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID
- GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET
- GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN

No credential values belong in this repository, local files, reports or chat. Browser use is only for initial authorization and copying credentials directly into Cloudflare secrets; the runtime is cloud-hosted. OAuth access tokens are obtained in worker memory. No live validation has run yet: all ten cases currently report NOT_SENT_MISSING_CREDENTIALS. These are local blocked states, not Google responses.

## Appointment timing and health

Migration 0012 freezes previously observed historical scheduled assessments. New scheduled assessments receive their first pipeline observation time, persisted once; rescheduling does not change it. Newly discovered assessments that ended before Stage 2 activation also remain held. The activation cutoff is 2026-09-23T19:09:30.170Z. Historical appointments are not released by re-running initialization.

The public /health endpoint now returns last_successful_run_at, last_successful_scheduled_run_at and 24-hour counters. Failed and partially failed runs do not advance success timestamps. Counts are aggregated; no client, click ID or Jobber record data is exposed. events_processed counts distinct outcome evaluations within each successful run, summed over runs; repeated reconciliation is included. unique_events_touched and new_shadow_events cover the ledger's rolling 24 hours, including Stage 1 activity before instrumentation began.

At 19:09:33 UTC the successful manual run evaluated 101 outcome IDs. No scheduled run had yet been verified. The five-minute trigger was reapplied with Wrangler; live observation continues. A null scheduled timestamp is explicitly not proof of autonomy.

Thirty relevant tests passed (12 Stage 1, 7 Stage 2, 11 existing uploader/token authority).

## Human Jobber repair checklist — no Jobber changes made

Sale gae-stl-sold-64423473, quote 64423473, St. Louis account 2498453, approved 2026-08-24T18:19:25Z, $17,860:
1. Open the quote and associated job in the St. Louis account and verify the client/property and original assessment request.
2. Candidate original request is 33051732: its Sheet assessment shares the sale's GCLID. This is evidence for a person to verify, not an automatic identity-based link.
3. The quote/job API records lack their request link. Restore the authoritative relationship to the verified original request if Jobber permits it; otherwise ask Jobber support to repair it or document a reviewed canonical mapping. Do not recreate an approved quote/job solely to force tracking, or change its approval timestamp/value.
4. Reconcile afterward. The sale remains held until the pipeline has an authoritative path back to the original website lead/click ID. The test-only Sheet validation does not release it.

Jobber returned null for the following exact request lookups (not proof that they were deleted):

| Market/account | Request IDs |
|---|---|
| Utah / 2498432 | 32503785, 32616500, 33750306, 33991081, 34050360 |
| St. Louis / 2498453 | 32424496, 32820710, 33991074, 33052601, 34003671, 34035729 |
| Kansas City / 1919824 | None |

For each ID, select the indicated Jobber account and find the original request, including archived/deleted/merged records and any successor. Verify against the original client/property and lead before making a mapping. If visible in Jobber but API-null, repair the connected user's permissions/account authorization with Jobber support. If deleted, restore if supported or record a verified replacement relationship for review. If unrecoverable, leave it held; do not invent requests, times or click IDs. The pipeline cannot determine which repair applies from a null response alone.
