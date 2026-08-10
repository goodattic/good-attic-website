# Jobber Appointment Publisher

## Decision

The existing Good Attic website Jobber app remains the only Jobber token
authority. Fieldflow is not in the webhook, token, queue, resolver, or event
delivery path.

```text
Jobber Assessment webhook
  -> Good Attic Pages HMAC receiver
  -> Cloudflare Queue (IDs only)
  -> tokenless publisher Worker + appointment-only D1
  -> protected Good Attic Pages resolver
  -> existing website-owned Jobber token authority
  -> Good Attic appointment consumer
  -> existing GHL contact and Central Intake opportunity move
```

Jobber sends only object IDs in a webhook. The resolver queries the current
Assessment and publishes only when both `startAt` and `endAt` are populated.
`ASSESSMENT_CREATE` and `ASSESSMENT_UPDATE` are both supported. `VISIT_*` is
intentionally unsupported.

The publisher does not call GHL, create records, or run another Jobber OAuth
consumer. The downstream consumer owns the guarded GHL move.

## Endpoints and subscriptions

- Jobber webhook URL: `https://goodattic.energy/api/jobber/webhooks/appointment-scheduled`
- Private resolver URL: `https://goodattic.energy/api/jobber/appointment-resolve`
- Consumer URL: `https://partners.goodattic.energy/api/jobber-appointment-scheduled`
- Jobber topics: `ASSESSMENT_CREATE`, `ASSESSMENT_UPDATE`
- Event name: `jobber.appointment_scheduled.v1`

Jobber HMAC validation uses the website app secret associated with the signed,
allowlisted account. Per-market app secrets are supported with the shared
`JOBBER_CLIENT_SECRET` as fallback.

## Required runtime configuration

Pages production:

- `ANGI_ROUTER_DB` (existing authoritative Jobber token D1)
- `JOBBER_CLIENT_SECRET` and/or the existing per-market app secrets
- `JOBBER_APPOINTMENT_QUEUE` producer binding
- `JOBBER_APPOINTMENT_BROKER_SECRET` (shared only with the publisher Worker)

Publisher Worker:

- `APPOINTMENT_DB` (appointment-only D1; it contains no Jobber tokens)
- `JOBBER_APPOINTMENT_RESOLVER_URL`
- `JOBBER_APPOINTMENT_BROKER_SECRET`
- `JOBBER_APPOINTMENT_CONSUMER_URL`
- `JOBBER_APPOINTMENT_CONSUMER_SECRET` (Worker secret, never committed)

Set the Worker secret with:

```sh
npx wrangler secret put JOBBER_APPOINTMENT_CONSUMER_SECRET \
  --config workers/jobber-appointment-consumer.wrangler.toml
```

The same secret must be configured on the existing consumer service. Keep it
separate from `JOBBER_APPOINTMENT_BROKER_SECRET` and every Jobber OAuth/client
credential. The publisher Worker must never receive `JOBBER_CLIENT_SECRET`, a
Jobber client ID, an access or refresh token, `JOBBER_TOKEN_STORE`, or
`ANGI_ROUTER_DB`.

## Market authority

Market is derived only from the signed Jobber account ID:

| Jobber account | `market_key` |
| --- | --- |
| Salt Lake City | `ut` |
| St. Louis | `mo_stl` |
| Kansas City | `mo_kc` |

Unknown accounts are ignored. Virtual is unsupported until an explicit,
authoritative account-to-market mapping is added. Never infer market from the
appointment title, notes, customer name, or address.

## Idempotency, responses, and retries

The business idempotency key is:

```text
jobber-assessment:<jobber_account_id>:<jobber_assessment_id>
```

The same value is sent in `event_id` and `Idempotency-Key` on every attempt.
The appointment-only D1 leases and checkpoints each Assessment. A delivered
event is not published again. An unscheduled Assessment remains eligible for a
later update after it receives start/end times. The downstream consumer also
writes this ID into the existing opportunity's `Jobber Appointment Event ID`
field, which protects the move when a successful HTTP response is lost.

Publisher response behavior:

| Consumer response | Publisher action |
| --- | --- |
| `200` | Checkpoint `delivered` and acknowledge, including `alreadyApplied` replays |
| `400` | Checkpoint `manual_review`, log loudly, acknowledge; never create a fallback |
| `401` | Checkpoint `manual_review`, log loudly, acknowledge; fix the shared secret |
| `409` | Checkpoint `manual_review`, log loudly, acknowledge; never create a fallback |
| `502` / `503` | Checkpoint `failed_retryable` and retry with backoff |
| transport / timeout / `408` / `425` / `429` / other `5xx` | Retry with backoff |
| other unexpected non-`200` | Checkpoint `manual_review` and acknowledge |

