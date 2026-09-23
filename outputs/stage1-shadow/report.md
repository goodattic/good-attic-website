# Stage 1 shadow pipeline — September 23, 2026

Cloud backfill completed from July 1, 2026 through 2026-09-23T18:46:17.583Z. No conversions were uploaded or recorded by this work. The six Google validate-only requests could not be sent because the required API credentials are not configured.

## Deployed system

- Worker: [good-attic-jobber-phase2-backfill](https://good-attic-jobber-phase2-backfill.patrick-944.workers.dev/health), Cloudflare account 944914746b7fbc8cd91cd7d0d9d1940c. Existing worker replaced with Stage 1 implementation; existing uploader was not changed.
- Source branch: codex/crm-google-stage1-shadow. Main: workers/stage1-shadow.js. Deployment configuration: workers/jobber-phase2-backfill.wrangler.toml.
- Five-minute Cloudflare cron, durable pagination, signed Jobber webhook inbox with retries, daily full reconciliation and UTC daily report snapshots. Durable tick lease prevents overlapping processors. Failed webhook reads move to manual review after eight attempts.
- D1 ledger/outbox: good-attic-angi-jobber-router, 934d7ad9-cba8-4cb4-9494-1e9980b7c403. Additive Stage 1 tables plus transactional expansion of the existing outbox to permit KC and shadow. Pre-migration outbox was empty; migration preserves existing rows and accepted states.
- Website attribution: existing closed_loop_leads plus Good Attic's Fieldflow D1 7f9bffa8-07d7-4cd8-a60f-96a7d0af3486. The legacy table named highlevel_lead_attributions is Good Attic's own website attribution archive; its ingestion handler writes D1 and invalidates its own dashboard cache, with no HighLevel API call. Provider/Angi records are excluded. The worker does not call HighLevel or depend on a HighLevel login/account. No existing GHL integrations were changed.
- No runtime dependency on this Mac, Codex, a browser, or Google Sheets. A one-time copy of the 19 Sheet rows is stored as a frozen comparison/validation baseline; it does not feed event generation.
- 21 Jobber webhook registrations succeeded: REQUEST_CREATE, REQUEST_UPDATE, QUOTE_CREATE, QUOTE_UPDATE, QUOTE_APPROVED, JOB_CREATE, JOB_UPDATE in each account. Existing subscriptions were not replaced. No natural webhook delivery had yet appeared in the Stage 1 inbox at this report; signature rejection and duplicate-delivery handling passed local tests.
- Both workers have GOOGLE_ADS_UPLOAD_ENABLED=false. Existing uploader transport remains null. The new worker has no real upload method. All 559 outbox records are shadow, with attempt_count=0.
- 22 relevant tests passed, including the 11 new Stage 1 tests, shared Jobber token authority, and existing disabled uploader tests.

## Event rules

| Event | Source of truth | Google action | Time / value | Order ID |
|---|---|---|---|---|
| Appointment Set | Request assessment has both start and end, linked website lead and click ID | 7741195421 | Proven scheduling-transition webhook time; $0 USD | gae-market-appointment-requestID |
| Assessment Completed | Request assessment isComplete=true | 7754270379 | completedAt; $0 USD | gae-market-assessment-requestID |
| Sold Job | Approved quote, or job containing quote | 7754270382 | lastTransitioned.approvedAt; quote amounts.total, USD | gae-market-sold-quoteID |

Market order-ID prefixes are slc, stl, kc, preserving the existing Sheet IDs. The quote and job paths use the same sale ID. Job-without-quote observations are held under gae-market-sold-job-jobID; no approval time or value is invented. Events with absent or conflicting request/lead links, missing identifiers, missing approval/completion timestamps or values, future times, or outcomes before the linked website submission are held. Accepted outbox records cannot be reset by this worker.

Exactly one click identifier is chosen: GCLID, otherwise GBRAID, otherwise WBRAID. No email/phone or call identifiers are uploaded. API payload times are YYYY-MM-DD HH:mm:ss+00:00, for example 2026-08-24 21:56:33+00:00. Internal Jobber evidence timestamps retain their original ISO Z representation.

Historical scheduling timestamps are not exposed by the queried Jobber assessment object. A scheduled visit's start is not the booking time. Therefore historical appointments are held, even when their click ID is known. New appointments become eligible only when a webhook and stored previous state prove the scheduling transition, and the fetched object's updatedAt agrees with the webhook timestamp; delayed ambiguous events remain held.

## Cumulative website-click funnel

The appointment column counts linked website-click leads with a scheduled assessment; all are held for unknown booking time. Assessment and sale columns below are eligible shadow payloads, not Google-attributed conversions.

| Market / Jobber account | Website leads with click ID | Website leads without click ID | Appointments scheduled / eligible | Assessments eligible | Sales eligible | Sales value |
|---|---:|---:|---:|---:|---:|---:|
| Utah / 2498432 | 11 | 19 | 6 / 0 | 5 | 3 | $12,148.98 |
| St. Louis / 2498453 | 14 | 26 | 11 / 0 | 9 | 5 | $22,520.40 |
| Kansas City / 1919824 | 1 | 3 | 1 / 0 | 0 | 0 | $0.00 |

Total eligible: 22 events (14 assessments and 8 sales), $34,669.38. There are 18 scheduled appointments with linked click IDs, all held. A missing click ID is counted but never produces an eligible payload.

## Full Jobber reconciliation and review queue

These broader counts include other marketing channels and customers without website attribution. They must not be interpreted as Google Ads leads or broken website links in every case. Sale observations include jobs without an approved quote, which are held and cannot supply an approved sale value.

| Market | Requests / quotes / jobs scanned | Appointment observations | Completed assessments | Sale observations / known quote value | Held observations |
|---|---:|---:|---:|---:|---:|
| Utah | 168 / 156 / 60 | 107 | 86 | 61 / $251,998.81 | 246 |
| St. Louis | 153 / 95 / 27 | 90 | 78 | 28 / $141,280.14 | 182 |
| Kansas City | 27 / 22 / 83 | 16 | 9 | 84 / $37,771.86 | 109 |

All nine market/object scans completed without errors. 559 total observations: 22 eligible and 537 held. Reasons overlap, so reason counts cannot be summed to count distinct events. Every held ID and its reasons are listed in all-events-comparison.csv.

| Market | Requests without website lead | Quotes without website lead | Quotes without request link | Jobs without website lead | Jobs without request link |
|---|---:|---:|---:|---:|---:|
| Utah | 143 | 143 | 68 | 54 | 32 |
| St. Louis | 119 | 65 | 17 | 18 | 7 |
| Kansas City | 23 | 22 | 10 | 83 | 79 |

Attribution records whose request was absent from the scan were separately looked up by exact ID; Jobber returned null for every one:

- Utah: 32503785, 32616500, 33750306, 33991081, 34050360.
- St. Louis: 32424496, 32820710, 33991074, 33052601, 34003671, 34035729.
- Kansas City: none.

Website attribution coverage begins 2026-08-02T01:58:09.925Z in the available archive; the newer closed-loop ledger starts September 21. July outcomes were scanned, but missing July click attribution cannot be reconstructed from these sources. The report distinguishes an absent original lead from a known website lead with no click ID.

Daily reporting runs in UTC. Today, September 23, the snapshot contains zero new website leads with or without click IDs and zero eligible conversion events; two unlinked completed assessments (St. Louis and KC) and one unlinked KC sale observation are held. Reports are stored in closed_loop_stage1_reports by UTC date/market and available through the authenticated /report endpoint. They are not automatically emailed. Detailed cumulative and daily metrics are in market-reports.json.

## Comparison against all 19 Sheet rows

The Sheet was read only. All 19 event IDs were found in Jobber observations. All 19 conversion instants and values agree exactly with the Sheet. All 18 eligible overlaps preserve the chosen click ID. Eighteen are eligible and one is held.

Global representation changes: literal-Z Sheet times become explicit +00:00 API times; conversion action names become Google resource IDs; currency remains USD; Sheet release_state READY becomes outbox state shadow; Sheet market aliases are normalized internally; event_source and release_state are not Google API fields. Existing event/order IDs are preserved. No Sheet timezone or formatting setting is used by the runtime.

| Existing Sheet event ID | Shadow eligibility | Additional difference |
|---|---|---|
| gae-slc-assessment-32484404 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-assessment-32616842 | Eligible shadow | None beyond global representation changes |
| gae-slc-assessment-32424204 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-assessment-32937071 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-sold-64231311 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-assessment-33078548 | Eligible shadow | None beyond global representation changes |
| gae-stl-assessment-33051732 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-sold-64405592 | Eligible shadow | None beyond global representation changes |
| gae-stl-assessment-33042289 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-sold-64423473 | Held | No request link, original lead or independently linked click ID; $17,860 remains visible for review |
| gae-stl-sold-64534205 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-slc-sold-63859930 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-assessment-33301112 | Eligible shadow | None beyond global representation changes |
| gae-slc-assessment-33353912 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-assessment-33359002 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-stl-assessment-33865725 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-slc-assessment-33977292 | Eligible shadow | Omit GBRAID; retain GCLID only |
| gae-slc-assessment-33842250 | Eligible shadow | None beyond global representation changes |
| gae-slc-sold-65441706 | Eligible shadow | None beyond global representation changes |

The Sheet sale gae-stl-sold-64423473 has a click ID in the Sheet, but the Jobber quote/job does not link to its original request. The automatic flow does not copy Sheet attribution or infer a link from customer identity. It is held even though its approval timestamp and $17,860 value agree.

Four additional eligible events are absent from the Sheet:

| Event ID | Conversion time UTC | Value |
|---|---|---:|
| gae-slc-sold-65678461 | 2026-09-18 17:16:14+00:00 | $2,496.00 |
| gae-stl-assessment-33833856 | 2026-09-20 02:58:35+00:00 | $0.00 |
| gae-stl-sold-65203544 | 2026-09-22 02:53:22+00:00 | $5,290.40 |
| gae-stl-sold-63891747 | 2026-09-12 20:57:53+00:00 | $4,500.00 |

In addition, 536 held observations are absent from the Sheet: historical appointments, non-website outcomes, and records missing required evidence. The complete 559-row comparison lists every ID, inclusion difference, time/value, and hold reason. There are no Sheet-only missing observations.

## Google API credentials and validation

The cloud worker requires GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID, GOOGLE_ADS_OAUTH_CLIENT_SECRET and GOOGLE_ADS_OAUTH_REFRESH_TOKEN. None is configured on either conversion worker; a read-only audit found no Google Ads credential-named binding on any production Worker. A browser login is not an OAuth refresh credential. Existing Jobber app credentials and rotating tokens are available through the existing cloud authority for all three markets. The only new credential created was the admin endpoint secret, stored as a Cloudflare secret. No Google credentials were written locally.

For the implemented REST path, use an OAuth grant with https://www.googleapis.com/auth/adwords from an account with access to customer 4800890529 (Patrick’s account can be used if that access and grant are confirmed); add GOOGLE_ADS_LOGIN_CUSTOMER_ID if authorizing through a manager. Production access must be Explorer, Basic or Standard; Test-only access is insufficient for this live customer. Current Google documentation describes access levels on the Google Cloud project and notes the developer-token transition; the REST authentication page still specifies the developer-token header. The existing project/token status and upload eligibility have not been verified. [Authentication](https://developers.google.com/google-ads/api/rest/auth), [access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels).

Google also restricts UploadClickConversions for tokens with no offline-upload requests between December 17, 2025 and June 15, 2026, returning CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE; its documentation says this historical restriction survives the transition to Cloud projects. Existing Sheet/Data Manager uploads do not establish that API eligibility. This is a documented possible blocker, not an error observed on this account. No alternative transport was enabled. [Google restriction](https://developers.google.com/google-ads/api/docs/deprecations).

The test method builds partialFailure=true and validateOnly=true, with one identifier per row, explicit UTC offsets, original order IDs and values. Its only possible Google upload endpoint is test-only. It was invoked in the cloud but stopped before any Google request due to missing credentials. Therefore no exact Google row response/error exists. The exact local result for each sale is:

| Event ID | Chosen ID type | Local result | Google result |
|---|---|---|---|
| gae-stl-sold-64231311 | GCLID | NOT_SENT_MISSING_CREDENTIALS | null — not sent |
| gae-stl-sold-64405592 | GCLID | NOT_SENT_MISSING_CREDENTIALS | null — not sent |
| gae-stl-sold-64423473 | GCLID | NOT_SENT_MISSING_CREDENTIALS | null — not sent |
| gae-stl-sold-64534205 | GCLID | NOT_SENT_MISSING_CREDENTIALS | null — not sent |
| gae-slc-sold-63859930 | GCLID | NOT_SENT_MISSING_CREDENTIALS | null — not sent |
| gae-slc-sold-65441706 | GBRAID | NOT_SENT_MISSING_CREDENTIALS | null — not sent |

No conversion was recorded by this stage. validate_only validates a request without executing it; even a future validation pass would not by itself prove attribution or click matching. The live Sheet/Data Manager imports remain outside this worker and unchanged.

## Enhanced conversions readiness

Not implemented and not yet verified as ready. The privacy policy discloses click identifiers, advertising measurement and advertising/analytics service providers. It does not specifically explain hashed email/phone matching to Google, and separately limits sharing mobile numbers/SMS consent for third-party marketing. The inspected site has contact/SMS consent but no demonstrated ad_user_data/ad_personalization consent capture associated with these leads. Existing outbox consent remains unknown. This is not a legal finding that every use is prohibited; it is insufficient evidence to enable that fallback now. Confirm the disclosure/phone-sharing interpretation, applicable consent and durable consent evidence, Google customer-data terms and enhanced-conversions settings before a later rollout. [Good Attic policy](https://goodattic.energy/privacy-policy/), [Google customer-data policy](https://support.google.com/google-ads/answer/7475709).

## Remaining work and limits

1. Supply eligible Google API credentials as Cloudflare secrets, then run the existing /validate-only endpoint and retain exact responses. The real upload flag remains false. If the project/token is ineligible for UploadClickConversions, choose an API route with the user before implementing it.
2. Resolve the held $17,860 sale’s missing request link from authoritative evidence, and investigate the 11 unavailable requests. No business records were altered.
3. Historical appointment booking timestamps and missing July click attribution are unavailable; those events remain held.
4. Observe the first natural webhook deliveries in each market; registration and signature/idempotency tests passed, but no production outcome was manufactured to trigger them.
5. Before any later live cutover, reconcile prior Sheet/Google accepted order IDs, stage the accepted-state transition/retry behavior, and explicitly authorize enabling a real transport. No production Google uploads are implemented in this stage.

No changes were made to the conversion Sheet, either Data Manager connection, Google conversion settings, primary/secondary status, bids, campaigns, or HighLevel.
