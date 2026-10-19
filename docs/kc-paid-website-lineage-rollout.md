# KC paid website lineage rollout

This poller reads Jobber through the KC Website Leads app and records exact
Request, assessment, Quote, Job, and Invoice links in the existing D1 database.
It does not edit Jobber, populate Jobber custom fields, write
`closed_loop_events`, or send anything to Google Ads. A scheduled run uses the
existing quote Worker's 30-minute cron and `JOBBER_QUOTE_BROKER_SECRET` on both
the Worker and Pages endpoint. A D1 lease serializes overlapping poll runs.

## Release order

1. Audit the already deployed Stage 3c outcome Worker before applying migration
   0030. That Worker reads `closed_loop_leads`; admitting KC leads there may
   activate its Google Data Manager path independently of this poller. Check its
   KC eligibility, conversion action, transaction ID, and deduplication rules.
2. Apply `0030_kc_proven_website_closed_loop.sql` after that audit. It admits
   only source-proof-backed KC website form rows to `closed_loop_leads`.
3. Apply `0031_kc_paid_website_lineage.sql` to the same production D1 database.
4. Deploy Pages with `/api/jobber/kc-paid-lineage-poll`, then verify the endpoint
   rejects an unauthenticated POST and can read the exact KC Jobber account.
5. Deploy the updated `good-attic-jobber-quote-consumer` Worker last. Its checked
   in configuration sets `KC_PAID_LINEAGE_POLL_ENABLED = "true"`, so each existing
   30-minute scheduled run calls the protected Pages endpoint. Deploying the
   Worker before steps 2–4 causes failing scheduled polls.

The production Pages project and quote Worker already have a secret named
`JOBBER_QUOTE_BROKER_SECRET`; no new secret or Jobber OAuth scope is needed.
The KC Website Leads app was verified to read Request, assessment, Quote, Job,
and Invoice connections under GraphQL version `2025-04-16`.

## Reconciliation

`kc_paid_lineage_objects` contains only Jobber object IDs, exact Request and
Client IDs, status, and relationship IDs. `kc_paid_lineage_polls` records the
last result for each lead. A source-proof mismatch, mixed Request or Client,
incomplete pagination, disappeared object, or cross-lead collision prevents a
new linked chain. Permanent conflicts remain held until reviewed. Transient
read failures mark previously linked objects unverified until a complete poll
can restore them. Relationship mismatches get one full read retry and remain
retryable until the same mismatch recurs on a later scheduled poll. A stable
mixed-Request Invoice is held immediately. No historical reconciliation row without the
original completed source proof, form transaction, and website receipt enters
this poller.

Example read-only production checks after one cron run:

```sql
SELECT status, COUNT(*) AS leads FROM kc_paid_lineage_polls GROUP BY status;
SELECT object_type, status, COUNT(*) AS objects
FROM kc_paid_lineage_objects GROUP BY object_type, status;
SELECT lead_id, request_id, hold_code, last_polled_at
FROM kc_paid_lineage_polls WHERE status = 'held'
ORDER BY last_polled_at DESC LIMIT 20;
```

This table is an internal relationship ledger. It does not guarantee that
Google Ads received an assessment, Quote, Job, or Invoice conversion. That
depends on the separately deployed outcome path and its eligibility rules.
