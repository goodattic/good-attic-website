# Invoice lineage shadow

The opt-in Stage3c invoice path records Jobber invoice and payment state in D1
without calling a Jobber mutation or a Google upload. It is disabled by default.

## Source and delivery

Jobber documents `INVOICE_UPDATE` when a payment is applied and when the invoice
status changes. Its webhook payload contains an object ID, not the invoice. The
same docs require an acknowledgment within one second and describe at-least-once
delivery. The worker therefore verifies the HMAC over the raw body, validates
the exact Jobber Account and encoded Invoice IDs, inserts an idempotent inbox
record, and responds `202`. The five-minute cron reads at most 20 events for
five unique invoices per cycle. It fetches each invoice using a read-only
GraphQL query and records only D1 shadow observations.

The same opt-in cron also scans up to three already cached Stage 3c Jobs per
cycle, round-robin from a durable Job cursor. A candidate must match the
active call→Request link or the unsuperseded original Quo Request under the
exact account and Client. It re-reads the Job and its invoice IDs from Jobber;
it holds a partial invoice page or any account, Client, or Request conflict.
Discovered invoices use a reusable inbox key, so each subsequent scan refreshes
their payment state without growing a new inbox row every five minutes. This
provides eventual observation when the invoice webhooks are not subscribed.

The receiver accepts `INVOICE_CREATE` and `INVOICE_UPDATE` at either
`/webhooks/jobber` or `/webhooks/jobber/invoice-lineage`. The connected Jobber
app must subscribe those topics to one of those URLs and have the Invoice read
scope. A subscription is an external app configuration step; this prototype
does not create it.

## Identity and holds

The invoice query returns the account, invoice client, current and archived
jobs, each Job's client/Quote/Request links, invoice status, total,
`paymentsTotal`, and `invoiceBalance`. A single Job and agreeing Client and
Request IDs are required. Multiple jobs, truncated pagination, mismatched
accounts or Clients, and missing or conflicting Requests are held. Early
invoices with a missing Job or Request are retried for up to five observations.

The verified operational Request is passed to `resolveCallOrigin`, which uses
the active, audited Quo call→Request crosswalk. The resulting call ID and
original Request ID are stored only when that resolver confirms exact
account, Client, and Request identity. The invoice shadow stores Jobber's
aggregate `paymentsTotal` separately from invoice total; it never adds
payments to revenue or treats a paid status as proof of a Google ad call.
The `invoice_lineage_shadow_current_calls` view includes only invoices whose
stored decision still matches `call_request_lineage_active_links`. A corrected
link removes the old invoice attribution from this view immediately. Exact
matching invoices on the new Request are queued for a bounded replay; earlier
invoice revisions remain in the audit ledger.

## Activation boundary

Migrations `0008`, `0010`, `0017`, `0019`, `0023`, and
`0024_invoice_lineage_webhook_inbox.sql` must be applied before setting
`INVOICE_LINEAGE_SHADOW_ENABLED=true`. The flag is `false` in the Stage3c
Wrangler configuration. The Jobber webhook subscription is then configured
for `INVOICE_CREATE` and `INVOICE_UPDATE` in each connected app's Developer
Center settings, pointing to the deployed worker's
`/webhooks/jobber/invoice-lineage` path. The app requires Invoice read scope.
Verify the deployed callback after deployment with a signed event and monitor
`/health` for the `invoice_lineage` inbox, discovery holds, and current-call
counts. The shadow does not feed the Google outbox; any
conversion upload policy requires a separate review and change.

The current production worker has no invoice shadow health field or invoice
callback route. The prior registration record lists Request, Quote, and Job
topics; no Invoice subscription is confirmed. No migration, flag, webhook
subscription, or deployment is applied by this prototype. The cached Job
fallback depends on Stage 3c's existing Job capture and will observe an
invoice only after its Job appears there. On October 12, 2026, a read-only
connected check using unexpired cached access tokens and GraphQL version
`2025-04-16` succeeded in both Utah and St. Louis: the exact Job discovery
query returned `invoices` and page information, and the exact Invoice query
returned `jobs`, `archivedJobs`, and numeric `amounts.total`,
`amounts.paymentsTotal`, and `amounts.invoiceBalance`. The implementation's
`deriveInvoiceLineage` resolved one sampled invoice in each market with no
holds. This validates the current query shape and effective Invoice read
access for those two connected accounts; it does not validate every invoice
shape or activate the shadow.

Sources: [Jobber webhooks](https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/),
[Jobber GraphQL schema](https://developer.getjobber.com/docs/).
