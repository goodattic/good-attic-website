const ENABLED_MARKETS = new Set(["ut", "mo_stl"]);
const EVENT_NAMES = new Set([
  "qualified_lead", "appointment_set", "assessment_completed",
  "sold_job", "revenue_restatement", "cancellation",
]);
const UPLOAD_STATES = new Set([
  "held", "pending", "validating", "submitted", "accepted", "rejected",
  "retryable", "permanently_failed", "retracted",
]);

export const GOOGLE_ACTION_MAP = Object.freeze({
  appointment_set: { id: "7741195421", name: "GAE - Appointment Set (CRM)", source: "UPLOAD_CLICKS", window_days: 90, value_policy: "explicit_or_hold" },
  qualified_lead: { id: "7742989654", name: "GAE - Qualified Call Lead (CRM)", source: "UPLOAD_CALLS", window_days: 90, value_policy: "explicit_or_hold" },
  assessment_completed: { id: "7754270379", name: "GAE - Assessment Completed (CRM)", source: "UPLOAD_CLICKS", window_days: 90, value_policy: "force_zero" },
  sold_job: { id: "7754270382", name: "GAE - Sold Job (CRM)", source: "UPLOAD_CLICKS", window_days: 90, value_policy: "explicit_revenue" },
  sold_job_call: { id: null, name: "GAE - Sold Job (CRM) — call action pending", source: "UPLOAD_CALLS", window_days: 90, value_policy: "explicit_revenue" },
});

// Jobber webhook payloads contain only an object id. The existing production
// bridge already proves REQUEST_CREATE/UPDATE and QUOTE_CREATE. The remaining
// topics are accepted as read-only notifications and are reconciled by the
// scheduled backfill before any outcome is prepared.
export const SUPPORTED_JOBBER_TOPICS = new Set([
  "REQUEST_CREATE", "REQUEST_UPDATE", "VISIT_CREATE", "VISIT_UPDATE", "VISIT_COMPLETE",
  "QUOTE_CREATE", "QUOTE_UPDATE", "QUOTE_SENT", "QUOTE_APPROVED",
  "JOB_CREATE", "JOB_UPDATE", "JOB_CLOSED", "INVOICE_CREATE", "INVOICE_UPDATE",
  "PAYMENT_CREATE", "PAYMENT_UPDATE", "PAYMENT_DESTROY",
]);

export const JOBBER_READ_QUERIES = Object.freeze({
  request: `query Phase2Request($id: EncodedId!) { request(id: $id) { id updatedAt client { id } assessment { id createdAt startAt endAt } quotes(first: 50) { nodes { id quoteStatus amounts { total } updatedAt } } jobs(first: 50) { nodes { id jobStatus total invoicedTotal updatedAt quote { id } } } } }`,
  quote: `query Phase2Quote($id: EncodedId!) { quote(id: $id) { id quoteStatus createdAt updatedAt amounts { total } request { id } client { id } jobs(first: 50) { nodes { id } } } }`,
  job: `query Phase2Job($id: EncodedId!) { job(id: $id) { id jobStatus startAt endAt total invoicedTotal updatedAt request { id } quote { id } client { id } invoices(first: 50) { nodes { id invoiceStatus amounts { total } updatedAt } } } }`,
  invoice: `query Phase2Invoice($id: EncodedId!) { invoice(id: $id) { id invoiceStatus issuedDate updatedAt amounts { total } jobs(first: 50) { nodes { id request { id } } } } }`,
});

const ACCOUNT_MARKETS = Object.freeze({
  // These are the production-backed website Jobber account identifiers.
  "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==": "ut",
  "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==": "mo_stl",
});

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
  const event = idPart(input?.event_name);
  // A quote approval and the later Jobber close event describe the same sold
  // outcome. Keep one stable key per request so the two lifecycle signals
  // cannot create two Google conversions. Revenue changes use their invoice
  // identity and remain separate restatements.
  if (event === "sold_job") {
    return ["jobber-request", idPart(input?.jobber_request_id), "sold_job"].join(":");
  }
  if (event === "qualified_lead") {
    return ["jobber-request", idPart(input?.jobber_request_id), "qualified_lead"].join(":");
  }
  if (event === "appointment_set") {
    return ["jobber-request", idPart(input?.jobber_request_id), "appointment_set"].join(":");
  }
  return ["google-ads-outcome", event, idPart(input?.attribution_path),
    idPart(input?.quo_call_id), idPart(input?.jobber_request_id), idPart(input?.jobber_quote_id),
    idPart(input?.jobber_job_id), idPart(input?.jobber_invoice_id), idPart(input?.milestone_at)].join(":");
}

