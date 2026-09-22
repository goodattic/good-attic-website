# Phase 2 outcome watcher — discovery and dry-run contract

## Scope and safety

This implementation is local and dry-run only. It is limited to `ut` and `mo_stl`; Kansas City is rejected before any ledger write. No Google request, conversion-action mutation, Jobber mutation, migration, or deployment is performed by this branch.

The St. Louis website Jobber authorization was read successfully. Utah's cached access token was expired. The existing `/api/jobber/oauth/reauthorize?market=slc` flow includes a real no-change `quoteEdit` write probe before checkpointing, so it was not invoked under this no-Jobber-mutation instruction. Utah therefore remains a read-access hold until a separately approved authorization-only path is available.

## Jobber source of truth

Jobber webhook payloads contain only `topic`, `accountId`, `itemId`, and `occurredAt`; the worker must issue a read-only GraphQL query for the object. The deployed bridge proves `REQUEST_CREATE`, `REQUEST_UPDATE`, and `QUOTE_CREATE`. Live schema introspection confirmed `VISIT_CREATE`, `VISIT_UPDATE`, `VISIT_COMPLETE`, `QUOTE_UPDATE`, `QUOTE_SENT`, `QUOTE_APPROVED`, `JOB_CREATE`, `JOB_UPDATE`, `JOB_CLOSED`, `INVOICE_CREATE`, `INVOICE_UPDATE`, and payment create/update/destroy topics. Phase 2 uses those notifications plus a scheduled backfill as the authority when a topic is unavailable.

The read fields are:

- Request: `assessment.id/startAt/endAt`, request/client IDs, attached Quotes and Jobs.
- Quote: `quoteStatus`, `amounts.total`, `request.id`, `updatedAt`.
- Job: `jobStatus`, `total`, `invoicedTotal`, `request.id`, `quote.id`, `updatedAt`.
- Invoice: `invoiceStatus`, `amounts.total`, `issuedDate`, `updatedAt`, attached Jobs.

The webhook itself is never treated as the lifecycle state. The object read and backfill are the state sources.

## Revenue rule

The initial sold amount is the accepted Quote `amounts.total`, recorded once with a stable Quote ID. Final revenue evidence uses immutable source priority: Invoice `amounts.total` when present, then Job `invoicedTotal`, then the accepted Quote total. Quote and Job totals are never summed. A later amount change creates a `revenue_restatement` candidate with the prior reported amount. Refunds, credits, voids, and cancellations remain held until the Google action explicitly supports adjustment or retraction; the watcher does not guess a negative value.

## Qualification

`qualified_lead` requires structured evidence for homeowner, valid service area, installed service, and expected value of at least $2,000. Missing fields produce `qualification_unverified`; notes, source labels, campaigns, and Jobber object existence do not satisfy the rule.

## Google upload contract

The uploader interface is disabled by default and uses a fake transport in tests. The real transport is implemented behind the same interface and remains inert unless explicitly enabled. It calls Google's `UploadClickConversions` or `UploadCallConversions` with partial failure enabled. Website candidates carry exactly one of GCLID, GBRAID, or WBRAID. Call candidates carry the E.164 caller number and original call-start timestamp. Every request uses USD, a deterministic order ID, bounded retry classification, sanitized diagnostics, and consent/attribution holds. Upload windows and adjustment/retraction support are supplied by the action map; unknown windows stay held.

Required Cloudflare secrets for a future enabled deployment are `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, and `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`. The customer ID is `4800890529`; the call Sold Job action is `7788072382`. These values are not stored in the repository, and the transport is not enabled by this branch.

## Current action discovery

The verified customer mapping supplied for this dry-run is: `7741195421` Appointment Set (UPLOAD_CLICKS, 90 days, uploaded value accepted); `7742989654` Qualified Call Lead (UPLOAD_CALLS, 90 days, uploaded value accepted); `7754270379` Assessment Completed (UPLOAD_CLICKS, 90 days, forced zero); `7754270382` Sold Job (UPLOAD_CLICKS, 90 days, uploaded value accepted); and `7788072382` Sold Job from Call (UPLOAD_CALLS, secondary, uploaded value accepted). The implementation never uses the UI defaults of $4,000 for Appointment or Qualified Call; both require an explicit value or remain held. Assessment is forced to zero. Sold Job uses the converted Quote amount initially.

The signed-in Google Ads page also exposed existing legacy actions such as `DA - Submit Lead Form`, `DA - Website Calls (UT)`, `DA - Website Call (MO)`, `Call from Ad Extension`, `Calls from ads`, and inactive GA4 actions. Those are not used for Phase 2.

## Reconciliation

The local coordinator runs a read-only backfill and writes only the dry-run outbox. Production reconciliation remains pending until the action map is re-authenticated and the Jobber read scopes/objects are queried for both accounts. No production totals are fabricated from absent records.

The checked-in snapshot [`outputs/phase2-dry-run-reconciliation-2026-09-21.json`](outputs/phase2-dry-run-reconciliation-2026-09-21.json) records the observed totals. St. Louis was readable (144 Requests, 84 scheduled assessments, 92 Quotes, 25 converted Quotes, 25 Jobs, and 21 Invoices), but none of the two source leads had a linked lifecycle object. Utah was held because its cached token was expired and the only existing reauthorization flow performs a real no-change Quote write probe. No live call-ledger rows arrived during this read-only window, so duplicate prevention is represented by automated ledger tests rather than fabricated live counts.

Invoice total and collected payments are retained as separate reconciliation fields in the outbox. The accepted Quote `amounts.total` is the initial sold value; Invoice `amounts.total` is authoritative final revenue when present, with Job `invoicedTotal` and the accepted Quote as fallbacks. Payments are never added to invoice revenue.

## Historical test reconciliation

Two of the 18 tests omitted from the production-backed baseline were restored because their dependencies still exist: `tests/jobber-acknowledgement-resolver.test.mjs` and `tests/quo-client-name.test.mjs`. The other 16 were individually classified as obsolete for this branch: `acknowledgement-receipt-deadline.test.mjs` and `acknowledgement-source.test.mjs` require the retired acknowledgement receipt tables/feature; `asset-delivery-helpers.mjs`, `asset-delivery.test.mjs`, `city-market-exact-copy.test.mjs`, `four-guide-ai-authority-cluster.test.mjs`, `hub-hotspot-copy.test.mjs`, `hub-hotspot-layout.test.mjs`, `mobile-header.test.mjs`, `modal-focus.test.mjs`, `pest-guide-exact-copy.test.mjs`, and `protected-guide-header.test.mjs` require content/assets/scripts removed from the deployed baseline; `jobber-alert-resolver.test.mjs`, `jobber-contact-fanout.test.mjs`, `jobber-contact-resolver.test.mjs`, and `quo-phone-display.test.mjs` require retired Jobber alert/contact routes. They were run once from the historical commit and were not retained as failing tests.
