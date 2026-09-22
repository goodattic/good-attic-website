import test from "node:test";
import assert from "node:assert/strict";
import { actionForCandidate, adjustmentSupport, buildOutcomeCandidate, buildBackfillPlan, classifyAttribution, createGoogleAdsApiTransport, createGoogleUploader, formatGoogleCallStartTime, GOOGLE_ACTION_MAP, GOOGLE_ADS_API_VERSION, normalizeE164, normalizeJobberWebhook, outcomeId, persistOutcomeCandidate, qualifiedLeadEligibility, resolveLifecycleOutcomes, revenueEvidence, validateUploadWindow } from "../server/google-ads-outcome-watcher.js";
import { collectJobberLifecycle, collectJobberRequestLifecycle, loadRequestAttribution, runReadOnlyBackfill } from "../server/google-ads-outcome-collection.js";

class MemoryD1 {
  constructor() { this.calls = []; }
  prepare(sql) { return { bind: (...args) => ({ run: async () => { this.calls.push({ sql, args }); return { meta: { changes: this.calls.length === 1 ? 1 : 0 } }; } }) }; }
}

class AttributionD1 extends MemoryD1 {
  constructor() {
    super();
    this.lead = null;
    this.call = null;
  }
  prepare(sql) {
    if (sql.startsWith("SELECT * FROM closed_loop_leads")) return { bind: () => ({ first: async () => this.lead }) };
    if (sql.startsWith("SELECT * FROM quo_call_attributions")) return { bind: () => ({ all: async () => ({ results: this.call ? [this.call] : [] }), first: async () => this.call }) };
    return super.prepare(sql);
  }
}

