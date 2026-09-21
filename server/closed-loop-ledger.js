const ENABLED_MARKETS = new Set(["ut", "mo_stl"]);
const EVENT_NAMES = new Set([
  "raw_inquiry",
  "qualified_lead",
  "appointment_set",
  "assessment_completed",
  "quote_approved",
  "sold_job",
]);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function compactUrl(value) {
  try {
    const url = new URL(clean(value, 5000));
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return "";
  }
}

function campaignFrom(payload = {}) {
  return clean(payload.utm_campaign || payload.campaign, 500);
}

function clickIdFrom(payload = {}, key) {
  const direct = clean(payload[key], 500);
  if (direct) return direct;
  try {
    const url = new URL(clean(payload.ad_landing_page || payload.source_url || payload.page_url, 5000));
    return clean(url.searchParams.get(key), 500);
  } catch {
    return "";
  }
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export function buildClosedLoopLead(payload, lead, jobber) {
  const marketKey = clean(lead?.market_key, 40);
  if (!ENABLED_MARKETS.has(marketKey)) return null;
  const requestId = clean(jobber?.request_id, 500);
  const submissionId = clean(lead?.submission_id, 500);
  if (!requestId || !submissionId) return null;

  const now = new Date().toISOString();
  return {
    lead_id: `jobber-request:${requestId}`,
    submission_id: submissionId,
    market_key: marketKey,
    jobber_account_id: clean(jobber?.account_id, 500),
    jobber_request_id: requestId,
    jobber_client_id: clean(jobber?.client_id, 500),
    original_source: clean(lead?.source_label, 120) || "Unknown",
    source_detail: clean(lead?.source_detail, 120),
    campaign: campaignFrom(payload),
    service: clean(lead?.service, 500),
    landing_page: compactUrl(payload?.ad_landing_page || lead?.source_url),
    gclid: clickIdFrom(payload, "gclid"),
    gbraid: clickIdFrom(payload, "gbraid"),
    wbraid: clickIdFrom(payload, "wbraid"),
    consent_state: clean(lead?.consent, 500),
    inquiry_at: clean(lead?.submitted_at, 80) || now,
    created_at: now,
    updated_at: now,
  };
}

export async function persistClosedLoopLead(database, record) {
  if (!database?.prepare || !record) return { ok: false, reason: "unavailable" };
  const result = await database.prepare(`
    INSERT INTO closed_loop_leads (
      lead_id, submission_id, market_key, jobber_account_id,
      jobber_request_id, jobber_client_id, original_source, source_detail,
      campaign, service, landing_page, gclid, gbraid, wbraid,
      consent_state, inquiry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jobber_request_id) DO UPDATE SET
      updated_at = excluded.updated_at
  `).bind(
    record.lead_id,
    record.submission_id,
    record.market_key,
    record.jobber_account_id || null,
    record.jobber_request_id,
    record.jobber_client_id || null,
    record.original_source,
    record.source_detail || null,
    record.campaign || null,
    record.service || null,
    record.landing_page || null,
    record.gclid || null,
    record.gbraid || null,
    record.wbraid || null,
    record.consent_state || null,
    record.inquiry_at,
    record.created_at,
    record.updated_at,
  ).run();
  return { ok: true, changed: changes(result) };
}

export function lifecycleEventId({ leadId, eventName, objectId, occurredAt }) {
  return ["closed-loop", clean(leadId, 500), clean(eventName, 80), clean(objectId, 500), clean(occurredAt, 80)].join(":");
}

export async function recordLifecycleEvent(database, input) {
  const eventName = clean(input?.event_name, 80);
  const marketKey = clean(input?.market_key, 40);
  const leadId = clean(input?.lead_id, 500);
  const occurredAt = clean(input?.occurred_at, 80);
  if (!database?.prepare || !EVENT_NAMES.has(eventName) || !ENABLED_MARKETS.has(marketKey) || !leadId || !occurredAt) {
    return { ok: false, reason: "invalid_event" };
  }

  const objectId = clean(input?.jobber_object_id, 500);
  const eventId = clean(input?.event_id, 1000) || lifecycleEventId({ leadId, eventName, objectId, occurredAt });
  const now = new Date().toISOString();
  const result = await database.prepare(`
    INSERT OR IGNORE INTO closed_loop_events (
      event_id, lead_id, market_key, event_name, jobber_object_type,
      jobber_object_id, occurred_at, value_micros, currency_code,
      google_conversion_action, upload_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventId,
    leadId,
    marketKey,
    eventName,
    clean(input?.jobber_object_type, 80) || null,
    objectId || null,
    occurredAt,
    Number.isSafeInteger(input?.value_micros) ? input.value_micros : null,
    clean(input?.currency_code, 3) || null,
    clean(input?.google_conversion_action, 500) || null,
    clean(input?.upload_status, 40) || "pending",
    now,
    now,
  ).run();
  return { ok: true, inserted: changes(result) === 1, event_id: eventId };
}

export async function reconcileMetric(database, input) {
  const date = clean(input?.reconciliation_date, 10);
  const marketKey = clean(input?.market_key, 40);
  const metricName = clean(input?.metric_name, 120);
  const sourceCount = Math.max(0, Number(input?.source_count) || 0);
  const destinationCount = Math.max(0, Number(input?.destination_count) || 0);
  if (!database?.prepare || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !ENABLED_MARKETS.has(marketKey) || !metricName) {
    return { ok: false, reason: "invalid_reconciliation" };
  }

  const differenceCount = sourceCount - destinationCount;
  const differenceRate = sourceCount === 0 ? (destinationCount === 0 ? 0 : 1) : Math.abs(differenceCount) / sourceCount;
  const alertStatus = differenceRate > 0.15 ? "critical" : differenceRate > 0 ? "warning" : "ok";
  await database.prepare(`
    INSERT INTO closed_loop_reconciliation (
      reconciliation_date, market_key, metric_name, source_count,
      destination_count, difference_count, difference_rate,
      alert_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reconciliation_date, market_key, metric_name) DO UPDATE SET
      source_count = excluded.source_count,
      destination_count = excluded.destination_count,
      difference_count = excluded.difference_count,
      difference_rate = excluded.difference_rate,
      alert_status = excluded.alert_status,
      created_at = excluded.created_at
  `).bind(
    date,
    marketKey,
    metricName,
    sourceCount,
    destinationCount,
    differenceCount,
    differenceRate,
    alertStatus,
    new Date().toISOString(),
  ).run();
  return { ok: true, difference_count: differenceCount, difference_rate: differenceRate, alert_status: alertStatus };
}

export const _private = {
  ENABLED_MARKETS,
  EVENT_NAMES,
  campaignFrom,
  clickIdFrom,
  compactUrl,
};
