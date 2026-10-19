# Kansas City website Quote fields

This change fills the KC Quote fields **Original Lead ID**, **Original Source**, and **Campaign** for new website form Requests with a completed source chain. It does not replay historical Quotes or infer a website source from a call or manually created Request.

## Source decisions

- A completed KC website form transaction, exact Website Leads account/Request/Client identity, and exact website acknowledgement receipt are required for every automatic Quote write.
- `Google Ads` additionally requires the completed paid source proof and matching closed-loop lead, including the verified click or paid signal. No click or campaign is invented.
- `Organic Online` requires the server-authored nonpaid attestation from migration `0033`, prepared before the Jobber write. Its Campaign field is blank.
- A submission UUID cannot have both source classes. The migration has reciprocal SQLite insert triggers, and both writers check the opposite class before a Jobber mutation. A source switch or unavailable nonpaid attestation holds intake for review.
- KC Quote writes never use the call-origin fallback. Divergent staff-entered values and ambiguous custom field definitions require manual review. Quote identity, proof, and all three field values are checked again around mutation.

## Release order

1. Apply `migrations/0033_kc_website_nonpaid_source_attestations.sql` to the production `ANGI_ROUTER_DB` only after confirming the existing `website_google_source_proofs` table. Verify the new table and both triggers. This migration is required before deploying Pages because the paid and nonpaid intake paths query the new table.
2. Verify the Quote consumer's live queue, broker secret, service binding, and plain vars against its dry-run. Keep global `JOBBER_QUOTE_TEST_MODE=false`; turning it on for only KC would acknowledge and drop UT/STL events.
3. Deploy **only** `good-attic-jobber-quote-consumer` first. The prior consumer rejects KC account events. Leave the separate Stage3c `good-attic-angi-jobber-router` Worker at its current live version.
4. Verify Pages production has the shared Website Leads `JOBBER_CLIENT_SECRET`, the KC Website OAuth credentials/token, `ACKNOWLEDGEMENT_SOURCE_ENABLED=true`, the `JOBBER_QUOTE_QUEUE` producer, and the D1 binding. Verify the KC Website Leads app's `QUOTE_CREATE` webhook targets `/api/jobber/webhooks/quote-created`.
5. Run the Pages build and live-site release guard, then deploy Pages. This activates KC writes immediately because the production flags are enabled. Verify one new paid and one new nonpaid KC website Quote from their exact Request/Client/form/proof chain before treating rollout as complete.

The KC nonpaid transaction reservation retains the existing fail-open lead intake behavior. If reservation is unavailable, the Request can still be created, but its Quote fields remain ineligible without the completed transaction. The Request/Client is recorded in `website_form_reconciliation_attempts` where possible and logged for manual reconciliation. A missing receipt or post-write attestation completion also leaves the Quote pending or held; it must not be relabeled from the absence of Google proof. The Quote queue has bounded retries for pending lineage, so unresolved cases need manual review.

Rollback Pages first if the resolver causes trouble. The KC-capable consumer can continue processing UT/STL while Pages is rolled back. Do not remove migration `0033` during rollback because the source rows and triggers preserve submission identity.