export function normalizeJobberWebhook(payload = {}) {
  const event = payload?.data?.webHookEvent || payload?.webHookEvent || payload;
  const topic = clean(event?.topic, 80).toUpperCase();
  const accountId = clean(event?.accountId, 500);
  const itemId = clean(event?.itemId, 500);
  if (!SUPPORTED_JOBBER_TOPICS.has(topic)) return { ok: false, reason: "unsupported_topic" };
  const marketKey = ACCOUNT_MARKETS[accountId];
  if (!marketKey) return { ok: false, reason: "account_not_enabled" };
  if (!itemId) return { ok: false, reason: "missing_item_id" };
  return {
    ok: true,
    topic,
    account_id: accountId,
    market_key: marketKey,
    item_id: itemId,
    occurred_at: iso(event?.occurredAt || event?.occuredAt) || null,
    read_only: true,
  };
}

export function buildBackfillPlan({ market_key, since } = {}) {
  if (!ENABLED_MARKETS.has(clean(market_key, 40))) return { ok: false, reason: "market_not_enabled" };
  const from = iso(since);
  if (!from) return { ok: false, reason: "invalid_since" };
  return {
    ok: true,
    market_key: clean(market_key, 40),
    since: from,
    object_types: ["request", "quote", "job", "invoice"],
    queries: JOBBER_READ_QUERIES,
    mode: "read_only",
  };
}

export function resolveLifecycleOutcomes(record = {}) {
  const outcomes = [];
  const requestId = clean(record.jobber_request_id, 500);
  const marketKey = clean(record.market_key, 40);
  if (!ENABLED_MARKETS.has(marketKey) || !requestId) return outcomes;
  const milestone = iso(record.occurred_at || record.updated_at);
  if (!milestone) return outcomes;
  if (record.assessment?.startAt && record.assessment?.endAt) {
    // The conversion is the booking event, not the future visit start. Use
    // explicit booking metadata when supplied, then the webhook/backfill
    // observation time already present in the record.
    const bookedAt = iso(record.assessment.bookedAt || record.assessment.createdAt || record.assessment.updatedAt || record.occurred_at || record.updated_at) || milestone;
    outcomes.push({ event_name: "appointment_set", market_key: marketKey, jobber_request_id: requestId, jobber_appointment_id: clean(record.assessment.id, 500), milestone_at: bookedAt });
  }
  if (record.assessment?.status === "completed" || record.assessment?.completedAt) {
    outcomes.push({ event_name: "assessment_completed", market_key: marketKey, jobber_request_id: requestId, jobber_appointment_id: clean(record.assessment.id, 500), milestone_at: record.assessment.completedAt || milestone });
  }
  for (const quote of record.quotes || []) {
    if (["accepted", "approved", "converted"].includes(clean(quote.quoteStatus || quote.status, 40).toLowerCase())) {
      outcomes.push({ event_name: "sold_job", market_key: marketKey, jobber_request_id: requestId, jobber_quote_id: clean(quote.id, 500), value_micros: Number.isFinite(Number(quote.amounts?.total)) ? Math.round(Number(quote.amounts.total) * 1e6) : null, milestone_at: quote.updatedAt || milestone, revenue_source: "accepted_quote_amounts.total", revenue_version: "jobber_quote_total_v1" });
    }
  }
  for (const job of record.jobs || []) {
    if (["cancelled", "canceled"].includes(clean(job.jobStatus, 40).toLowerCase())) {
      outcomes.push({ event_name: "cancellation", market_key: marketKey, jobber_request_id: requestId, jobber_job_id: clean(job.id, 500), milestone_at: job.updatedAt || milestone });
    }
  }
  if (record.topic === "JOB_CLOSED" && record.job?.id) {
    const revenue = revenueEvidence(record);
    outcomes.push({ event_name: "sold_job", market_key: marketKey, jobber_request_id: requestId, jobber_job_id: clean(record.job.id, 500), jobber_quote_id: clean(record.job.quote?.id, 500), ...revenue, milestone_at: record.job.updatedAt || milestone });
  }
  if (["PAYMENT_CREATE", "PAYMENT_UPDATE", "PAYMENT_DESTROY"].includes(record.topic) && record.invoice?.id) {
    const revenue = revenueEvidence(record);
    outcomes.push({ event_name: "revenue_restatement", market_key: marketKey, jobber_request_id: requestId, jobber_invoice_id: clean(record.invoice.id, 500), ...revenue, milestone_at: record.invoice.updatedAt || milestone });
  }
  return outcomes;
}

