import { persistClosedLoopLead } from "./closed-loop-ledger.js";

const SCHEMA_VERSION = "2026-09-21";
const MAX_ATTEMPTS = 3;
const MARKET_ROUTES = {
  ut: { slug: "slc", tokenKey: "FIELDFLOW_ATTRIBUTION_TOKEN_SLC" },
  mo_stl: { slug: "stl", tokenKey: "FIELDFLOW_ATTRIBUTION_TOKEN_STL" },
  mo_kc: { slug: "kc", tokenKey: "FIELDFLOW_ATTRIBUTION_TOKEN_KC" },
};

function cleanScalar(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}
function parseUrl(value) {
  try { return new URL(cleanScalar(value, 5000)); } catch { return null; }
}
function readAttributionSignal(payload, field) {
  const landing = [payload?.ad_landing_page, payload?.source_url, payload?.page_url].map(parseUrl).find(Boolean);
  return cleanScalar(landing?.searchParams.get(field), 500) || cleanScalar(payload?.[field], 500);
}
function safeReferrerOrigin(value) {
  const referrer = cleanScalar(value, 2048);
  if (!referrer) return "";
  if (referrer.toLowerCase() === "google") return "google";
  if (/^(?:www\.)?google\.[a-z]{2,}(?:\.[a-z]{2})?$/i.test(referrer)) return referrer.toLowerCase().replace(/^www\./, "");
  const url = parseUrl(referrer);
  return url && ["http:", "https:"].includes(url.protocol) ? url.origin : "";
}
function compactRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}
function compactLandingPage(value) {
  const url = parseUrl(value);
  return url ? `${url.origin}${url.pathname}`.slice(0, 1000) : "";
}

export function buildWebsiteAttribution(payload, lead, jobber) {
  return compactRecord({
    schema_version: SCHEMA_VERSION,
    market_key: cleanScalar(lead?.market_key, 40),
    jobber_account_id: cleanScalar(jobber?.account_id, 255),
    jobber_request_id: cleanScalar(jobber?.request_id, 255),
    jobber_client_id: cleanScalar(jobber?.client_id, 255),
    submission_id: cleanScalar(lead?.submission_id, 255),
    occurred_at: cleanScalar(lead?.submitted_at, 64),
    lead_source: cleanScalar(lead?.source_label, 100),
    source_key: cleanScalar(lead?.source_key, 50),
    source_detail: cleanScalar(lead?.source_detail, 100),
    source_reason: cleanScalar(lead?.source_reason, 2000) || "server_classified",
    campaign: readAttributionSignal(payload, "utm_campaign"),
    service: cleanScalar(lead?.service, 500),
    landing_page: compactLandingPage(payload?.ad_landing_page || lead?.source_url),
    consent_state: cleanScalar(lead?.consent, 500),
    gclid: readAttributionSignal(payload, "gclid"),
    gbraid: readAttributionSignal(payload, "gbraid"),
    wbraid: readAttributionSignal(payload, "wbraid"),
    gad_source: readAttributionSignal(payload, "gad_source"),
    utm_source: readAttributionSignal(payload, "utm_source"),
    utm_medium: readAttributionSignal(payload, "utm_medium"),
    utm_campaign: readAttributionSignal(payload, "utm_campaign"),
    referrer: safeReferrerOrigin(payload?.ad_referrer || payload?.referrer),
  });
}

export function buildAngiAttribution(angi, requestId) {
  const providerLeadId = cleanScalar(angi?.leadOid, 255);
  const entityId = cleanScalar(angi?.spEntityId, 64);
  const submissionId = entityId && providerLeadId ? `angi:${entityId}:${providerLeadId}` : "";
  return compactRecord({
    schema_version: "2026-07-31",
    jobber_request_id: cleanScalar(requestId, 255),
    provider_lead_id: providerLeadId,
    provider_name: "Angi",
    submission_id: submissionId,
    occurred_at: cleanScalar(angi?.sourceEventAt || angi?.receivedAt, 64),
    lead_source: "Angi",
    source_reason: "server_routed_angi_provider",
    request_title: providerLeadId ? `[Angi ${providerLeadId}]` : "",
  });
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function durableLeadFromAttribution(marketKey, record) {
  const requestId = cleanScalar(record?.jobber_request_id, 500);
  const submissionId = cleanScalar(record?.submission_id, 500);
  if (!["ut", "mo_stl"].includes(marketKey) || !requestId || !submissionId) return null;
  const now = new Date().toISOString();
  return {
    lead_id: `jobber-request:${requestId}`,
    submission_id: submissionId,
    market_key: marketKey,
    jobber_account_id: cleanScalar(record?.jobber_account_id, 500),
    jobber_request_id: requestId,
    jobber_client_id: cleanScalar(record?.jobber_client_id, 500),
    original_source: cleanScalar(record?.lead_source, 120) || "Unknown",
    source_detail: cleanScalar(record?.source_detail, 120),
    campaign: cleanScalar(record?.campaign || record?.utm_campaign, 500),
    service: cleanScalar(record?.service, 500),
    landing_page: cleanScalar(record?.landing_page, 1000),
    gclid: cleanScalar(record?.gclid, 500),
    gbraid: cleanScalar(record?.gbraid, 500),
    wbraid: cleanScalar(record?.wbraid, 500),
    consent_state: cleanScalar(record?.consent_state, 500),
    inquiry_at: cleanScalar(record?.occurred_at, 80) || now,
    created_at: now,
    updated_at: now,
  };
}

export async function submitFieldflowAttribution(env, marketKey, record) {
  const route = MARKET_ROUTES[marketKey];
  if (!route) return { ok: false, attempts: 0, status: 0, reason: "unsupported_market" };
  let ledger = { ok: false, reason: "outside_initial_rollout" };
  const durableLead = durableLeadFromAttribution(marketKey, record);
  if (durableLead) {
    try {
      ledger = await persistClosedLoopLead(env?.ANGI_ROUTER_DB, durableLead);
    } catch (error) {
      ledger = { ok: false, reason: "ledger_write_failed" };
      console.error("Closed-loop lead persistence failed after Jobber succeeded.", {
        market: marketKey,
        jobberRequestId: durableLead.jobber_request_id,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
  if (env?.EXTERNAL_API_WRITES_ENABLED === "false") {
    return { ok: ledger.ok, attempts: 0, status: 0, reason: "external_api_writes_disabled", ledger };
  }
  const baseUrl = cleanScalar(env?.FIELDFLOW_ATTRIBUTION_BASE_URL, 2048).replace(/\/+$/, "");
  const token = cleanScalar(env?.[route.tokenKey], 4000);
  if (!baseUrl || !token) return { ok: false, attempts: 0, status: 0, reason: "missing_configuration", ledger };
  let lastStatus = 0;
  let lastReason = "network_error";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetch(`${baseUrl}/${route.slug}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      lastStatus = response.status;
      if (response.ok) return { ok: true, attempts: attempt, status: response.status, ledger };
      lastReason = "receiver_rejected";
      if (!(response.status === 429 || response.status >= 500) || attempt === MAX_ATTEMPTS) break;
    } catch {
      lastReason = "network_error";
      if (attempt === MAX_ATTEMPTS) break;
    }
    await wait(250 * attempt);
  }
  return { ok: false, attempts, status: lastStatus, reason: lastReason, ledger };
}

export const _private = { MARKET_ROUTES, SCHEMA_VERSION, durableLeadFromAttribution, readAttributionSignal, safeReferrerOrigin };
