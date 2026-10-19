import { persistClosedLoopLead } from "./closed-loop-ledger.js";
import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";

const SCHEMA_VERSION = "2026-09-21";
const FIELDFLOW_WIRE_VERSION = "2026-07-31";
const MAX_ATTEMPTS = 3;
// Snake-case fields accepted by Fieldflow's lib/highlevel/payload.ts.
const FIELDFLOW_WIRE_FIELDS = [
  "jobber_account_id",
  "jobber_request_id",
  "provider_lead_id",
  "provider_name",
  "submission_id",
  "stable_lead_key",
  "occurred_at",
  "lead_source",
  "source_key",
  "source_detail",
  "source_reason",
  "gclid",
  "gbraid",
  "wbraid",
  "gad_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "referrer",
  "request_title",
];
// Exact authoritative triples accepted by Fieldflow's payload.ts.
const FIELDFLOW_SOURCE_COMBINATIONS = new Set([
  "Google Ads|google|google_ads",
  "Google Organic|google|google_organic",
  "Organic Online|website|organic_online",
  "Good Attic Website|website|website_other",
]);
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
function paidTouchPrefix(lead) {
  if (lead?.source_key !== 'google') return '';
  if (lead.source_reason?.startsWith('paid_touch_')) return 'paid_touch';
  if (lead.source_reason?.startsWith('first_touch_')) return 'first_touch';
  return '';
}
export function readAttributionSignal(payload, field, prefix = '') {
  const landing = (prefix ? [payload?.[`${prefix}_landing_page`]]
    : [payload?.ad_landing_page, payload?.source_url, payload?.page_url]).map(parseUrl).find(Boolean);
  return cleanScalar(landing?.searchParams.get(field), 500)
    || cleanScalar(payload?.[prefix ? `${prefix}_${field}` : field], 500);
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

function buildFieldflowWireRecord(record) {
  if (![SCHEMA_VERSION, FIELDFLOW_WIRE_VERSION].includes(record?.schema_version)) {
    throw new Error("unsupported_attribution_schema");
  }
  const wire = { schema_version: FIELDFLOW_WIRE_VERSION };
  for (const field of FIELDFLOW_WIRE_FIELDS) {
    if (record[field] !== undefined) wire[field] = record[field];
  }
  // Keep ai_referral in the local D1 record; Fieldflow groups it under organic_online.
  if (wire.lead_source === "Organic Online" && wire.source_key === "website" && wire.source_detail === "ai_referral") {
    wire.source_detail = "organic_online";
  }
  const sourceFields = [wire.lead_source, wire.source_key, wire.source_detail].filter(Boolean);
  const angiEvidenceOnly = sourceFields.length === 1
    && /^(?:angi|homeadvisor)$/i.test(wire.lead_source);
  if (sourceFields.length !== 0 && !angiEvidenceOnly
      && (sourceFields.length !== 3
        || !FIELDFLOW_SOURCE_COMBINATIONS.has(sourceFields.join("|")))) {
    throw new Error("unsupported_attribution_source");
  }
  return wire;
}

export function buildWebsiteAttribution(payload, lead, jobber) {
  const paidPrefix = paidTouchPrefix(lead);
  const signal = (field) => readAttributionSignal(payload, field, paidPrefix);
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
    campaign: signal('utm_campaign'),
    service: cleanScalar(lead?.service, 500),
    landing_page: compactLandingPage(payload?.[paidPrefix ? `${paidPrefix}_landing_page` : 'ad_landing_page'] || lead?.source_url),
    consent_state: cleanScalar(lead?.consent, 500),
    gclid: signal('gclid'),
    gbraid: signal('gbraid'),
    wbraid: signal('wbraid'),
    gad_source: signal('gad_source'),
    utm_source: signal('utm_source'),
    utm_medium: signal('utm_medium'),
    utm_campaign: signal('utm_campaign'),
    referrer: safeReferrerOrigin(payload?.[paidPrefix ? `${paidPrefix}_referrer` : 'ad_referrer'] || payload?.referrer),
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
// KC enters the local Quote lineage only after the independently persisted
// source proof, form transaction, and website receipt agree on one Request.
// A manually recovered historical Request has none of this paid-click proof.
async function verifiedKcGoogleWebsiteLead(database, record) {
  if (!database?.prepare || record?.market_key !== 'mo_kc'
    || record?.lead_source !== 'Google Ads' || record?.source_key !== 'google'
    || record?.source_detail !== 'google_ads') return null;
  const submissionId = cleanScalar(record.submission_id, 500);
  const accountId = cleanScalar(record.jobber_account_id, 500);
  const requestId = cleanScalar(record.jobber_request_id, 500);
  const clientId = cleanScalar(record.jobber_client_id, 500);
  const occurredAt = cleanScalar(record.occurred_at, 80);
  if (!submissionId || !accountId || !requestId || !clientId || !occurredAt
    || accountId !== getJobberOAuthRoute('mo_kc', 'website')?.expectedAccountId) return null;
  const proof = await database.prepare(`
    SELECT p.source_reason, p.evidence_json
    FROM website_google_source_proofs p
    JOIN website_form_conversions f ON f.submission_id = p.submission_id
      AND f.transaction_id = p.submission_id
      AND f.market_key = p.market_key
      AND f.jobber_account_id = p.account_id
      AND f.jobber_request_id = p.jobber_request_id
      AND f.jobber_client_id = p.jobber_client_id
      AND f.state = 'completed' AND f.reconciliation_required = 0
    JOIN acknowledgement_sources a ON a.account_id = p.account_id
      AND a.request_id = p.jobber_request_id
      AND a.market_key = p.market_key
      AND a.client_id = p.jobber_client_id
      AND a.source_kind = 'website' AND a.source_lead_id = p.source_lead_id
    WHERE p.submission_id = ? AND p.market_key = 'mo_kc'
      AND p.state = 'completed' AND p.source_key = 'google'
      AND p.source_detail = 'google_ads'
      AND p.account_id = ? AND p.jobber_request_id = ?
      AND p.jobber_client_id = ? AND p.source_lead_id = ?
      AND p.source_reason = ? AND a.source_created_at = ?
    LIMIT 1
  `).bind(submissionId, accountId, requestId, clientId,
    `website:${submissionId.toLowerCase()}`,
    cleanScalar(record.source_reason, 2000), occurredAt).first();
  if (!proof) return null;

  let evidence;
  try { evidence = JSON.parse(proof.evidence_json); } catch { return null; }
  if (evidence?.schema_version !== 1 || evidence?.source_key !== 'google'
    || evidence?.source_detail !== 'google_ads'
    || evidence?.source_reason !== proof.source_reason
    || !evidence.attribution || typeof evidence.attribution !== 'object'
    || Array.isArray(evidence.attribution)) return null;
  const prefix = proof.source_reason.startsWith('paid_touch_') ? 'paid_touch'
    : proof.source_reason.startsWith('first_touch_') ? 'first_touch' : '';
  const campaign = readAttributionSignal(evidence.attribution, 'utm_campaign', prefix);
  if (campaign !== cleanScalar(record.campaign || record.utm_campaign, 500)) return null;
  const reason = proof.source_reason.replace(/^(?:paid_touch|first_touch)_/, '');
  const signals = evidence.verified_signals;
  if (!signals || typeof signals !== 'object') return null;
  const click = { gclid: '', gbraid: '', wbraid: '', campaign };
  if (['gclid', 'gbraid', 'wbraid'].includes(reason)) {
    const value = cleanScalar(signals[reason], 500);
    if (!/^[A-Za-z0-9._~-]{6,300}$/.test(value) || value !== record[reason]) return null;
    click[reason] = value;
  } else if (reason === 'gad_source') {
    if (!/^\d{1,12}$/.test(signals.gad_source || '')
      || signals.gad_source !== record.gad_source) return null;
  } else if (reason === 'google_paid_utm') {
    if (signals.utm_source?.toLowerCase() !== 'google'
      || !/^(?:cpc|ppc|paidsearch|paid-search|sem)$/i.test(
        (signals.utm_medium || '').replace(/[\s_]+/g, '-'))
      || signals.utm_source !== record.utm_source
      || signals.utm_medium !== record.utm_medium) return null;
  } else return null;
  return click;
}

function durableLeadFromAttribution(marketKey, record, kcVerifiedClick = null) {
  const requestId = cleanScalar(record?.jobber_request_id, 500);
  const submissionId = cleanScalar(record?.submission_id, 500);
  if (!["ut", "mo_stl", "mo_kc"].includes(marketKey) || !requestId || !submissionId
    || (marketKey === 'mo_kc' && !kcVerifiedClick)) return null;
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
    campaign: marketKey === 'mo_kc' ? kcVerifiedClick.campaign
      : cleanScalar(record?.campaign || record?.utm_campaign, 500),
    service: cleanScalar(record?.service, 500),
    landing_page: cleanScalar(record?.landing_page, 1000),
    gclid: marketKey === 'mo_kc' ? kcVerifiedClick.gclid : cleanScalar(record?.gclid, 500),
    gbraid: marketKey === 'mo_kc' ? kcVerifiedClick.gbraid : cleanScalar(record?.gbraid, 500),
    wbraid: marketKey === 'mo_kc' ? kcVerifiedClick.wbraid : cleanScalar(record?.wbraid, 500),
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
  let kcVerifiedClick = null;
  if (marketKey === 'mo_kc') {
    ledger = { ok: false, reason: 'kc_paid_source_proof_unconfirmed' };
    try {
      kcVerifiedClick = await verifiedKcGoogleWebsiteLead(env?.ANGI_ROUTER_DB, record);
    } catch {
      ledger = { ok: false, reason: 'kc_paid_source_proof_unavailable' };
    }
    if (!kcVerifiedClick && record?.source_key === 'google'
      && record?.source_detail === 'google_ads') {
      console.error('KC paid website attribution ledger needs reconciliation.', {
        submissionId: cleanScalar(record.submission_id, 500),
        jobberRequestId: cleanScalar(record.jobber_request_id, 500),
        reason: ledger.reason,
      });
    }
  }
  const durableLead = durableLeadFromAttribution(marketKey, record, kcVerifiedClick);
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
  let wireRecord;
  try {
    wireRecord = buildFieldflowWireRecord(record);
  } catch (error) {
    const reason = error instanceof Error && error.message === "unsupported_attribution_source"
      ? "unsupported_attribution_source"
      : "unsupported_attribution_schema";
    return { ok: false, attempts: 0, status: 0, reason, ledger };
  }
  let lastStatus = 0;
  let lastReason = "network_error";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetch(`${baseUrl}/${route.slug}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(wireRecord),
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

export const _private = {
  MARKET_ROUTES,
  SCHEMA_VERSION,
  FIELDFLOW_WIRE_VERSION,
  buildFieldflowWireRecord,
  durableLeadFromAttribution,
  verifiedKcGoogleWebsiteLead,
  readAttributionSignal,
  safeReferrerOrigin,
};
