import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { canonicalJobberId } from "./acknowledgement-source.js";
import { readAttributionSignal } from "./fieldflow-attribution.js";
import { validSubmissionId } from "./website-form-transactions.js";

const KC_ACCOUNT_ID = getJobberOAuthRoute("mo_kc", "website").expectedAccountId;
// The paid proof chain was introduced at this cutover. Older KC Requests are
// deliberately outside the automatic Quote field rollout.
export const KC_PAID_PROOF_CUTOVER = "2026-10-19T00:00:00Z";

const KC_QUOTE_LEAD_SQL = `
  SELECT l.*, p.account_id AS proof_account_id,
    p.jobber_request_id AS proof_request_id, p.jobber_client_id AS proof_client_id,
    p.source_lead_id, p.source_key AS proof_source_key,
    p.source_detail AS proof_source_detail, p.source_reason,
    p.evidence_json, p.state AS proof_state, p.jobber_source_app,
    p.fallback_reason, f.transaction_id, f.state AS form_state,
    f.reconciliation_required, f.conversion_at,
    a.source_kind AS receipt_source_kind, a.source_created_at
  FROM closed_loop_leads l
  LEFT JOIN website_google_source_proofs p
    ON p.submission_id = l.submission_id AND p.market_key = l.market_key
      AND p.account_id = l.jobber_account_id
      AND p.jobber_request_id = l.jobber_request_id
      AND p.jobber_client_id = l.jobber_client_id
  LEFT JOIN website_form_conversions f
    ON f.submission_id = l.submission_id AND f.transaction_id = l.submission_id
      AND f.market_key = l.market_key AND f.jobber_account_id = l.jobber_account_id
      AND f.jobber_request_id = l.jobber_request_id
      AND f.jobber_client_id = l.jobber_client_id
  LEFT JOIN acknowledgement_sources a
    ON a.account_id = l.jobber_account_id AND a.request_id = l.jobber_request_id
      AND a.market_key = l.market_key AND a.client_id = l.jobber_client_id
      AND a.source_kind = 'website' AND a.source_lead_id = p.source_lead_id
  WHERE l.jobber_request_id = ? AND l.market_key = 'mo_kc'
  LIMIT 2
`;

const KC_FORM_SQL = `
  SELECT f.submission_id, f.transaction_id, f.market_key,
    f.jobber_account_id, f.jobber_request_id, f.jobber_client_id,
    f.state AS form_state, f.reconciliation_required, f.conversion_at,
    a.account_id AS receipt_account_id, a.request_id AS receipt_request_id,
    a.market_key AS receipt_market_key, a.client_id AS receipt_client_id,
    a.source_kind AS receipt_source_kind, a.source_lead_id AS receipt_source_lead_id,
    a.source_created_at,
    p.submission_id AS proof_submission_id, p.account_id AS proof_account_id,
    p.jobber_request_id AS proof_request_id, p.jobber_client_id AS proof_client_id,
    p.state AS proof_state, p.source_key AS proof_source_key,
    p.source_detail AS proof_source_detail,
    n.submission_id AS nonpaid_submission_id, n.market_key AS nonpaid_market_key,
    n.source_key AS nonpaid_source_key, n.source_label AS nonpaid_source_label,
    n.source_detail AS nonpaid_source_detail, n.source_reason AS nonpaid_source_reason,
    n.source_created_at AS nonpaid_source_created_at,
    n.created_at AS nonpaid_recorded_at,
    n.account_id AS nonpaid_account_id, n.jobber_request_id AS nonpaid_request_id,
    n.jobber_client_id AS nonpaid_client_id, n.state AS nonpaid_state
  FROM website_form_conversions f
  LEFT JOIN acknowledgement_sources a
    ON a.account_id = f.jobber_account_id AND a.request_id = f.jobber_request_id
  LEFT JOIN website_google_source_proofs p ON p.submission_id = f.submission_id
  LEFT JOIN kc_website_nonpaid_source_attestations n ON n.submission_id = f.submission_id
  WHERE f.market_key = 'mo_kc' AND f.jobber_request_id = ?
  LIMIT 2
`;

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function verifiedPaidEvidence(lead) {
  let evidence;
  try { evidence = JSON.parse(lead.evidence_json); } catch { return false; }
  if (evidence?.schema_version !== 1 || evidence.source_key !== "google"
    || evidence.source_detail !== "google_ads"
    || evidence.source_reason !== lead.source_reason
    || !evidence.attribution || typeof evidence.attribution !== "object"
    || Array.isArray(evidence.attribution)
    || !evidence.verified_signals || typeof evidence.verified_signals !== "object"
    || Array.isArray(evidence.verified_signals)) return false;
  const prefix = lead.source_reason.startsWith("paid_touch_") ? "paid_touch"
    : lead.source_reason.startsWith("first_touch_") ? "first_touch" : "";
  const capturedAt = Date.parse(evidence.attribution[
    prefix ? `${prefix}_captured_at` : "attribution_captured_at"]);
  const sourceAt = Date.parse(lead.inquiry_at);
  if (!Number.isFinite(capturedAt) || capturedAt > sourceAt + 300_000
    || sourceAt - capturedAt > 90 * 24 * 60 * 60_000
    || readAttributionSignal(evidence.attribution, "utm_campaign", prefix) !== clean(lead.campaign)) return false;
  const reason = lead.source_reason.replace(/^(?:paid_touch|first_touch)_/, "");
  const clickTypes = ["gclid", "gbraid", "wbraid"];
  const storedClicks = clickTypes.filter((type) => clean(lead[type]));
  if (clickTypes.includes(reason)) {
    const selected = clean(evidence.verified_signals[reason]);
    return storedClicks.length === 1 && storedClicks[0] === reason
      && /^[A-Za-z0-9._~-]{6,300}$/.test(selected)
      && selected === clean(lead[reason])
      && selected === readAttributionSignal(evidence.attribution, reason, prefix);
  }
  if (storedClicks.length) return false;
  if (reason === "gad_source") {
    const selected = clean(evidence.verified_signals.gad_source);
    return /^\d{1,12}$/.test(selected)
      && selected === readAttributionSignal(evidence.attribution, "gad_source", prefix);
  }
  if (reason === "google_paid_utm") {
    const source = clean(evidence.verified_signals.utm_source);
    const medium = clean(evidence.verified_signals.utm_medium);
    return source.toLowerCase() === "google"
      && /^(?:cpc|ppc|paidsearch|paid-search|sem)$/i.test(medium.replace(/[\s_]+/g, "-"))
      && source === readAttributionSignal(evidence.attribution, "utm_source", prefix)
      && medium === readAttributionSignal(evidence.attribution, "utm_medium", prefix);
  }
  return false;
}

