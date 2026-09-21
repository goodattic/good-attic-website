const ENABLED_MARKETS = new Set(["ut", "mo_stl"]);
const EVENT_NAMES = new Set([
  "qualified_lead", "appointment_set", "assessment_completed",
  "sold_job", "revenue_restatement", "cancellation",
]);
const UPLOAD_STATES = new Set([
  "held", "pending", "validating", "submitted", "accepted", "rejected",
  "retryable", "permanently_failed", "retracted",
]);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function iso(value) {
  const text = clean(value, 80);
  return text && Number.isFinite(Date.parse(text)) ? text : "";
}

function idPart(value) { return clean(value, 500) || "_"; }

export function outcomeId(input) {
  return ["google-ads-outcome", idPart(input?.event_name), idPart(input?.attribution_path),
    idPart(input?.quo_call_id), idPart(input?.jobber_request_id), idPart(input?.jobber_quote_id),
    idPart(input?.jobber_job_id), idPart(input?.jobber_invoice_id), idPart(input?.milestone_at)].join(":");
}

export function classifyAttribution({ lead = {}, quoCall = {} } = {}) {
  const clickId = clean(lead.gclid || lead.gbraid || lead.wbraid, 500);
  const path = clean(quoCall.quo_call_id ? "quo_call" : "website", 30);
  // A click ID is evidence that a lead came through a Google-tagged path, but
  // it is not a successful Google Ads match. Calls remain pending until Google
  // accepts the caller/time match; no source inference is performed.
  return {
    attribution_path: path,
    attribution_status: "pending",
    evidence: clickId ? "click_id_present_pending_match" : "unverified_pending_match",
  };
}

export function qualifiedLeadEligibility(input = {}) {
  const homeowner = input.homeowner === true;
  const serviceArea = input.service_area_valid === true;
  const installed = input.installed_service === true;
  const expected = Number(input.expected_value_usd);
  if (![homeowner, serviceArea, installed].every(Boolean) || !Number.isFinite(expected)) {
    return { eligible: false, status: "held", reason: "required_qualification_fields_missing" };
  }
  if (expected < 2000) return { eligible: false, status: "ineligible", reason: "expected_value_below_threshold" };
  return { eligible: true, status: "held", reason: "awaiting_attribution_and_consent" };
}

export function buildOutcomeCandidate(input = {}) {
  const market = clean(input.market_key, 40);
  const event = clean(input.event_name, 80);
  if (!ENABLED_MARKETS.has(market)) return { ok: false, reason: "market_not_enabled" };
  if (!EVENT_NAMES.has(event)) return { ok: false, reason: "event_not_supported" };
  const milestone = iso(input.milestone_at || input.occurred_at);
  if (!milestone) return { ok: false, reason: "invalid_milestone_time" };
  const attribution = classifyAttribution(input);
  const qualified = event === "qualified_lead" ? qualifiedLeadEligibility(input) : { eligible: true, status: "held" };
  const quoCall = input.quoCall || {};
  const lead = input.lead || {};
  const candidate = {
    outcome_id: outcomeId({ ...input, attribution_path: attribution.attribution_path, milestone_at: milestone }),
    event_name: event,
    market_key: market,
    attribution_path: attribution.attribution_path,
    attribution_status: attribution.attribution_status,
    source_lead_id: clean(lead.lead_id, 500) || null,
    submission_id: clean(lead.submission_id, 500) || null,
    gclid: clean(lead.gclid, 500) || null,
    gbraid: clean(lead.gbraid, 500) || null,
    wbraid: clean(lead.wbraid, 500) || null,
    quo_call_id: clean(quoCall.quo_call_id, 500) || null,
    caller_phone: clean(quoCall.caller_phone, 40) || null,
    call_started_at_original: clean(quoCall.call_started_at_original, 120) || null,
    call_started_at_utc: iso(quoCall.call_started_at_utc) || null,
    call_timezone: clean(quoCall.call_timezone, 80) || null,
    jobber_account_id: clean(input.jobber_account_id || lead.jobber_account_id, 500) || null,
    jobber_request_id: clean(input.jobber_request_id || lead.jobber_request_id, 500) || null,
    jobber_client_id: clean(input.jobber_client_id || lead.jobber_client_id, 500) || null,
    jobber_appointment_id: clean(input.jobber_appointment_id, 500) || null,
    jobber_quote_id: clean(input.jobber_quote_id, 500) || null,
    jobber_job_id: clean(input.jobber_job_id, 500) || null,
    jobber_invoice_id: clean(input.jobber_invoice_id, 500) || null,
    google_account_id: clean(input.google_account_id, 500) || null,
    google_conversion_action: clean(input.google_conversion_action, 500) || null,
    milestone_at: milestone,
    conversion_at: iso(input.conversion_at) || null,
    value_micros: Number.isSafeInteger(input.value_micros) ? input.value_micros : null,
    currency_code: input.value_micros == null ? null : "USD",
    revenue_source: clean(input.revenue_source, 120) || null,
    revenue_version: clean(input.revenue_version, 80) || null,
    prior_reported_value_micros: Number.isSafeInteger(input.prior_reported_value_micros) ? input.prior_reported_value_micros : null,
    service_type: clean(input.service_type || lead.service, 500) || null,
    consent_status: clean(input.consent_status || lead.consent_state, 30) || "unknown",
    consent_evidence: clean(input.consent_evidence, 1000) || null,
    upload_state: qualified.status,
    diagnostic_code: qualified.reason || attribution.evidence,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (!new Set(["unknown", "granted", "denied"]).has(candidate.consent_status)) candidate.consent_status = "unknown";
  return { ok: true, candidate };
}

export async function persistOutcomeCandidate(database, candidate) {
  if (!database?.prepare || !candidate) return { ok: false, reason: "unavailable" };
  const columns = ["outcome_id","event_name","market_key","attribution_path","attribution_status","source_lead_id","submission_id","gclid","gbraid","wbraid","quo_call_id","caller_phone","call_started_at_original","call_started_at_utc","call_timezone","jobber_account_id","jobber_request_id","jobber_client_id","jobber_appointment_id","jobber_quote_id","jobber_job_id","jobber_invoice_id","google_account_id","google_conversion_action","milestone_at","conversion_at","value_micros","currency_code","revenue_source","revenue_version","prior_reported_value_micros","service_type","consent_status","consent_evidence","upload_state","attempt_count","created_at","updated_at"];
  const values = columns.map((column) => candidate[column] ?? (column === "attempt_count" ? 0 : null));
  const placeholders = columns.map(() => "?").join(", ");
  const result = await database.prepare(`INSERT OR IGNORE INTO google_ads_outcome_outbox (${columns.join(", ")}) VALUES (${placeholders})`).bind(...values).run();
  return { ok: true, inserted: Number(result?.meta?.changes ?? result?.changes ?? 0) === 1, outcome_id: candidate.outcome_id };
}

export const _private = { ENABLED_MARKETS, EVENT_NAMES, UPLOAD_STATES, clean, iso };
