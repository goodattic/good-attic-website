import {
  buildBackfillPlan,
  buildOutcomeCandidate,
  normalizeJobberWebhook,
  persistOutcomeCandidate,
  resolveLifecycleOutcomes,
} from "./google-ads-outcome-watcher.js";

// This is intentionally a read-only coordinator. It accepts webhook IDs,
// reads the authoritative Jobber object through the caller-provided function,
// and writes only the local dry-run outbox.
export async function collectJobberLifecycle({ database, payload, readObject }) {
  const event = normalizeJobberWebhook(payload);
  if (!event.ok) return event;
  if (typeof readObject !== "function") return { ok: false, reason: "read_object_unavailable" };
  const object = await readObject(event);
  if (!object || typeof object !== "object") return { ok: false, reason: "object_not_found", event };
  const outcomes = resolveLifecycleOutcomes({
    ...object,
    topic: event.topic,
    market_key: event.market_key,
    occurred_at: event.occurred_at,
  });
  const writes = [];
  for (const outcome of outcomes) {
    const candidate = buildOutcomeCandidate({
      ...outcome,
      jobber_account_id: event.account_id,
      lead: object.lead,
      quoCall: object.quoCall,
    });
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
        const candidate = buildOutcomeCandidate({ ...outcome, lead: object?.lead, quoCall: object?.quoCall });
        if (candidate.ok) records.push(await persistOutcomeCandidate(database, candidate.candidate));
      }
    }
  }
  return { ok: true, mode: "read_only", object_types: plan.object_types, writes: records };
}