`manual_review` is deliberately terminal: later duplicate webhooks are
acknowledged without another consumer call. Recover one only after fixing the
root cause:

1. Locate and verify the exact ledger row by `event_id`.
2. Change only that row from `manual_review` to `failed_retryable`, clear its
   lease fields, retain an operator/audit reason in `last_error_code`, and update
   `updated_at`. Use a compare-and-set condition requiring the current status to
   still be `manual_review`.
3. Re-save/re-trigger that same Assessment in Jobber, or replay its captured
   original ID-only queue message. The publisher recomputes the same
   `jobber-assessment:<account>:<assessment>` event ID.
4. Verify the row reaches `delivered` before considering the incident closed.

Never change its `event_id` or create a fallback record to clear the error.

Queue retries use exponential delays from one minute up to one hour. Exhausted
events move to `good-attic-jobber-appointment-events-dlq`. Alert on any DLQ
backlog. After correcting the root cause, replay the unchanged ID-only message
and verify the ledger reaches `delivered` before acknowledging the DLQ copy.

## Consumer event contract

```json
{
  "event_name": "jobber.appointment_scheduled.v1",
  "event_id": "jobber-assessment:JOBBER_ACCOUNT_ID:JOBBER_ASSESSMENT_ID",
  "event_occurred_at": "2026-08-05T15:30:00Z",
  "route_to_sales_pipeline": true,
  "market_key": "mo_kc",
  "market_name": "Kansas City",
  "appointment_type": "assessment",
  "appointment_start_at": "2026-08-08T16:00:00Z",
  "appointment_end_at": "2026-08-08T17:00:00Z",
  "appointment_title": "Attic assessment",
  "jobber_account_id": "JOBBER_ACCOUNT_ID",
  "jobber_assessment_id": "JOBBER_ASSESSMENT_ID",
  "jobber_request_id": "JOBBER_REQUEST_ID",
  "jobber_client_id": "JOBBER_CLIENT_ID",
  "jobber_property_id": "JOBBER_PROPERTY_ID",
  "jobber_request_url": "https://secure.getjobber.com/...",
  "contact_name": "Customer Name",
  "email": "customer@example.com",
  "phone": "+18165551212"
}
```

Delivery headers:

```text
Authorization: Bearer <JOBBER_APPOINTMENT_CONSUMER_SECRET>
Content-Type: application/json
X-Good-Attic-Event: jobber.appointment_scheduled.v1
Idempotency-Key: jobber-assessment:JOBBER_ACCOUNT_ID:JOBBER_ASSESSMENT_ID
```

## Safe activation order

1. Move the reviewed bridge files to a clean production branch; do not deploy
   the current dirty backup-branch checkout.
2. Apply appointment D1 migrations through `0002`.
3. Configure the same dedicated `JOBBER_APPOINTMENT_CONSUMER_SECRET` on the
   publisher Worker and existing consumer service. Configure the separate
   broker secret on Pages and the Worker.
4. Deploy the publisher Worker, then deploy Pages with the queue producer
   binding from the clean branch.
5. Register Jobber `ASSESSMENT_CREATE` and `ASSESSMENT_UPDATE` webhooks last.
6. Test one scheduled Assessment in each market, one duplicate replay, and one
   controlled consumer outage.

Do not build or publish a GHL inbound workflow for this move. Do not use the old
GHL Appointment Confirmed trigger, create a GHL calendar appointment, treat
Visits as the signal, alter market/device-lock logic, touch Fieldflow, or
disable `ANGI_SOURCE_ROUTING_ENABLED`.

## HERMES HANDOFF

No new GHL workflow is required. The publisher sends
`jobber.appointment_scheduled.v1` directly to the already-implemented Good
Attic consumer at
`https://partners.goodattic.energy/api/jobber-appointment-scheduled`, using the
dedicated bearer secret. The consumer performs the strict existing-contact and
single-Central-Intake-opportunity checks and moves the opportunity directly.

Hermes should only verify that the same
`JOBBER_APPOINTMENT_CONSUMER_SECRET` is installed on both sides and that the
consumer endpoint returns `200` for an accepted or already-applied event. Do
not publish the draft GHL workflow, restore the old GHL webhook destination, or
add fallback contact/opportunity creation.
