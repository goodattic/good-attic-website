# Utah + St. Louis closed-loop rollout

Status: implementation branch only. Nothing in this branch is deployed to production and Google Ads bidding must remain unchanged.

## Existing production flow verified in this repository

1. The browser preserves Google click identifiers and campaign values for up to 90 days.
2. The lead endpoint creates the Jobber client and request first.
3. The request ID and ad attribution are then forwarded to the current attribution receiver.
4. Jobber Request webhooks already resolve scheduled in-home assessments through the existing queue.

## Approved first-market scope

Markets: `ut`, `mo_stl`. Kansas City is deliberately excluded from the new ledger until these two markets reconcile.

### Durable inquiry record

For every accepted website inquiry, write one `closed_loop_leads` row after Jobber returns a request ID. The stable lead key is `jobber-request:<request id>`. Store only reporting data: market, source, campaign, service, landing page, click identifiers, consent state and timestamps. Do not store name, phone, email, street address or notes in this ledger.

The new Jobber fields already created in both accounts are:

- Original Lead ID
- Original Source
- Campaign

They are transferable from quote to job to invoice. The integration must seed them when the first quote is created; staff should not type them manually.

### Lifecycle definitions

- `raw_inquiry`: Jobber accepted a new request.
- `qualified_lead`: a staff-reviewed homeowner in the service area seeking installed work; unknown value remains pending, not disqualified.
- `appointment_set`: Jobber has a scheduled in-home assessment with start and end times.
- `assessment_completed`: the scheduled assessment is marked complete, not merely scheduled.
- `quote_approved`: the customer approved a Jobber quote.
- `sold_job`: approved work exists as a Jobber job. Revenue value comes from the approved quote/job total; final reporting can later reconcile to paid invoices.

Each event uses a deterministic ID and `INSERT OR IGNORE`. Duplicate Jobber webhooks must never create duplicate Google outcomes.

### Google outcome mapping

Use the existing secondary actions while validating:

- Appointment Set -> `GAE - Appointment Set (CRM)`
- Assessment Completed -> `GAE - Assessment Completed (CRM)`
- Qualified phone lead -> `GAE - Qualified Call Lead (CRM)`
- Sold Job -> `GAE - Sold Job (CRM)` with value and account currency

Match with GCLID/GBRAID/WBRAID when available. Use consented enhanced lead matching only when click IDs are unavailable and the current consent permits it. Keep raw form submissions as the current bidding signal until at least four consecutive weekly reconciliations pass and sold-job volume is sufficient for a bidding decision.

## Reconciliation safeguards

Run daily deduplication/error processing and a weekly Utah/St. Louis reconciliation for:

- accepted website inquiries vs Jobber requests
- scheduled assessments vs Appointment Set uploads
- completed assessments vs Assessment Completed uploads
- approved jobs vs Sold Job uploads

Alert when the absolute mismatch exceeds 15%. A zero denominator with nonzero destination records is critical. Failed uploads remain retryable; ambiguous matches go to manual review and are never guessed.

## Deployment gates

Before production:

1. Apply `migrations/0005_closed_loop_tracking.sql` to a non-production D1 database.
2. Keep preview external writes disabled.
3. Run all repository tests plus `tests/closed-loop-ledger.test.mjs`.
4. Confirm the Jobber app can read quote/job/invoice changes and update the three approved custom fields.
5. Register only the required Utah and St. Louis webhooks.
6. Validate with mocked webhook payloads and isolated destinations—no production leads, calls or texts.
7. Verify event deduplication, replay handling and a forced destination failure.
8. Review the exact deployment diff and rollback assets.
9. Deploy the ledger in shadow mode first: record outcomes but do not upload them.
10. Compare shadow results to Jobber for one full week before enabling Google uploads.

## Preview verification completed

- The preview builds successfully.
- Preview API writes are blocked by `EXTERNAL_API_WRITES_ENABLED=false`.
- Preview responses carry a noindex/nofollow directive.
- The post-Jobber attribution path now writes the PII-minimized Utah/St. Louis inquiry record before forwarding attribution.
- Kansas City remains outside the first durable rollout.

## Remaining implementation work

- Apply the ledger schema to an isolated test database and run the full test command in preview.
- Add Jobber quote/job/invoice webhook resolver support using the existing token authority and queue pattern.
- Resolve the three Jobber custom field identifiers per account and seed them on quote creation/update.
- Add a Google upload worker with deterministic order IDs, consent checks, retry/manual-review states and partial-failure logging.
- Add the weekly reconciliation worker and alert destination.
- Remove HighLevel from any operational success criteria; Jobber is the CRM of record.

Do not merge or deploy until all gates above are complete.
