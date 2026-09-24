# Stage 3c cutover results

As of 2026-09-24T20:35:42.211Z.

Both Google Ads Sheet connections are **Not scheduled** (paused, not deleted). The Sheet and conversion-action settings were not changed. Cloudflare uploads are enabled for Utah, St. Louis, and Kansas City. Historical appointments remain held. The accepted canary was not resent.

The 25 checks at 2026-09-24 20:34:59–20:35:18 UTC (30–31 minutes after submission) all returned HTTP 200 and `requestStatus: "PROCESSING"`, with no errors or warnings. Final accepted / duplicate / failed counts for this batch are therefore **0 / 0 / 0**, with **25 pending**. The cloud worker rechecks pending requests every five minutes without resending them.

| Event ID | Market | USD | Result | Exact Google error | Google request ID | Diagnostics checked (UTC) |
|---|---|---:|---|---|---|---|
| gae-kc-assessment-34233266 | Kansas City | 0.00 | PROCESSING | — | 7e858c70-3829-456a-b1dd-fc689bf8bf85 | 2026-09-24T20:35:18.899Z |
| gae-stl-assessment-32616842 | St. Louis | 0.00 | PROCESSING | — | 1eec6605-a4bb-4d46-9f7d-5bd9b72e961c | 2026-09-24T20:35:02.034Z |
| gae-stl-assessment-32937071 | St. Louis | 0.00 | PROCESSING | — | c764f141-3d3e-4aad-aff3-92be0e964df7 | 2026-09-24T20:35:04.178Z |
| gae-stl-assessment-33042289 | St. Louis | 0.00 | PROCESSING | — | c71aab8e-fbca-47d1-9983-e80f9d74f9e2 | 2026-09-24T20:35:08.871Z |
| gae-stl-assessment-33051732 | St. Louis | 0.00 | PROCESSING | — | 3a87c110-6b77-4944-b8e1-63db18742e79 | 2026-09-24T20:35:07.595Z |
| gae-stl-assessment-33055585 | St. Louis | 0.00 | PROCESSING | — | 90447eb4-91cb-4c5c-bbe8-c3778689d902 | 2026-09-24T20:35:05.941Z |
| gae-stl-assessment-33078548 | St. Louis | 0.00 | PROCESSING | — | c9c489ff-8ee8-402c-a086-f6df66ae827b | 2026-09-24T20:35:06.718Z |
| gae-stl-assessment-33301112 | St. Louis | 0.00 | PROCESSING | — | 4f88ad58-1974-4696-b86b-54121828a636 | 2026-09-24T20:35:11.483Z |
| gae-stl-assessment-33359002 | St. Louis | 0.00 | PROCESSING | — | c54affbc-0242-4c6b-8307-514bb2e6451e | 2026-09-24T20:35:12.943Z |
| gae-stl-assessment-33833856 | St. Louis | 0.00 | PROCESSING | — | 67c0be61-47bb-4e3b-8e4b-ad9dac50c7a6 | 2026-09-24T20:35:17.421Z |
| gae-stl-assessment-33865725 | St. Louis | 0.00 | PROCESSING | — | b8d2979c-a3bf-49ff-998a-9bd1f68b44fb | 2026-09-24T20:35:15.082Z |
| gae-stl-sold-63891747 | St. Louis | 4500.00 | PROCESSING | — | 8559afa0-aacf-41f3-b950-9308344d2680 | 2026-09-24T20:35:15.746Z |
| gae-stl-sold-64231311 | St. Louis | 6487.00 | PROCESSING | — | 72532f71-4479-4e8f-b7bb-10c8699178c7 | 2026-09-24T20:35:05.160Z |
| gae-stl-sold-64405592 | St. Louis | 3493.00 | PROCESSING | — | 183bc5c5-5e18-48eb-9c5b-8d58b0b469c6 | 2026-09-24T20:35:08.333Z |
| gae-stl-sold-64423473 | St. Louis | 17860.00 | PROCESSING | — | 92f6766c-f673-4330-a3e6-8af0f22047d8 | 2026-09-24T20:35:09.842Z |
| gae-stl-sold-64534205 | St. Louis | 2750.00 | PROCESSING | — | be6e6c26-c258-40c3-9123-5b8d92d1486a | 2026-09-24T20:35:10.509Z |
| gae-slc-assessment-32424204 | Utah | 0.00 | PROCESSING | — | 020f0d37-a64a-42c3-acc7-26cd29b66494 | 2026-09-24T20:35:02.919Z |
| gae-slc-assessment-32484404 | Utah | 0.00 | PROCESSING | — | 81d486e5-bb45-4897-bffa-07e3ac5bbc92 | 2026-09-24T20:35:01.031Z |
| gae-slc-assessment-32503302 | Utah | 0.00 | PROCESSING | — | 83026b94-eba9-4b9a-95de-295bd751b9fb | 2026-09-24T20:34:59.995Z |
| gae-slc-assessment-33353912 | Utah | 0.00 | PROCESSING | — | 33961f65-681c-40ac-8551-93398fa2d5bf | 2026-09-24T20:35:12.069Z |
| gae-slc-assessment-33842250 | Utah | 0.00 | PROCESSING | — | ec7f5344-b7ad-4a27-ba13-770d2dae790a | 2026-09-24T20:35:13.662Z |
| gae-slc-assessment-33977292 | Utah | 0.00 | PROCESSING | — | 910ce720-d4cf-488d-8736-0a3eff817146 | 2026-09-24T20:35:16.171Z |
| gae-slc-sold-63859930 | Utah | 3664.98 | PROCESSING | — | 8394b9b3-4a0e-4fc8-8a96-9f71ec506f53 | 2026-09-24T20:35:10.991Z |
| gae-slc-sold-65441706 | Utah | 5988.00 | PROCESSING | — | d875dd81-2379-47fb-ac51-002ba81dd726 | 2026-09-24T20:35:14.325Z |
| gae-slc-sold-65678461 | Utah | 2496.00 | PROCESSING | — | a31d2378-a6f2-49de-b6db-c791f669cea2 | 2026-09-24T20:35:16.761Z |

