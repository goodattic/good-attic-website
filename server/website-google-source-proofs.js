import { validSubmissionId } from './website-form-transactions.js';

const KC_ACCOUNT_ID = 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==';
const GOOGLE_REASONS = /^(?:(?:paid_touch|first_touch)_)?(?:gclid|gbraid|wbraid|gad_source|google_paid_utm)$/;

function changes(result) { return Number(result?.meta?.changes ?? result?.changes ?? 0); }

function validLead(lead) {
  return validSubmissionId(lead?.submission_id) && lead.market_key === 'mo_kc'
    && lead.source_key === 'google' && lead.source_detail === 'google_ads'
    && GOOGLE_REASONS.test(lead.source_reason || '');
}

export function googleSourceEvidence(lead, attribution, verifiedSignals) {
  if (!validLead(lead) || !attribution || typeof attribution !== 'object' || Array.isArray(attribution)) {
    throw new Error('google_source_evidence_invalid');
  }
  const prefix = lead.source_reason.startsWith('paid_touch_') ? 'paid_touch'
    : lead.source_reason.startsWith('first_touch_') ? 'first_touch' : '';
  const reason = prefix ? lead.source_reason.slice(prefix.length + 1) : lead.source_reason;
  const signalValid = reason === 'google_paid_utm'
    ? verifiedSignals?.utm_source?.toLowerCase() === 'google'
      && /^(?:cpc|ppc|paidsearch|paid-search|sem)$/i.test(
        (verifiedSignals?.utm_medium || '').replace(/[\s_]+/g, '-'))
    : reason === 'gad_source'
      ? /^\d{1,12}$/.test(verifiedSignals?.gad_source || '')
      : /^[A-Za-z0-9._~-]{6,300}$/.test(verifiedSignals?.[reason] || '');
  if (!signalValid) throw new Error('google_source_evidence_invalid');
  const capturedAt = attribution[prefix ? `${prefix}_captured_at` : 'attribution_captured_at'];
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('google_source_evidence_invalid');
  return JSON.stringify({
    schema_version: 1,
    source_key: 'google',
    source_detail: 'google_ads',
    source_reason: lead.source_reason,
    verified_signals: verifiedSignals,
    attribution,
  });
}

export async function readGoogleSourceProof(database, submissionId) {
  if (!database?.prepare || !validSubmissionId(submissionId)) throw new Error('google_source_proof_unavailable');
  return database.prepare(`SELECT * FROM website_google_source_proofs WHERE submission_id = ?`)
    .bind(submissionId).first();
}

export async function prepareGoogleSourceProof(database, lead, evidenceJson) {
  if (!database?.prepare || !validLead(lead) || typeof evidenceJson !== 'string') {
    throw new Error('google_source_proof_unavailable');
  }
  const at = new Date().toISOString();
  await database.prepare(`INSERT OR IGNORE INTO website_google_source_proofs
    (submission_id, source_lead_id, market_key, account_id, source_key, source_detail,
      source_reason, evidence_json, state, created_at, updated_at)
    VALUES (?, ?, 'mo_kc', ?, 'google', 'google_ads', ?, ?, 'prepared', ?, ?)`)
    .bind(lead.submission_id, `website:${lead.submission_id.toLowerCase()}`, KC_ACCOUNT_ID,
      lead.source_reason, evidenceJson, at, at).run();
  const row = await readGoogleSourceProof(database, lead.submission_id);
  if (!row || row.market_key !== 'mo_kc' || row.account_id !== KC_ACCOUNT_ID
    || row.source_key !== 'google' || row.source_detail !== 'google_ads'
    || row.source_reason !== lead.source_reason || row.evidence_json !== evidenceJson
    || row.source_lead_id !== `website:${lead.submission_id.toLowerCase()}`) {
    throw new Error('google_source_proof_conflict');
  }
  if (row.state !== 'prepared') throw new Error('google_source_proof_requires_reconciliation');
  return row;
}

export async function beginGoogleSourceWrite(database, submissionId, sourceApp, fallbackReason = null) {
  if (!['google', 'website'].includes(sourceApp)
    || (sourceApp === 'google' && fallbackReason !== null)
    || (sourceApp === 'website' && !fallbackReason)) throw new Error('google_source_write_invalid');
  const result = await database.prepare(`UPDATE website_google_source_proofs
    SET state = 'write_started', jobber_source_app = ?, fallback_reason = ?, updated_at = ?
    WHERE submission_id = ? AND state = 'prepared' AND jobber_source_app IS NULL`)
    .bind(sourceApp, fallbackReason, new Date().toISOString(), submissionId).run();
  if (changes(result) !== 1) throw new Error('google_source_proof_requires_reconciliation');
  const row = await readGoogleSourceProof(database, submissionId);
  if (row?.state !== 'write_started' || row.jobber_source_app !== sourceApp
    || row.fallback_reason !== fallbackReason) throw new Error('google_source_write_unconfirmed');
  return row;
}

export async function completeGoogleSourceProof(database, lead, jobber) {
  if (!validLead(lead) || jobber?.account_id !== KC_ACCOUNT_ID
    || !jobber?.request_id || !jobber?.client_id
    || !['google', 'website'].includes(jobber?.jobber_source_app)) {
    throw new Error('google_source_link_invalid');
  }
  const result = await database.prepare(`UPDATE website_google_source_proofs
    SET state = 'completed', jobber_request_id = ?, jobber_client_id = ?, updated_at = ?
    WHERE submission_id = ? AND state = 'write_started' AND account_id = ?
      AND jobber_source_app = ? AND jobber_request_id IS NULL AND jobber_client_id IS NULL`)
    .bind(jobber.request_id, jobber.client_id, new Date().toISOString(), lead.submission_id,
      KC_ACCOUNT_ID, jobber.jobber_source_app).run();
  if (changes(result) !== 1) throw new Error('google_source_link_unconfirmed');
  const row = await readGoogleSourceProof(database, lead.submission_id);
  if (row?.state !== 'completed' || row.jobber_request_id !== jobber.request_id
    || row.jobber_client_id !== jobber.client_id || row.jobber_source_app !== jobber.jobber_source_app) {
    throw new Error('google_source_link_unconfirmed');
  }
  return row;
}

export const _private = { KC_ACCOUNT_ID };
