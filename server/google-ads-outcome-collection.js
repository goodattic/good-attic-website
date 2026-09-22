import {
  buildBackfillPlan,
  buildOutcomeCandidate,
  normalizeJobberWebhook,
  persistOutcomeCandidate,
  resolveLifecycleOutcomes,
} from "./google-ads-outcome-watcher.js";

const CALL_MARKET = { ut: "utah", mo_stl: "stl" };

// Join the authoritative Jobber object to the two existing attribution ledgers.
// This helper only reads; it never changes a lead, call, or Jobber record.
export async function loadRequestAttribution({ database, market_key, jobber_request_id }) {
  if (!database?.prepare || !jobber_request_id) return { lead: null, quoCall: null, quoCalls: [] };
  const leadStatement = database.prepare(
    "SELECT * FROM closed_loop_leads WHERE market_key = ? AND jobber_request_id = ? LIMIT 1",
  ).bind(market_key, jobber_request_id);
  const lead = typeof leadStatement.first === "function" ? await leadStatement.first() : null;
  const callMarket = CALL_MARKET[market_key];
  const callStatement = callMarket
    ? database.prepare(
      "SELECT * FROM quo_call_attributions WHERE market = ? AND jobber_request_id = ? ORDER BY created_at ASC LIMIT 1",
    ).bind(callMarket, jobber_request_id)
    : null;
  let quoCalls = [];
  if (callStatement && typeof callStatement.all === "function") quoCalls = (await callStatement.all())?.results || [];
  const quoCall = quoCalls[0] || (callStatement && typeof callStatement.first === "function" ? await callStatement.first() : null);
  return { lead: lead || null, quoCall: quoCall || null, quoCalls };
}

export async function collectJobberRequestLifecycle({ database, market_key, account_id, request_id, occurred_at, readObject }) {
  if (typeof readObject !== "function") return { ok: false, reason: "read_object_unavailable" };
  const object = await readObject({ market_key, account_id, request_id });
  if (!object || typeof object !== "object") return { ok: false, reason: "object_not_found" };
  const attribution = await loadRequestAttribution({ database, market_key, jobber_request_id: request_id });
  const outcomes = resolveLifecycleOutcomes({
    ...object,
    topic: object.topic,
    market_key,
    jobber_request_id: object.jobber_request_id || request_id,
    occurred_at: object.occurred_at || occurred_at,
  });
  const writes = [];
  const calls = object.quoCall ? [object.quoCall] : (attribution.quoCalls.length ? attribution.quoCalls : [{}]);
  for (const outcome of outcomes) for (const quoCall of calls) {
    const event_name = quoCall.quo_call_id && outcome.event_name === "appointment_set" ? "qualified_lead" : outcome.event_name;
    const candidate = buildOutcomeCandidate({ ...outcome, event_name, jobber_account_id: account_id, lead: object.lead || attribution.lead || {}, quoCall });
    if (candidate.ok) writes.push(await persistOutcomeCandidate(database, candidate.candidate));
  }
  return { ok: true, market_key, request_id, outcome_count: outcomes.length, writes, attribution_source: { website: Boolean(attribution.lead), quo: Boolean(attribution.quoCall) } };
}

// This is intentionally a read-only coordinator. It accepts webhook IDs,
// reads the authoritative Jobber object through the caller-provided function,
// and writes only the local dry-run outbox.
export async function collectJobberLifecycle({ database, payload, readObject }) {
  const event = normalizeJobberWebhook(payload);
  if (!event.ok) return event;
  if (typeof readObject !== "function") return { ok: false, reason: "read_object_unavailable" };
  const object = await readObject(event);
  if (!object || typeof object !== "object") return { ok: false, reason: "object_not_found", event };
  const attribution = await loadRequestAttribution({ database, market_key: event.market_key, jobber_request_id: object.jobber_request_id });
  const outcomes = resolveLifecycleOutcomes({
    ...object,
    topic: event.topic,
    market_key: event.market_key,
    occurred_at: event.occurred_at,
  });
  const writes = [];
  const calls = object.quoCall ? [object.quoCall] : (attribution.quoCalls.length ? attribution.quoCalls : [{}]);
  for (const outcome of outcomes) for (const quoCall of calls) {
    const event_name = quoCall.quo_call_id && outcome.event_name === "appointment_set" ? "qualified_lead" : outcome.event_name;
    const candidate = buildOutcomeCandidate({ ...outcome, event_name, jobber_account_id: event.account_id, lead: object.lead || attribution.lead || {}, quoCall });
    if (candidate.ok) writes.push(await persistOutcomeCandidate(database, candidate.candidate));
  }
  return { ok: true, event, outcome_count: outcomes.length, writes };
}

export async function runReadOnlyBackfill({ database, market_key, since, listObjects, readObject }) {
  const plan = buildBackfillPlan({ market_key, since });
  if (!plan.ok) return plan;
  if (typeof listObjects !== "function" || typeof readObject !== "function") return { ok: false, reason: "backfill_reader_unavailable", plan };
  const records = [];
  for (const objectType of plan.object_types) {
    const ids = await listObjects({ market_key, objectType, since: plan.since, query: plan.queries[objectType] });
    for (const id of ids || []) {
      const object = await readObject({ market_key, objectType, id });
      const outcomes = resolveLifecycleOutcomes({ ...object, market_key, topic: object?.topic });
      for (const outcome of outcomes) {
        const attribution = await loadRequestAttribution({ database, market_key, jobber_request_id: object?.jobber_request_id || id });
        const calls = object?.quoCall ? [object.quoCall] : (attribution.quoCalls.length ? attribution.quoCalls : [{}]);
        for (const quoCall of calls) {
          const event_name = quoCall.quo_call_id && outcome.event_name === "appointment_set" ? "qualified_lead" : outcome.event_name;
          const candidate = buildOutcomeCandidate({ ...outcome, event_name, lead: object?.lead || attribution.lead || {}, quoCall });
          if (candidate.ok) records.push(await persistOutcomeCandidate(database, candidate.candidate));
        }
      }
    }
  }
  return { ok: true, mode: "read_only", object_types: plan.object_types, writes: records };
}