export function verifiedKcQuoteLeadRow(lead, { accountId, requestId, clientId }) {
  if (accountId !== KC_ACCOUNT_ID || !canonicalJobberId(requestId, "Request")
    || !canonicalJobberId(clientId, "Client")
    || !validSubmissionId(lead?.submission_id)
    || lead.market_key !== "mo_kc" || lead.original_source !== "Google Ads"
    || lead.source_detail !== "google_ads"
    || lead.jobber_account_id !== accountId || lead.jobber_request_id !== requestId
    || lead.jobber_client_id !== clientId
    || lead.lead_id !== `jobber-request:${requestId}`
    || lead.proof_account_id !== accountId || lead.proof_request_id !== requestId
    || lead.proof_client_id !== clientId
    || lead.source_lead_id !== `website:${lead.submission_id.toLowerCase()}`
    || lead.proof_state !== "completed" || lead.proof_source_key !== "google"
    || lead.proof_source_detail !== "google_ads"
    || !["google", "website"].includes(lead.jobber_source_app)
    || (lead.jobber_source_app === "google" && lead.fallback_reason !== null)
    || (lead.jobber_source_app === "website" && !clean(lead.fallback_reason))
    || lead.transaction_id !== lead.submission_id
    || lead.form_state !== "completed" || Number(lead.reconciliation_required) !== 0
    || lead.receipt_source_kind !== "website"
    || lead.source_created_at !== lead.inquiry_at) return false;
  const inquiryAt = Date.parse(lead.inquiry_at);
  const conversionAt = Date.parse(lead.conversion_at);
  if (!Number.isFinite(inquiryAt) || inquiryAt < Date.parse(KC_PAID_PROOF_CUTOVER)
    || !Number.isFinite(conversionAt) || conversionAt < inquiryAt) return false;
  return verifiedPaidEvidence(lead);
}