export function sanitizeDiagnostic(error) {
  return clean(String(error?.code || error?.message || error || "unknown_error").toLowerCase().replace(/[^a-z0-9_.-]+/g, "_"), 120) || "unknown_error";
}

export function createGoogleUploader({ transport, enabled = false, callSoldJobActionId = null, usLeadsConsentGranted = false, now = () => new Date().toISOString() } = {}) {
  return {
    async upload(candidate) {
      if (!enabled) return { ok: false, status: "held", diagnostic_code: "google_upload_disabled" };
      if (!transport || typeof transport.upload !== "function") return { ok: false, status: "permanently_failed", diagnostic_code: "transport_unavailable" };
      const consentStatus = candidate?.consent_status === "unknown" && usLeadsConsentGranted ? "granted" : candidate?.consent_status;
      if (consentStatus !== "granted") return { ok: false, status: "held", diagnostic_code: "consent_unknown_or_denied" };
      if (candidate?.upload_state !== "pending") return { ok: false, status: "held", diagnostic_code: "candidate_not_pending" };
      // Google performs the identifier match as part of the upload. A local
      // `pending` record with a valid click/call identifier is therefore
      // uploadable once the feature is explicitly enabled; requiring a prior
      // `google_matched` state makes the first upload impossible. Explicitly
      // rejected or ineligible records remain held.
      if (!["pending", "google_matched"].includes(candidate?.attribution_status)) return { ok: false, status: "held", diagnostic_code: "attribution_not_verified" };
      const action = actionForCandidate(candidate, { call_sold_job_action_id: callSoldJobActionId });
      if (!action) return { ok: false, status: "held", diagnostic_code: "action_source_mismatch" };
      const window = validateUploadWindow(candidate, { ...action, ...(candidate.google_action || {}) });
      if (!window.ok) return { ok: false, status: window.status, diagnostic_code: window.reason };
      const conversionDateTime = formatGoogleConversionTime(candidate);
      if (!conversionDateTime) return { ok: false, status: "held", diagnostic_code: "conversion_time_invalid" };
      if (!adjustmentSupport(candidate.google_action || {}, candidate.event_name)) return { ok: false, status: "held", diagnostic_code: "google_adjustment_not_supported" };
      if (["qualified_lead", "appointment_set", "sold_job"].includes(candidate.event_name) && !Number.isSafeInteger(candidate.value_micros)) return { ok: false, status: "held", diagnostic_code: "explicit_value_required" };
      const clickId = clean(candidate.gclid || candidate.gbraid || candidate.wbraid, 500);
      const hasWebsiteId = Boolean(clickId);
      const callerId = normalizeE164(candidate.caller_phone);
      const callStart = formatGoogleCallStartTime(candidate);
      const hasCallMatch = Boolean(callerId && callStart);
      if (!hasWebsiteId && !hasCallMatch) return { ok: false, status: "held", diagnostic_code: "missing_google_identifier" };
      if (hasCallMatch && Date.parse(candidate.conversion_at || candidate.milestone_at) < Date.parse(candidate.call_started_at_utc || candidate.call_started_at_original)) return { ok: false, status: "held", diagnostic_code: "conversion_before_call" };
      const request = {
        order_id: candidate.outcome_id,
        conversion_action: candidate.google_conversion_action || action.id,
        conversion_date_time: conversionDateTime,
        currency_code: "USD",
        value: action.value_policy === "force_zero" ? 0 : candidate.value_micros == null ? undefined : candidate.value_micros / 1e6,
        gclid: candidate.gclid ? clickId : undefined,
        gbraid: !candidate.gclid && candidate.gbraid ? clickId : undefined,
        wbraid: !candidate.gclid && !candidate.gbraid && candidate.wbraid ? clickId : undefined,
        caller_id: hasWebsiteId ? undefined : callerId || undefined,
        call_start_time: hasWebsiteId ? undefined : callStart || undefined,
      };
      try {
        const response = await transport.upload(request);
        return { ok: true, status: "submitted", submitted_at: now(), response_category: clean(response?.category, 80) || "accepted" };
      } catch (error) {
        return { ok: false, status: error?.retryable === true ? "retryable" : "permanently_failed", diagnostic_code: sanitizeDiagnostic(error) };
      }
    },
  };
}

