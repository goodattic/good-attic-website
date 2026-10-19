import { canonicalJobberId } from './acknowledgement-source.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

// This resolver only evaluates authoritative Quo and Jobber snapshots supplied by
// its caller. It never infers a call source from a phone number or a website lead.
export const LINEAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MARKET_KEYS = { utah: 'ut', stl: 'mo_stl' };
const clean = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const requestId = value => canonicalJobberId(value, 'Request');
const clientId = value => canonicalJobberId(value, 'Client');
const accountId = value => canonicalJobberId(value, 'Account');

function identity(source) {
  const account = accountId(source?.account_id);
  const original = requestId(source?.jobber_request_id);
  const client = clientId(source?.jobber_client_id);
  const call = clean(source?.quo_call_id, 240);
  const market = MARKET_KEYS[source?.market];
  const at = source?.call_started_at_utc;
  if (!account || !original || !client || !market
    || getJobberOAuthRoute(market, 'website')?.expectedAccountId !== account
    || !/^[A-Za-z0-9:_-]{1,240}$/.test(call) || !validTime(at)) return null;
  return { account_id: account, market_key: market, quo_call_id: call,
    original_request_id: original, client_id: client, call_started_at_utc: new Date(at).toISOString() };
}

function sameRequestIdentity(request, id) {
  return requestId(request?.id) === id;
}

function sameAccountAndClient(request, source) {
  return accountId(request?.account_id) === source.account_id
    && clientId(request?.client?.id) === source.client_id;
}

function hasOperationalMilestone(request) {
  return Boolean(request?.assessment?.id || request?.quotes?.nodes?.some(quote => quote?.id)
    || request?.jobs?.nodes?.some(job => job?.id));
}

function result(status, reason, source, candidateIds = []) {
  return { status, reason, source, candidate_request_ids: candidateIds };
}

/**
 * Candidate discovery is deliberately conservative. A unique same-client
 * Request with an assessment/quote/job is a proposal, never upload authority.
 * The caller must supply a complete, freshly read Jobber client Request history.
 */
export function proposeCallRequestLineage({ source, originalRequest, clientRequests, historyComplete } = {}) {
  const origin = identity(source);
  if (!origin) return result('manual_review', 'call_origin_identity_incomplete', null);
  if (!originalRequest || !sameRequestIdentity(originalRequest, origin.original_request_id)
    || !sameAccountAndClient(originalRequest, origin)) {
    return result('manual_review', 'original_request_identity_conflict', origin);
  }
  if (!historyComplete || !Array.isArray(clientRequests)) return result('manual_review', 'jobber_request_history_incomplete', origin);
  const callAt = Date.parse(origin.call_started_at_utc);
  const candidates = new Map();
  for (const request of clientRequests) {
    const id = requestId(request?.id);
    if (!id || !sameAccountAndClient(request, origin) || !validTime(request?.createdAt)) {
      return result('manual_review', 'candidate_identity_or_time_incomplete', origin);
    }
    if (id === origin.original_request_id) continue;
    if (candidates.has(id)) return result('manual_review', 'duplicate_candidate_snapshot', origin);
    const createdAt = Date.parse(request.createdAt);
    if (createdAt < callAt - 120_000 || createdAt > callAt + LINEAGE_WINDOW_MS) continue;
    if (hasOperationalMilestone(request)) candidates.set(id, request);
  }
  const ids = [...candidates.keys()].sort();
  if (!ids.length && hasOperationalMilestone(originalRequest)) return result('same_request', 'original_request_is_operational', origin);
  if (!ids.length) return result('no_link', 'no_operational_request_candidate', origin);
  if (ids.length > 1) return result('manual_review', 'multiple_operational_request_candidates', origin, ids);
  return result('proposed', 'unique_operational_request_candidate', origin, ids);
}

