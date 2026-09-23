# Stage 3a: one real canary upload

Exactly one real event was sent by this work through the cloud worker's Data Manager API at approximately 2026-09-23T20:08:18Z. No other event was sent, and no validate-only batch was run in this stage.

- Event / transaction ID: gae-stl-sold-65203544.
- Customer: 4800890529; conversion action: GAE - Sold Job (CRM), 7754270382.
- Market / Jobber account: St. Louis / 2498453.
- Value: 5290.40 USD.
- Conversion timestamp sent: 2026-09-22T02:53:22+00:00.
- Exactly one identifier: GCLID. No GBRAID, WBRAID, email or phone was sent.
- Event source: OTHER (CRM outcome); validateOnly=false; request contained exactly one event and one destination.
- Website attribution capture: 2026-08-27T15:03:57.006Z, from website_attribution_archive. This is the timestamp at which the identifier was recorded with the website lead, not an independently verified Google click timestamp. The actual click date is not independently known from this evidence.

## Full ingestion response

HTTP 200:

```json
{
  "requestId": "e9071fc4-f101-4586-8bf5-e700179d6e8e"
}
```

## Diagnostics

Called GET https://datamanager.googleapis.com/v1/requestStatus:retrieve with requestId e9071fc4-f101-4586-8bf5-e700179d6e8e at 2026-09-23T20:08:20.571Z. HTTP 404:

```json
{
  "error": {
    "code": 404,
    "message": "Resource not found.",
    "status": "NOT_FOUND",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "NOT_FOUND",
        "domain": "datamanager.googleapis.com",
        "metadata": {
          "requestId": "t-2986c477-c01a-42fc-93cf-fd020d1b0a9a"
        }
      },
      {
        "@type": "type.googleapis.com/google.rpc.RequestInfo",
        "requestId": "t-2986c477-c01a-42fc-93cf-fd020d1b0a9a"
      }
    ]
  }
}
```

No processing status, record count, matching status, errors about the conversion itself, or attribution result is available from that response. NOT_FOUND is the immediate diagnostics lookup result; it does not undo the successful ingestion response or establish conversion failure. Google recommends a first diagnostics check after 30 minutes, with processing potentially taking up to 24 hours. The earliest recommended follow-up is approximately 2026-09-23T20:38:18Z (2:38 PM Mountain). This report does not claim a matched or credited sale.

Reference: https://developers.google.com/data-manager/api/devguides/diagnostics

## Final controls and outbox

GOOGLE_ADS_UPLOAD_ENABLED remained false throughout on both good-attic-jobber-phase2-backfill and good-attic-google-ads-outcome-uploader. No general production uploader was enabled. A hardcoded one-event path had a durable one-time D1 claim before its only ingestion request; a repeat call or uncertain network failure could not resend it. That temporary send route was removed from the deployed bundle at 2026-09-23T20:08:33.985533Z. The final production wrapper returns 410 for that route; authenticated read-only Google diagnostics remain available via /stage3a-canary-status. No automatic resend or diagnostics polling was installed.

Final D1 audit: one accepted event, gae-stl-sold-65203544, attempt_count=1; all other 559 events shadow, attempt_count=0. The accepted state means ingestion accepted, not match confirmed, and is labeled DATA_MANAGER_INGESTION_ACCEPTED_NOT_MATCH_CONFIRMED. The shadow reconciler cannot reset or resubmit an accepted entry.

The complete request, response and diagnostics are retained in the protected D1 closed_loop_stage3a_canary table. The response, diagnostics, deployment proof and outbox audit are also supplied as JSON artifacts alongside this report; these contain no credential values.

No Sheet, Sheet Data Manager connection, conversion action setting, primary/secondary setting, campaign, bidding setting, or HighLevel configuration was changed. Existing Secondary settings were left as-is. The unrelated existing Sheet scheduled imports were not disabled or otherwise altered; the single-send assertion concerns this pipeline action.

Five relevant canary tests passed: exact event/value/action enforcement, single identifier, concurrent-call deduplication, ambiguous failure cannot resend, disabled general flag, and final send-route closure (some assertions share a test).