All raw ingestion and diagnostic responses are in [google-results.json](google-results.json). HTTP 200 ingestion responses are not final processing acceptance; rows remain processing until Google returns a terminal status. Successful processing does not itself confirm campaign credit.

## Health

```json
{
  "mode": "live",
  "google_upload_enabled": true,
  "real_upload_transport": "data_manager_api",
  "validation_transport": "data_manager_api",
  "markets": [
    "ut",
    "mo_stl",
    "mo_kc"
  ],
  "last_successful_run_at": "2026-09-24T20:31:07.425Z",
  "last_successful_scheduled_run_at": "2026-09-24T20:31:07.425Z",
  "metrics_since": "2026-09-23T19:09:30.170Z",
  "last_24h": {
    "successful_runs": 286,
    "events_processed": 31207,
    "unique_events_touched": 576,
    "new_shadow_events": 16,
    "webhooks_processed": 126
  },
  "events_processed_definition": "Distinct outcome evaluations per successful run, summed across runs; repeated reconciliation is included.",
  "customer_data_exposed": false,
  "uploads_enabled": true,
  "events_uploaded_last_24h": 25,
  "upload_counts": {
    "accepted": 1,
    "failed": 0,
    "duplicate": 0,
    "processing": 25,
    "in_flight": 0
  },
  "last_successful_upload_run_at": "2026-09-24T20:35:19.184Z"
}
```

The health accepted count of 1 is the existing canary, not one of the 25 cutover events. `events_uploaded_last_24h` counts submissions with a Google request ID; it does not mean final acceptance.

The canary retains one attempt: {"outcome_id":"gae-stl-sold-65203544","upload_state":"accepted","attempt_count":1,"last_attempt_at":"2026-09-23T20:08:18.022Z"}.

Focused pipeline tests passed. The full repository suite had 250 passing tests and two historical release-snapshot guard failures, which reject the already expanded pipeline branch file set.