/** Explicit human confirmation is required even for a unique candidate. */
export function verifyCallRequestLineage(proposal, confirmation, verifiedAt = new Date().toISOString()) {
  const source = proposal?.source;
  const target = requestId(confirmation?.operational_request_id);
  const reviewer = clean(confirmation?.confirmed_by, 120);
  const evidence = clean(confirmation?.evidence_ref, 500);
  const decisionId = clean(confirmation?.decision_id, 120);
  if (!source || !['proposed', 'manual_review'].includes(proposal.status)
    || !proposal.candidate_request_ids?.includes(target) || !target
    || target === source.original_request_id || !reviewer || !evidence
    || !/^[A-Za-z0-9:_-]{1,120}$/.test(decisionId) || !validTime(verifiedAt)) {
    return { ok: false, reason: 'confirmation_incomplete_or_candidate_unverified' };
  }
  if (proposal.candidate_request_ids.length > 1 && confirmation?.ambiguity_reviewed !== true) {
    return { ok: false, reason: 'ambiguous_candidates_require_explicit_review' };
  }
  return { ok: true, link: { ...source, operational_request_id: target,
    decision_id: decisionId, verified_by: reviewer, evidence_ref: evidence,
    verified_at: new Date(verifiedAt).toISOString() } };
}

/** Persist a proposal or ambiguity as an append-only review item. */
export async function persistCallRequestLineageReview(database, proposal, review = {}) {
  const source = proposal?.source;
  const decision = proposal?.status;
  const decisionId = clean(review.decision_id, 120);
  const recordedAt = review.recorded_at || new Date().toISOString();
  if (!database?.prepare || !source || !['proposed', 'manual_review'].includes(decision)
    || !/^[A-Za-z0-9:_-]{1,120}$/.test(decisionId) || !validTime(recordedAt)) {
    return { ok: false, reason: 'invalid_review' };
  }
  const row = {
    decision_id: decisionId, account_id: source.account_id, quo_call_id: source.quo_call_id,
    original_request_id: source.original_request_id,
    candidate_request_ids_json: JSON.stringify(proposal.candidate_request_ids || []),
    decision, reason: clean(proposal.reason, 120),
    reviewed_by: clean(review.reviewed_by, 120) || null,
    evidence_ref: clean(review.evidence_ref, 500) || null,
    recorded_at: new Date(recordedAt).toISOString(),
  };
  const fields = Object.keys(row);
  try {
    const result = await database.prepare(`INSERT OR IGNORE INTO call_request_lineage_reviews
      (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
      .bind(...fields.map(field => row[field])).run();
    const stored = await database.prepare(`SELECT ${fields.join(', ')} FROM call_request_lineage_reviews
      WHERE decision_id = ?`).bind(decisionId).first();
    if (!stored || fields.some(field => stored[field] !== row[field])) return { ok: false, reason: 'review_identity_conflict' };
    return { ok: true, inserted: Number(result?.meta?.changes ?? result?.changes ?? 0) === 1 };
  } catch {
    return { ok: false, reason: 'review_write_failed' };
  }
}

/** Insert-only; database constraints and its audit trigger fence conflicting links. */
export async function persistVerifiedCallRequestLineage(database, verification) {
  if (!database?.prepare || !verification?.ok || !verification.link) return { ok: false, reason: 'invalid_verification' };
  const row = verification.link;
  const fields = ['account_id', 'quo_call_id', 'market_key', 'original_request_id',
    'operational_request_id', 'client_id', 'call_started_at_utc', 'decision_id',
    'verified_by', 'evidence_ref', 'verified_at'];
  try {
    const result = await database.prepare(`INSERT OR IGNORE INTO call_request_lineage_links
      (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
      .bind(...fields.map(field => row[field])).run();
    const stored = await database.prepare(`SELECT ${fields.join(', ')} FROM call_request_lineage_links
      WHERE account_id = ? AND quo_call_id = ?`).bind(row.account_id, row.quo_call_id).first();
    if (!stored || fields.some(field => stored[field] !== row[field])) return { ok: false, reason: 'lineage_link_conflict' };
    return { ok: true, inserted: Number(result?.meta?.changes ?? result?.changes ?? 0) > 0, link: stored };
  } catch {
    return { ok: false, reason: 'lineage_write_failed' };
  }
}

export const _private = { identity, hasOperationalMilestone, sameAccountAndClient };
