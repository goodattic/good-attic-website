# Phase 2 outcome watcher — discovery and dry-run contract

## Scope and safety

This implementation is local and dry-run only. It is limited to `ut` and `mo_stl`; Kansas City is rejected before any ledger write. No Google request, conversion-action mutation, Jobber mutation, migration, or deployment is performed by this branch.

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

The uploader interface is disabled by default and uses a fake transport in tests. Website candidates carry exactly one of GCLID, GBRAID, or WBRAID. Call candidates carry the E.164 caller number and original call-start timestamp. Every request uses USD, a deterministic order ID, bounded retry classification, sanitized diagnostics, and consent/attribution holds. Upload windows and adjustment/retraction support are supplied by the action map; unknown windows stay held.

## Current action discovery

The signed-in Google Ads page exposed these existing actions without changing them: `DA - Submit Lead Form` (Website, primary), `DA - Website Calls (UT)` (Website, primary), `DA - Website Call (MO)` (Website, primary), `Call from Ad Extension` (Call from Ads, primary), `Calls from ads` (Call from Ads, secondary), `DA - Quote Request (MO)` (Website, secondary), and inactive GA4 actions. The proposed `GAE - ...` names from the earlier design were not present on the visible current page and must not be assumed to exist. Exact IDs, upload windows, call-time matching eligibility, and adjustment/retraction support require a re-authenticated Google Ads/API discovery pass before first upload.

## Reconciliation

The local coordinator runs a read-only backfill and writes only the dry-run outbox. Production reconciliation remains pending until the action map is re-authenticated and the Jobber read scopes/objects are queried for both accounts. No production totals are fabricated from absent records.
