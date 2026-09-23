# Stage 2 — completed, September 23, 2026

Uploads remain OFF. Worker first deployed at 2026-09-23T19:09:26.554894Z; final eventSource correction deployed at 2026-09-23T20:02:07.992501Z. No real Google conversion transport is installed or invoked. Sheet, Data Manager connections, conversion actions, campaigns and HighLevel remain unchanged.

## Transport decision

Use Data Manager API events:ingest, one event per request, always validateOnly=true during this stage. OAuth scope: https://www.googleapis.com/auth/datamanager. Destination account 4800890529; conversion action 7754270382 for sales and 7754270379 for the extra assessment. Exactly one identifier, GCLID > GBRAID > WBRAID. RFC3339 eventTimestamp carries explicit +00:00; USD values and original deterministic IDs retained.

Google Ads API UploadClickConversions is restricted for adopters whose developer tokens had no offline-upload activity December 17, 2025–June 15, 2026. Current docs say the restriction survives the subsequent September 9 developer-token sunset. The existing Sheet/Data Manager imports do not establish eligibility for the Google Ads API. No grandfathered integration has been identified; account-specific legacy eligibility has not been proved by an authenticated request. Data Manager is Google's documented route for new offline-upload integrations. OAuth refresh and all ten authenticated validate-only requests now succeed for account 4800890529. Google returned HTTP 200 for each, confirming this Data Manager validation route is usable. This does not prove eventual attribution.

Data Manager does not offer the same partialFailure model. One event per request isolates synchronous success/errors; future real uploads can associate request-status diagnostics with that sole event. validateOnly validates but does not execute. Google supplies no asynchronous diagnostics for validation requests, so validation cannot prove click matching or attribution.

Sources checked September 23:
- https://developers.google.com/google-ads/api/docs/deprecations
- https://developers.google.com/data-manager/api/devguides/events/google-ads/offline
- https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade/field-mappings
- https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest
- https://developers.google.com/data-manager/api/devguides/diagnostics

## Credentials — configured and verified

The user enabled Data Manager API in existing Google Cloud project ultra-guard-495221-h7 (My First Project), signed in as patrick@goodattic.energy. Google Auth Platform audience is Internal. The user created the dedicated web client “Google Ad Attribution” and personally approved Data Manager access. Its project-level consent-screen name remains “Partner Calendar Sync”; that existing branding was not changed. No new project or account was required. No developer token application is needed for Data Manager.

Verified encrypted Cloudflare secrets on good-attic-jobber-phase2-backfill:
- GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID
- GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET
- GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN

No credential values belong in this repository, local files, reports or chat. Browser use is only for initial authorization and copying credentials directly into Cloudflare secrets; the runtime is cloud-hosted. OAuth access tokens are obtained in worker memory. Cloud OAuth token refresh succeeded and all ten final validation requests returned HTTP 200 with a requestId and no error or warning. No further credential action is needed from the user. No Google credential values were saved to local files or chat.

## Appointment timing and health

Migration 0012 freezes previously observed historical scheduled assessments. New scheduled assessments receive their first pipeline observation time, persisted once; rescheduling does not change it. Newly discovered assessments that ended before Stage 2 activation also remain held. The activation cutoff is 2026-09-23T19:09:30.170Z. Historical appointments are not released by re-running initialization.

The public /health endpoint now returns last_successful_run_at, last_successful_scheduled_run_at and 24-hour counters. Failed and partially failed runs do not advance success timestamps. Counts are aggregated; no client, click ID or Jobber record data is exposed. events_processed counts distinct outcome evaluations within each successful run, summed over runs; repeated reconciliation is included. unique_events_touched and new_shadow_events cover the ledger's rolling 24 hours, including Stage 1 activity before instrumentation began.

Autonomous execution is verified. Consecutive scheduled runs completed at 19:40:34, 19:45:32, 19:50:33, 19:55:35 and 20:00:36 UTC. The final two processed one Jobber webhook each. The final deployment check also ran a manual reconciliation, separately identified in health. Latest captured health: last_successful_run_at 2026-09-23T20:02:15.634Z; last_successful_scheduled_run_at 2026-09-23T20:00:36.184Z; 8 successful runs, 808 outcome evaluations, 559 distinct events touched, 559 new shadow entries in the last 24 hours, 2 webhooks processed. Repeated evaluations are not new conversions. All 559 outbox rows remain shadow with attempt_count=0.

Thirty relevant tests passed (12 Stage 1, 7 Stage 2, 11 existing uploader/token authority).

## Google validate-only results

Every request used validateOnly=true and one event, one click identifier, eventSource=OTHER (CRM outcome), USD and an explicit UTC offset. No conversion was recorded. No hashed email/phone or invented consent was sent.

The first ten requests returned HTTP 400 INVALID_ARGUMENT, REQUIRED_FIELD_MISSING, field events.events[0].event_source, description “Required field is missing.” This was a transport implementation omission, corrected before the final pass. Exact original errors are preserved in validation-initial-errors.json. Exact final response bodies are preserved in validation-results.json and in the protected D1 validation audit.

All final response bodies contain only the requestId shown below; all HTTP statuses are 200, with no errors or fieldWarnings. First six are frozen Sheet sales; last four are the extra shadow events.

| Event ID | HTTP | Exact Google requestId |
|---|---:|---|
| gae-stl-sold-64231311 | 200 | v-b21f2f76-8348-41dd-ac2e-a3aca668d8e8 |
| gae-stl-sold-64405592 | 200 | v-f99520d9-2c22-4cac-91e5-fdfda583e546 |
| gae-stl-sold-64423473 | 200 | v-c56c4217-7cc4-45b3-8707-270eb0822325 |
| gae-stl-sold-64534205 | 200 | v-0aedbd98-e458-476f-8e02-443ae4f1aec5 |
| gae-slc-sold-63859930 | 200 | v-c55256c2-7420-46bc-acb3-09c45d405aef |
| gae-slc-sold-65441706 | 200 | v-84be3a83-cebe-4d0d-a555-2ffbe06e1429 |
| gae-slc-sold-65678461 | 200 | v-2e02d872-e28d-4680-bb11-ed124b48b0cc |
| gae-stl-sold-63891747 | 200 | v-77fbbf1f-ac85-4723-9885-621d386aafcf |
| gae-stl-sold-65203544 | 200 | v-9a660a9b-73ab-40ba-96c7-b7fa6a78a4c7 |
| gae-stl-assessment-33833856 | 200 | v-0d19bc34-473f-494b-97de-d20ec6f68326 |

Validation does not supply asynchronous match diagnostics. It cannot establish that these clicks will receive credit, explain the old scheduled Sales import’s lack of attribution, or prove legacy Google Ads API allowlisting. No real upload was performed to test those questions. The six-sale test uses the preserved Sheet baseline; Google Sheets is not read by or needed for ongoing processing.

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