export function classifyAttribution({ lead = {}, quoCall = {} } = {}) {
  const clickId = clean(lead.gclid || lead.gbraid || lead.wbraid, 500);
  const path = clean(clickId ? "website" : (quoCall.quo_call_id ? "quo_call" : "website"), 30);
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
  const call = input.quoCall || {};
  const status = clean(call.final_status, 40).toLowerCase();
  const duration = Number(call.duration_seconds);
  if (!["no-answer", "missed"].includes(status) && !(status === "completed" && Number.isFinite(duration) && duration < 90)) {
    return { eligible: false, status: "ineligible", reason: "answered_call_already_counted" };
  }
  return { eligible: true, status: "pending", reason: "awaiting_google_match_and_consent" };
}

export function normalizeE164(value) {
  const normalized = clean(value, 40).replace(/[^+\d]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

const MARKET_TIME_ZONES = Object.freeze({ ut: "America/Denver", mo_stl: "America/Chicago" });

export function formatGoogleCallStartTime(candidate = {}) {
  const value = candidate.call_started_at_utc || candidate.call_started_at_original;
  const instant = Date.parse(value || "");
  if (!Number.isFinite(instant)) return null;
  const timeZone = candidate.call_timezone || MARKET_TIME_ZONES[candidate.market_key] || "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const local = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  const utcParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const utcAsUtc = Date.UTC(+utcParts.year, +utcParts.month - 1, +utcParts.day, +utcParts.hour, +utcParts.minute, +utcParts.second);
  const offset = Math.round((localAsUtc - utcAsUtc) / 60000);
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function formatGoogleConversionTime(candidate = {}) {
  const value = candidate.conversion_at || candidate.milestone_at;
  if (!value) return null;
  return formatGoogleCallStartTime({ ...candidate, call_started_at_utc: value, call_started_at_original: null });
}

export function validateUploadWindow(candidate = {}, action = {}) {
  const occurred = Date.parse(candidate.conversion_at || candidate.milestone_at);
  const now = Date.parse(action.now || new Date().toISOString());
  // The action map uses `window_days`; accept the explicit test override too.
  // Keeping both names here prevents a configuration spelling difference from
  // holding every otherwise-valid event as `upload_window_unknown`.
  const days = Number(action.window_days ?? action.upload_window_days);
  if (!Number.isFinite(occurred) || !Number.isFinite(now) || !Number.isFinite(days) || days <= 0) return { ok: false, status: "held", reason: "upload_window_unknown" };
  if (occurred > now || now - occurred > days * 86400000) return { ok: false, status: "held", reason: "conversion_window_expired" };
  return { ok: true };
}

export function revenueEvidence(record = {}) {
  const invoiceTotal = Number(record.invoice?.amounts?.total);
  const collected = Number(record.invoice?.collectedPayments ?? record.invoice?.paymentsTotal);
  const reconciliation = { invoice_total_micros: Number.isFinite(invoiceTotal) && invoiceTotal >= 0 ? Math.round(invoiceTotal * 1e6) : null, collected_payment_micros: Number.isFinite(collected) && collected >= 0 ? Math.round(collected * 1e6) : null };
  if (Number.isFinite(invoiceTotal) && invoiceTotal >= 0) return { value_micros: Math.round(invoiceTotal * 1e6), revenue_source: "invoice.amounts.total", revenue_version: "jobber_invoice_total_v1", ...reconciliation };
  const jobTotal = Number(record.job?.invoicedTotal);
  if (Number.isFinite(jobTotal) && jobTotal >= 0) return { value_micros: Math.round(jobTotal * 1e6), revenue_source: "job.invoicedTotal", revenue_version: "jobber_invoiced_total_v1", ...reconciliation };
  const quoteTotal = Number(record.quote?.amounts?.total);
  if (Number.isFinite(quoteTotal) && quoteTotal >= 0) return { value_micros: Math.round(quoteTotal * 1e6), revenue_source: "quote.amounts.total", revenue_version: "jobber_quote_total_v1", ...reconciliation };
  return { value_micros: null, revenue_source: null, revenue_version: null, ...reconciliation };
}

export function adjustmentSupport({ google_supports_adjustment = false, google_supports_retraction = false } = {}, eventName) {
  if (eventName === "revenue_restatement") return google_supports_adjustment === true;
  if (eventName === "cancellation") return google_supports_retraction === true;
  return true;
}

export function actionForCandidate(candidate = {}, { call_sold_job_action_id = null } = {}) {
  if (candidate.event_name === "assessment_completed") return null;
  if (candidate.attribution_path === "quo_call" && candidate.event_name === "sold_job") {
    return call_sold_job_action_id ? { ...GOOGLE_ACTION_MAP.sold_job_call, id: call_sold_job_action_id } : null;
  }
  const action = GOOGLE_ACTION_MAP[candidate.event_name];
  if (!action) return null;
  if (candidate.attribution_path === "quo_call" && action.source !== "UPLOAD_CALLS") return null;
  if (candidate.attribution_path === "website" && action.source !== "UPLOAD_CLICKS") return null;
  return action;
}

export function buildOutcomeCandidate(input = {}) {
  const market = clean(input.market_key, 40);
  const event = clean(input.event_name, 80);
  if (!ENABLED_MARKETS.has(market)) return { ok: false, reason: "market_not_enabled" };
  if (!EVENT_NAMES.has(event)) return { ok: false, reason: "event_not_supported" };
  const milestone = iso(input.milestone_at || input.occurred_at);
  if (!milestone) return { ok: false, reason: "invalid_milestone_time" };
  const attribution = classifyAttribution(input);
  const qualified = event === "qualified_lead" ? qualifiedLeadEligibility(input) : { eligible: true, status: "pending" };
  const quoCall = input.quoCall || {};
  const lead = input.lead || {};
  const valueMicros = Number.isSafeInteger(input.value_micros) ? input.value_micros : ["qualified_lead", "appointment_set"].includes(event) ? 0 : null;
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
    value_micros: valueMicros,
    invoice_total_micros: Number.isSafeInteger(input.invoice_total_micros) ? input.invoice_total_micros : null,
    collected_payment_micros: Number.isSafeInteger(input.collected_payment_micros) ? input.collected_payment_micros : null,
    currency_code: valueMicros == null ? null : "USD",
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
  const columns = ["outcome_id","event_name","market_key","attribution_path","attribution_status","source_lead_id","submission_id","gclid","gbraid","wbraid","quo_call_id","caller_phone","call_started_at_original","call_started_at_utc","call_timezone","jobber_account_id","jobber_request_id","jobber_client_id","jobber_appointment_id","jobber_quote_id","jobber_job_id","jobber_invoice_id","google_account_id","google_conversion_action","milestone_at","conversion_at","value_micros","invoice_total_micros","collected_payment_micros","currency_code","revenue_source","revenue_version","prior_reported_value_micros","service_type","consent_status","consent_evidence","upload_state","attempt_count","created_at","updated_at"];
  const values = columns.map((column) => candidate[column] ?? (column === "attempt_count" ? 0 : null));
  const placeholders = columns.map(() => "?").join(", ");
  const result = await database.prepare(`INSERT OR IGNORE INTO google_ads_outcome_outbox (${columns.join(", ")}) VALUES (${placeholders})`).bind(...values).run();
  return { ok: true, inserted: Number(result?.meta?.changes ?? result?.changes ?? 0) === 1, outcome_id: candidate.outcome_id };
}

export const _private = { ENABLED_MARKETS, EVENT_NAMES, UPLOAD_STATES, clean, iso };