test("holds a qualified website outcome until Google attribution and consent are verified", () => {
  const result = buildOutcomeCandidate({
    event_name: "qualified_lead", market_key: "ut", milestone_at: "2026-09-21T18:00:00Z",
    homeowner: true, service_area_valid: true, installed_service: true, expected_value_usd: 2500,
    lead: { lead_id: "jobber-request:r1", submission_id: "s1", gclid: "gclid-1", service: "Attic Insulation", consent_state: "unknown", jobber_request_id: "r1" },
    quoCall: { quo_call_id: "c1", caller_phone: "+15551234567", call_started_at_original: "2026-09-21T12:00:00-06:00", final_status: "no-answer", duration_seconds: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.attribution_status, "pending");
  assert.equal(result.candidate.upload_state, "pending");
  assert.equal(result.candidate.consent_status, "unknown");
});

test("keeps appointment outcome stable across Quo calls and edits", () => {
  const first = outcomeId({ event_name: "appointment_set", attribution_path: "quo_call", quo_call_id: "c1", jobber_request_id: "r1", milestone_at: "2026-09-21T18:00:00Z" });
  const second = outcomeId({ event_name: "appointment_set", attribution_path: "quo_call", quo_call_id: "c2", jobber_request_id: "r1", milestone_at: "2026-09-21T18:00:00Z" });
  assert.equal(first, second);
  assert.equal(first, outcomeId({ event_name: "appointment_set", attribution_path: "website", quo_call_id: "c1", jobber_request_id: "r1", milestone_at: "2026-09-23T18:00:00Z" }));
});

test("uses one stable qualified-call outcome per Jobber request", () => {
  const first = outcomeId({ event_name: "qualified_lead", attribution_path: "quo_call", quo_call_id: "c1", jobber_request_id: "r1", milestone_at: "2026-09-21T18:00:00Z" });
  const second = outcomeId({ event_name: "qualified_lead", attribution_path: "quo_call", quo_call_id: "c2", jobber_request_id: "r1", milestone_at: "2026-09-22T18:00:00Z" });
  assert.equal(first, second);
});

test("keeps quote approval and job close under one sold-job outcome", () => {
  const quote = outcomeId({ event_name: "sold_job", attribution_path: "website", jobber_request_id: "r1", jobber_quote_id: "q1", milestone_at: "2026-09-21T18:00:00Z" });
  const close = outcomeId({ event_name: "sold_job", attribution_path: "website", jobber_request_id: "r1", jobber_job_id: "j1", milestone_at: "2026-09-22T18:00:00Z" });
  assert.equal(quote, close);
});

test("excludes Kansas City and does not infer Google attribution from Jobber alone", () => {
  assert.equal(buildOutcomeCandidate({ event_name: "sold_job", market_key: "mo_kc", milestone_at: "2026-09-21T18:00:00Z" }).reason, "market_not_enabled");
  assert.deepEqual(classifyAttribution({ lead: { source_label: "Google Ads" } }), { attribution_path: "website", attribution_status: "pending", evidence: "unverified_pending_match" });
});

test("click identifiers take precedence over an attached Quo call", () => {
  assert.equal(classifyAttribution({ lead: { gclid: "gclid-1" }, quoCall: { quo_call_id: "call-1" } }).attribution_path, "website");
});

test("qualifies only short or missed calls and ignores the old structured fields", () => {
  assert.equal(qualifiedLeadEligibility({ homeowner: false, expected_value_usd: 1, quoCall: { final_status: "no-answer", duration_seconds: 0 } }).eligible, true);
  assert.equal(qualifiedLeadEligibility({ quoCall: { final_status: "completed", duration_seconds: 90 } }).reason, "answered_call_already_counted");
});

test("persists idempotently with INSERT OR IGNORE", async () => {
  const db = new MemoryD1();
  const { candidate } = buildOutcomeCandidate({ event_name: "appointment_set", market_key: "mo_stl", milestone_at: "2026-09-21T18:00:00Z", jobber_request_id: "r1", jobber_appointment_id: "a1" });
  assert.equal((await persistOutcomeCandidate(db, candidate)).inserted, true);
  assert.equal((await persistOutcomeCandidate(db, candidate)).inserted, false);
  assert.match(db.calls[0].sql, /INSERT OR IGNORE/);
});

test("normalizes only Utah and St. Louis Jobber webhook IDs", () => {
  const payload = { data: { webHookEvent: { topic: "PAYMENT_UPDATE", accountId: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==", itemId: "i1", occurredAt: "2026-09-21T18:00:00-06:00" } } };
  assert.equal(normalizeJobberWebhook(payload).market_key, "ut");
  assert.equal(normalizeJobberWebhook({ ...payload, data: { webHookEvent: { ...payload.data.webHookEvent, accountId: "kc" } } }).reason, "account_not_enabled");
});

test("resolves scheduled, completed, accepted quote, and cancellation outcomes without summing quotes", () => {
  const outcomes = resolveLifecycleOutcomes({ market_key: "mo_stl", jobber_request_id: "r1", occurred_at: "2026-09-21T18:00:00Z", assessment: { id: "a1", createdAt: "2026-09-21T18:05:00Z", startAt: "2026-09-22T18:00:00Z", endAt: "2026-09-22T19:00:00Z", status: "completed", completedAt: "2026-09-22T19:00:00Z" }, quotes: [{ id: "q1", quoteStatus: "converted", amounts: { total: 2500 }, updatedAt: "2026-09-23T00:00:00Z" }, { id: "q2", quoteStatus: "draft", amounts: { total: 10000 } }], jobs: [{ id: "j1", jobStatus: "cancelled", updatedAt: "2026-09-24T00:00:00Z" }] });
  assert.deepEqual(outcomes.map((item) => item.event_name), ["appointment_set", "assessment_completed", "sold_job", "cancellation"]);
  assert.equal(outcomes.find((item) => item.event_name === "sold_job").value_micros, 2500000000);
  assert.equal(outcomes.find((item) => item.event_name === "appointment_set").milestone_at, "2026-09-21T18:05:00Z");
});

test("collects webhook and backfill records through read-only readers", async () => {
  const db = new MemoryD1();
  const payload = { data: { webHookEvent: { topic: "QUOTE_UPDATE", accountId: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==", itemId: "q1", occurredAt: "2026-09-21T18:00:00Z" } } };
  const object = { jobber_request_id: "r1", quotes: [{ id: "q1", quoteStatus: "converted", amounts: { total: 2000 }, updatedAt: "2026-09-21T18:00:00Z" }] };
  const result = await collectJobberLifecycle({ database: db, payload, readObject: async () => object });
  assert.equal(result.ok, true);
  assert.equal(result.writes.length, 1);
  const plan = buildBackfillPlan({ market_key: "ut", since: "2026-09-01T00:00:00Z" });
  assert.equal(plan.mode, "read_only");
  const backfill = await runReadOnlyBackfill({ database: db, market_key: "ut", since: "2026-09-01T00:00:00Z", listObjects: async () => ["r1"], readObject: async () => object });
  assert.equal(backfill.ok, true);
});

test("joins website and Quo attribution ledgers before writing a dry-run outcome", async () => {
  const db = new AttributionD1();
  db.lead = { lead_id: "lead-ut-1", submission_id: "form-1", market_key: "ut", jobber_request_id: "r-ut-1", gclid: "gclid-ut-1", service: "Attic insulation", consent_state: "unknown" };
  db.call = { quo_call_id: "call-ut-1", caller_phone: "+15550001111", call_started_at_original: "2026-09-22T12:00:00-06:00", call_started_at_utc: "2026-09-22T18:00:00Z", jobber_request_id: "r-ut-1" };
  const loaded = await loadRequestAttribution({ database: db, market_key: "ut", jobber_request_id: "r-ut-1" });
  assert.equal(loaded.lead.gclid, "gclid-ut-1");
  assert.equal(loaded.quoCall.quo_call_id, "call-ut-1");
  const result = await collectJobberRequestLifecycle({
    database: db, market_key: "ut", account_id: "ut-account", request_id: "r-ut-1", occurred_at: "2026-09-22T18:00:00Z",
    readObject: async () => ({ jobber_request_id: "r-ut-1", assessment: { id: "a-ut-1", startAt: "2026-09-25T18:00:00Z", endAt: "2026-09-25T19:00:00Z", status: "scheduled" } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attribution_source.website, true);
  assert.equal(result.attribution_source.quo, true);
  assert.equal(result.writes.length, 1);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].args[1], "appointment_set");
});

test("uploader is disabled, holds consent, and bounds diagnostics with a fake transport", async () => {
  let calls = 0;
  const disabled = createGoogleUploader({ enabled: false, transport: { upload: async () => { calls += 1; } } });
  assert.equal((await disabled.upload({})).diagnostic_code, "google_upload_disabled");
  const enabled = createGoogleUploader({ enabled: true, transport: { upload: async () => { calls += 1; throw Object.assign(new Error("secret and phone +15551212"), { retryable: true }); } } });
  assert.equal((await enabled.upload({ consent_status: "unknown", attribution_status: "google_matched" })).diagnostic_code, "consent_unknown_or_denied");
  const retry = await enabled.upload({ upload_state: "pending", event_name: "qualified_lead", attribution_path: "quo_call", consent_status: "granted", attribution_status: "google_matched", outcome_id: "o1", milestone_at: "2026-09-21T18:00:00Z", value_micros: 1000000, caller_phone: "+15551212", call_started_at_original: "2026-09-21T12:00:00-06:00", google_action: { upload_window_days: 90, now: "2026-09-22T18:00:00Z" } });
  assert.equal(retry.status, "retryable");
  assert.equal(calls, 1);
});

test("holds expired windows and unsupported Google adjustments", () => {
  assert.equal(validateUploadWindow({ milestone_at: "2026-01-01T00:00:00Z" }, { upload_window_days: 90, now: "2026-09-21T00:00:00Z" }).reason, "conversion_window_expired");
  assert.equal(validateUploadWindow({ milestone_at: "2026-09-20T00:00:00Z" }, { window_days: 90, now: "2026-09-21T00:00:00Z" }).ok, true);
  assert.equal(adjustmentSupport({ google_supports_retraction: false }, "cancellation"), false);
});

test("prefers GCLID when multiple website identifiers are present", async () => {
  const uploader = createGoogleUploader({ enabled: true, transport: { upload: async () => ({}) } });
  const result = await uploader.upload({ upload_state: "pending", event_name: "appointment_set", attribution_path: "website", consent_status: "granted", attribution_status: "google_matched", value_micros: 1000000, gclid: "g1", gbraid: "b1", milestone_at: "2026-09-21T18:00:00Z", google_action: { upload_window_days: 90, now: "2026-09-22T18:00:00Z" } });
  assert.equal(result.status, "submitted");
});

test("normalizes caller IDs and formats call start in the market timezone", () => {
  assert.equal(normalizeE164("+1 (555) 123-4567"), "+15551234567");
  assert.equal(formatGoogleCallStartTime({ market_key: "mo_stl", call_started_at_original: "2026-09-22T18:00:00Z" }), "2026-09-22 13:00:00-05:00");
});

test("allows a pending identifier to reach the Google transport for matching", async () => {
  let request;
  const uploader = createGoogleUploader({ enabled: true, transport: { upload: async (value) => { request = value; return { category: "accepted" }; } } });
  const result = await uploader.upload({ upload_state: "pending", event_name: "appointment_set", attribution_path: "website", consent_status: "granted", attribution_status: "pending", outcome_id: "o-pending", value_micros: 0, gclid: "gclid-1", milestone_at: "2026-09-21T18:00:00Z", google_action: { window_days: 90, now: "2026-09-22T18:00:00Z" } });
  assert.equal(result.status, "submitted");
  assert.equal(request.gclid, "gclid-1");
});

test("keeps U.S. consent opt-in disabled unless explicitly configured", async () => {
  const candidate = { upload_state: "pending", event_name: "appointment_set", attribution_path: "website", consent_status: "unknown", attribution_status: "pending", outcome_id: "o-consent", value_micros: 0, gclid: "gclid-consent", milestone_at: "2026-09-21T18:00:00Z", google_action: { window_days: 90, now: "2026-09-22T18:00:00Z" } };
  const held = await createGoogleUploader({ enabled: true, transport: { upload: async () => ({}) } }).upload(candidate);
  assert.equal(held.diagnostic_code, "consent_unknown_or_denied");
  const optedIn = await createGoogleUploader({ enabled: true, usLeadsConsentGranted: true, transport: { upload: async () => ({}) } }).upload(candidate);
  assert.equal(optedIn.status, "submitted");
});

test("uses the verified action map and never sends call outcomes to click actions", () => {
  assert.equal(GOOGLE_ACTION_MAP.sold_job.id, "7754270382");
  assert.equal(actionForCandidate({ event_name: "qualified_lead", attribution_path: "quo_call" }).source, "UPLOAD_CALLS");
  assert.equal(actionForCandidate({ event_name: "sold_job", attribution_path: "quo_call" }), null);
  assert.equal(actionForCandidate({ event_name: "appointment_set", attribution_path: "website" }).source, "UPLOAD_CLICKS");
  assert.equal(actionForCandidate({ event_name: "sold_job", attribution_path: "quo_call" }, { call_sold_job_action_id: "call-sold-1" }).source, "UPLOAD_CALLS");
});

test("builds disabled-by-default Google Ads API click and call transports", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("oauth2.googleapis.com")) return { ok: true, json: async () => ({ access_token: "access-token", expires_in: 3600 }) };
    return { ok: true, json: async () => ({}) };
  };
  const transport = createGoogleAdsApiTransport({ developerToken: "dev", clientId: "client", clientSecret: "secret", refreshToken: "refresh", fetchImpl });
  await transport.upload({ conversion_action: "7741195421", conversion_date_time: "2026-09-21 12:00:00-06:00", currency_code: "USD", value: 0, order_id: "jobber-request:r1:appointment_set", gclid: "gclid-1" });
  await transport.upload({ conversion_action: "7788072382", conversion_date_time: "2026-09-21 12:00:00-06:00", currency_code: "USD", value: 1250, order_id: "jobber-request:r1:sold_job", caller_id: "+15551234567", call_start_time: "2026-09-21 11:00:00-06:00" });
  assert.match(requests[1].url, /uploadClickConversions$/);
  assert.equal(JSON.parse(requests[1].options.body).partialFailure, true);
  assert.match(requests[2].url, /uploadCallConversions$/);
  assert.equal(JSON.parse(requests[2].options.body).conversions[0].callerId, "+15551234567");
  assert.match(requests[1].url, new RegExp(`/${GOOGLE_ADS_API_VERSION}/`));
  assert.throws(() => createGoogleAdsApiTransport({ developerToken: "dev" }), /configuration_missing/);
});

test("sends optional manager header and surfaces partial conversion rejection", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("oauth2.googleapis.com")) return { ok: true, json: async () => ({ access_token: "token", expires_in: 3600 }) };
    return { ok: true, json: async () => ({ partialFailureError: { message: "CLICK_NOT_FOUND", details: [{ errors: [{ errorCode: { conversionUploadError: "CLICK_NOT_FOUND" } }] }] } }) };
  };
  const transport = createGoogleAdsApiTransport({ developerToken: "dev", clientId: "client", clientSecret: "secret", refreshToken: "refresh", loginCustomerId: "123-456-7890", fetchImpl });
  const result = await transport.upload({ conversion_action: "7741195421", conversion_date_time: "2026-09-21 12:00:00-06:00", value: 0, order_id: "o1", gclid: "missing" });
  assert.equal(result.category, "rejected");
  assert.equal(requests[1].options.headers["login-customer-id"], "1234567890");
});

test("duplicate order partial failure is idempotent success", async () => {
  const fetchImpl = async (url) => url.includes("oauth2.googleapis.com")
    ? { ok: true, json: async () => ({ access_token: "token", expires_in: 3600 }) }
    : { ok: true, json: async () => ({ partialFailureError: { message: "DUPLICATE_ORDER_ID" } }) };
  const transport = createGoogleAdsApiTransport({ developerToken: "dev", clientId: "client", clientSecret: "secret", refreshToken: "refresh", fetchImpl });
  const result = await transport.upload({ conversion_action: "7741195421", conversion_date_time: "2026-09-21 12:00:00-06:00", value: 0, order_id: "same", gclid: "g" });
  assert.equal(result.category, "accepted_duplicate");
  assert.equal(result.accepted, true);
});

test("uses invoice total as final revenue, then job invoiced total, without summing", () => {
  assert.deepEqual(revenueEvidence({ invoice: { amounts: { total: 1250 } }, job: { invoicedTotal: 2000 }, quote: { amounts: { total: 3000 } } }), { value_micros: 1250000000, revenue_source: "invoice.amounts.total", revenue_version: "jobber_invoice_total_v1", invoice_total_micros: 1250000000, collected_payment_micros: null });
});

test("maps Jobber close and payment notifications to sold/revenue-restatement candidates", () => {
  const closed = resolveLifecycleOutcomes({ topic: "JOB_CLOSED", market_key: "ut", jobber_request_id: "r1", occurred_at: "2026-09-21T18:00:00Z", job: { id: "j1", invoicedTotal: 1800, updatedAt: "2026-09-22T18:00:00Z" } });
  assert.equal(closed.at(-1).event_name, "sold_job");
  const payment = resolveLifecycleOutcomes({ topic: "PAYMENT_UPDATE", market_key: "ut", jobber_request_id: "r1", occurred_at: "2026-09-23T18:00:00Z", invoice: { id: "i1", amounts: { total: 1700 }, updatedAt: "2026-09-23T18:00:00Z" } });
  assert.equal(payment.at(-1).event_name, "revenue_restatement");
});