export async function findVerifiedKcQuoteLead(database, { accountId, requestId, clientId }) {
  const forms = (await database.prepare(KC_FORM_SQL).bind(requestId).all())?.results || [];
  if (forms.length === 0) return { ok: false, status: "missing_request", reason: "kc_website_form_pending" };
  if (forms.length !== 1) return { ok: false, status: "held", reason: "kc_website_form_ambiguous" };
  const form = forms[0];
  if (accountId !== KC_ACCOUNT_ID || !canonicalJobberId(requestId, "Request")
    || !canonicalJobberId(clientId, "Client") || !validSubmissionId(form.submission_id)
    || form.market_key !== "mo_kc" || form.jobber_account_id !== accountId
    || form.jobber_request_id !== requestId || form.jobber_client_id !== clientId
    || form.transaction_id !== form.submission_id
    || Number(form.reconciliation_required) !== 0) {
    return { ok: false, status: "held", reason: "kc_website_form_conflict" };
  }
  if (form.form_state !== "completed" || !form.conversion_at || !form.receipt_account_id) {
    return { ok: false, status: "missing_request", reason: "kc_website_receipt_pending" };
  }
  const sourceAt = Date.parse(form.source_created_at);
  const conversionAt = Date.parse(form.conversion_at);
  if (form.receipt_account_id !== accountId || form.receipt_request_id !== requestId
    || form.receipt_market_key !== "mo_kc" || form.receipt_client_id !== clientId
    || form.receipt_source_kind !== "website"
    || form.receipt_source_lead_id !== `website:${form.submission_id.toLowerCase()}`
    || !Number.isFinite(sourceAt) || sourceAt < Date.parse(KC_PAID_PROOF_CUTOVER)
    || !Number.isFinite(conversionAt) || conversionAt < sourceAt) {
    return { ok: false, status: "held", reason: "kc_website_receipt_conflict" };
  }
  if (!form.proof_submission_id) {
    const existing = (await database.prepare(`SELECT lead_id FROM closed_loop_leads
      WHERE jobber_request_id = ? OR submission_id = ? LIMIT 2`)
      .bind(requestId, form.submission_id).all())?.results || [];
    if (existing.length) return { ok: false, status: "held", reason: "kc_website_source_conflict" };
    if (!form.nonpaid_submission_id) {
      return { ok: false, status: "missing_request", reason: "kc_nonpaid_source_attestation_pending" };
    }
    if (form.nonpaid_state !== "completed") {
      return { ok: false, status: "missing_request", reason: "kc_nonpaid_source_attestation_pending" };
    }
    if (form.nonpaid_submission_id !== form.submission_id
      || form.nonpaid_market_key !== "mo_kc"
      || form.nonpaid_source_key !== "website"
      || form.nonpaid_source_label !== "Organic Online"
      || !["organic_online", "ai_referral"].includes(form.nonpaid_source_detail)
      || !clean(form.nonpaid_source_reason, 200)
      || form.nonpaid_source_created_at !== form.source_created_at
      || !Number.isFinite(Date.parse(form.nonpaid_recorded_at))
      || Date.parse(form.nonpaid_recorded_at) > conversionAt
      || form.nonpaid_account_id !== accountId
      || form.nonpaid_request_id !== requestId || form.nonpaid_client_id !== clientId) {
      return { ok: false, status: "held", reason: "kc_nonpaid_source_attestation_conflict" };
    }
    return { ok: true, lead: {
      lead_id: `jobber-request:${requestId}`, market_key: "mo_kc",
      jobber_account_id: accountId, jobber_request_id: requestId,
      jobber_client_id: clientId, original_source: form.nonpaid_source_label,
      campaign: null, landing_page: null,
    } };
  }
  if (form.nonpaid_submission_id) {
    return { ok: false, status: "held", reason: "kc_website_source_conflict" };
  }
  if (form.proof_account_id !== accountId || form.proof_request_id !== requestId
    || form.proof_client_id !== clientId || form.proof_source_key !== "google"
    || form.proof_source_detail !== "google_ads") {
    return { ok: false, status: "held", reason: "kc_paid_website_proof_unconfirmed" };
  }
  if (form.proof_state !== "completed") {
    return { ok: false, status: "missing_request", reason: "kc_paid_website_proof_pending" };
  }
  const rows = (await database.prepare(KC_QUOTE_LEAD_SQL).bind(requestId).all())?.results || [];
  if (rows.length === 0) return { ok: false, status: "missing_request", reason: "kc_paid_website_lead_pending" };
  if (rows.length !== 1 || !verifiedKcQuoteLeadRow(rows[0], { accountId, requestId, clientId })) {
    return { ok: false, status: "held", reason: "kc_paid_website_proof_unconfirmed" };
  }
  return { ok: true, lead: rows[0] };
}

export const _private = { KC_ACCOUNT_ID, KC_FORM_SQL, KC_QUOTE_LEAD_SQL, verifiedPaidEvidence };
