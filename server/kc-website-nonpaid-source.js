import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { canonicalJobberId } from "./acknowledgement-source.js";
import { validSubmissionId } from "./website-form-transactions.js";

const KC_ACCOUNT_ID = getJobberOAuthRoute("mo_kc", "website").expectedAccountId;
const NONPAID_DETAILS = new Set(["organic_online", "ai_referral"]);

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
function validNonpaidLead(lead) {
  return validSubmissionId(lead?.submission_id) && lead.market_key === "mo_kc"
    && lead.source_key === "website" && lead.source_label === "Organic Online"
    && NONPAID_DETAILS.has(lead.source_detail)
    && Boolean(clean(lead.source_reason, 200))
    && Number.isFinite(Date.parse(lead.submitted_at));
}

export async function readKcNonpaidSource(database, submissionId) {
  if (!database?.prepare || !validSubmissionId(submissionId)) {
    throw new Error("kc_nonpaid_source_unavailable");
  }
  return database.prepare(`SELECT * FROM kc_website_nonpaid_source_attestations
    WHERE submission_id = ?`).bind(submissionId).first();
}

export async function prepareKcNonpaidSource(database, lead) {
  if (!database?.prepare || !validNonpaidLead(lead)) throw new Error("kc_nonpaid_source_invalid");
  const paid = await database.prepare(`SELECT submission_id FROM website_google_source_proofs
    WHERE submission_id = ?`).bind(lead.submission_id).first();
  if (paid) throw new Error("kc_source_conflict");
  const sourceAt = new Date(lead.submitted_at).toISOString();
  const now = new Date().toISOString();
  try { await database.prepare(`INSERT OR IGNORE INTO kc_website_nonpaid_source_attestations
    (submission_id, market_key, source_key, source_label, source_detail,
      source_reason, source_created_at, state, account_id, created_at, updated_at)
    VALUES (?, 'mo_kc', 'website', 'Organic Online', ?, ?, ?, 'prepared', ?, ?, ?)`)
    .bind(lead.submission_id, lead.source_detail, clean(lead.source_reason, 200),
      sourceAt, KC_ACCOUNT_ID, now, now).run(); }
  catch (error) {
    if (String(error).includes("kc_source_conflict")) throw new Error("kc_source_conflict");
    throw error;
  }
  const stored = await readKcNonpaidSource(database, lead.submission_id);
  if (!stored || stored.market_key !== "mo_kc" || stored.source_key !== "website"
    || stored.source_label !== "Organic Online" || stored.source_detail !== lead.source_detail
    || stored.source_reason !== clean(lead.source_reason, 200)
    || !Number.isFinite(Date.parse(stored.source_created_at))
    || stored.account_id !== KC_ACCOUNT_ID
    || stored.state !== "prepared" || stored.jobber_request_id || stored.jobber_client_id) {
    throw new Error("kc_source_conflict");
  }
  return stored;
}

export async function completeKcNonpaidSource(database, lead, jobber) {
  const requestId = canonicalJobberId(jobber?.request_id, "Request");
  const clientId = canonicalJobberId(jobber?.client_id, "Client");
  if (!database?.prepare || !validNonpaidLead(lead)
    || jobber?.account_id !== KC_ACCOUNT_ID || jobber?.market_key !== "mo_kc"
    || !requestId || !clientId) throw new Error("kc_nonpaid_source_link_invalid");
  const result = await database.prepare(`UPDATE kc_website_nonpaid_source_attestations
    SET state = 'completed', jobber_request_id = ?, jobber_client_id = ?, updated_at = ?
    WHERE submission_id = ? AND market_key = 'mo_kc' AND account_id = ?
      AND source_key = 'website' AND source_label = 'Organic Online'
      AND source_detail = ? AND source_reason = ? AND source_created_at = ?
      AND state = 'prepared' AND jobber_request_id IS NULL AND jobber_client_id IS NULL`)
    .bind(requestId, clientId, new Date().toISOString(), lead.submission_id,
      KC_ACCOUNT_ID, lead.source_detail, clean(lead.source_reason, 200),
      new Date(lead.submitted_at).toISOString()).run();
  if (changes(result) !== 1) throw new Error("kc_nonpaid_source_link_unconfirmed");
  const stored = await readKcNonpaidSource(database, lead.submission_id);
  if (stored?.state !== "completed" || stored.jobber_request_id !== requestId
    || stored.jobber_client_id !== clientId) throw new Error("kc_nonpaid_source_link_unconfirmed");
  return stored;
}

export const _private = { KC_ACCOUNT_ID, validNonpaidLead };
