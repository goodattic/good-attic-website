import { _private as leadHelpers } from '../functions/api/leads.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';
import { canonicalJobberId, normalizeAcknowledgementPhone } from './acknowledgement-source.js';
import { _private as contactHelpers } from './jobber-contact-resolver.js';
import {
  proposeCallRequestLineage,
  verifyCallRequestLineage,
  persistVerifiedCallRequestLineage,
  _private as lineagePrivate,
} from './call-request-lineage.js';

const BODY_LIMIT = 8192;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const SOURCE_FIELDS = [
  'account_id', 'market', 'quo_call_id', 'original_request_id', 'client_id',
  'call_started_at_utc', 'caller_phone', 'phone_number_id',
];
const VERIFY_FIELDS = [
  'source', 'snapshot_digest', 'operational_request_id', 'decision_id',
  'reviewed_by', 'evidence_ref', 'ambiguity_reviewed',
];
const SUPERSEDE_FIELDS = [...VERIFY_FIELDS, 'prior_decision_id'];
const PREVIEW_FIELDS = ['account_id', 'quo_call_id'];

// The client connection is read to exhaustion. A one-page read can make an
// unrelated operational Request look unique and is never verification proof.
const ORIGINAL_QUERY = `query CallLineageOriginal($id: EncodedId!) {
  account { id }
  request(id: $id) {
    id createdAt updatedAt requestStatus client { id }
    assessment { id }
    quotes(first: 1) { nodes { id } }
    jobs(first: 1) { nodes { id } }
  }
}`;
const HISTORY_QUERY = `query CallLineageClientHistory($id: EncodedId!, $after: String) {
  account { id }
  client(id: $id) {
    id isArchived phones { number normalizedPhoneNumber }
    requests(first: 100, after: $after) {
      nodes {
        id createdAt updatedAt requestStatus client { id }
        assessment { id }
        quotes(first: 1) { nodes { id } }
        jobs(first: 1) { nodes { id } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

class ReviewError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const id = (value, type) => canonicalJobberId(value, type);
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function evidenceId(value) {
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = atob(value), canonical = btoa(decoded);
    return canonical.replace(/=+$/, '') === value.replace(/=+$/, '')
      && /^gid:\/\/Jobber\/[A-Za-z][A-Za-z0-9_]*\/[1-9][0-9]*$/.test(decoded) ? canonical : null;
  } catch { return null; }
}

function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

async function inputFor(request, keys) {
  if (request.method !== 'POST') throw new ReviewError('method_not_allowed', 405);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > BODY_LIMIT) throw new ReviewError('payload_too_large', 413);
  let raw, input;
  try { raw = await request.text(); } catch { throw new ReviewError('invalid_body', 400); }
  if (new TextEncoder().encode(raw).length > BODY_LIMIT) throw new ReviewError('payload_too_large', 413);
  try { input = JSON.parse(raw); } catch { throw new ReviewError('invalid_json', 400); }
  if (!exactKeys(input, keys)) throw new ReviewError('invalid_input', 400);
  return input;
}

function sourceFromCall(row, accountId, callId) {
  if (!row || !object(row) || row.account_id !== accountId || row.quo_call_id !== callId
    || !['utah', 'stl'].includes(row.market) || row.direction !== 'incoming'
    || !/^[A-Za-z0-9:_-]{1,240}$/.test(callId)
    || !/^[A-Za-z0-9:_-]{1,240}$/.test(row.phone_number_id || '')
    || normalizeAcknowledgementPhone(row.caller_phone) !== row.caller_phone
    || !id(row.jobber_request_id, 'Request') || !id(row.jobber_client_id, 'Client')
    || !Number.isFinite(Date.parse(row.call_started_at_utc))) {
    throw new ReviewError('quo_call_identity_incomplete', 409);
  }
  const route = getJobberOAuthRoute(row.market === 'utah' ? 'ut' : 'mo_stl', 'website');
  if (!route || route.expectedAccountId !== accountId) throw new ReviewError('quo_call_account_mismatch', 409);
  return {
    account_id: accountId, market: row.market, quo_call_id: callId,
    original_request_id: id(row.jobber_request_id, 'Request'),
    client_id: id(row.jobber_client_id, 'Client'),
    call_started_at_utc: new Date(row.call_started_at_utc).toISOString(),
    caller_phone: row.caller_phone, phone_number_id: row.phone_number_id,
  };
}

function normalizeRequest(row, expectedAccount, expectedClient) {
  const requestId = id(row?.id, 'Request');
  const clientId = id(row?.client?.id, 'Client');
  if (!requestId || clientId !== expectedClient
    || !Number.isFinite(Date.parse(row?.createdAt))
    || !Number.isFinite(Date.parse(row?.updatedAt))
    || typeof row?.requestStatus !== 'string'
    || (row.assessment !== null && row.assessment !== undefined && !evidenceId(row.assessment.id))
    || !Array.isArray(row?.quotes?.nodes) || row.quotes.nodes.length > 1
    || row.quotes.nodes.some(node => !evidenceId(node?.id))
    || !Array.isArray(row?.jobs?.nodes) || row.jobs.nodes.length > 1
    || row.jobs.nodes.some(node => !evidenceId(node?.id))) {
    throw new ReviewError('jobber_request_identity_conflict', 409);
  }
  return {
    id: requestId, account_id: expectedAccount, client: { id: clientId },
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(), requestStatus: row.requestStatus,
    assessment: row.assessment ? { id: evidenceId(row.assessment.id) } : null,
    quotes: { nodes: row.quotes.nodes.map(node => ({ id: evidenceId(node.id) })) },
    jobs: { nodes: row.jobs.nodes.map(node => ({ id: evidenceId(node.id) })) },
  };
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clientRequests(client, source) {
  if (id(client?.id, 'Client') !== source.client_id || typeof client.isArchived !== 'boolean'
    || !Array.isArray(client.phones) || client.phones.length > 1000) {
    throw new ReviewError('jobber_client_identity_conflict', 409);
  }
  let callerPresent = false;
  for (const phone of client.phones) {
    const raw = normalizeAcknowledgementPhone(phone?.number);
    const normalized = phone?.normalizedPhoneNumber == null
      ? null : normalizeAcknowledgementPhone(phone.normalizedPhoneNumber);
    if ((phone?.number && !raw) || (phone?.normalizedPhoneNumber && !normalized)
      || (raw && normalized && raw !== normalized)) {
      throw new ReviewError('jobber_client_phone_conflict', 409);
    }
    if ((normalized || raw) === source.caller_phone) callerPresent = true;
  }
  if (!callerPresent) throw new ReviewError('jobber_client_phone_mismatch', 409);
  return client.requests;
}

async function readJobber(env, route, source, deps) {
  let token;
  try { token = await deps.refreshJobberAccessToken(env, route); }
  catch { throw new ReviewError('jobber_auth_unavailable'); }
  if (typeof token?.accessToken !== 'string' || !token.accessToken) throw new ReviewError('jobber_auth_unavailable');
  async function query(document, variables) {
    let result;
    try { result = await deps.jobberGraphql(env, token.accessToken, document, variables); }
    catch { throw new ReviewError('jobber_read_unavailable'); }
    if (result?.errors?.length || !object(result?.data)) throw new ReviewError('jobber_read_unavailable');
    if (id(result.data.account?.id, 'Account') !== source.account_id) {
      throw new ReviewError('jobber_account_mismatch', 409);
    }
    return result.data;
  }

  const direct = (await query(ORIGINAL_QUERY, { id: source.original_request_id })).request;
  if (!direct || id(direct.id, 'Request') !== source.original_request_id) {
    throw new ReviewError('jobber_original_request_missing', 409);
  }
  const original = normalizeRequest(direct, source.account_id, source.client_id);
  if (Date.parse(original.createdAt) < Date.parse(source.call_started_at_utc) - 120_000
    || Date.parse(original.createdAt) > Date.parse(source.call_started_at_utc) + 86_400_000) {
    throw new ReviewError('jobber_original_request_time_conflict', 409);
  }
  const requests = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let after = null;
  let complete = false;
  let firstPageFingerprint = null;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const data = await query(HISTORY_QUERY, { id: source.client_id, after });
    const connection = clientRequests(data.client, source);
    if (!object(connection) || !Array.isArray(connection.nodes)
      || connection.nodes.length > PAGE_SIZE || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
      throw new ReviewError('jobber_request_history_incomplete');
    }
    if (pageIndex === 0) firstPageFingerprint = JSON.stringify(connection);
    for (const node of connection.nodes) {
      const normalized = normalizeRequest(node, source.account_id, source.client_id);
      if (seenIds.has(normalized.id)) throw new ReviewError('jobber_request_history_duplicate', 409);
      seenIds.add(normalized.id);
      requests.push(normalized);
    }
    if (!connection.pageInfo.hasNextPage) { complete = true; break; }
    const next = connection.pageInfo.endCursor;
    if (typeof next !== 'string' || !next || next.length > 1000
      || seenCursors.has(next) || connection.nodes.length === 0) {
      throw new ReviewError('jobber_request_history_incomplete');
    }
    seenCursors.add(next);
    after = next;
  }
  if (!complete) throw new ReviewError('jobber_request_history_incomplete');
  const inHistory = requests.find(request => request.id === original.id);
  if (!inHistory || !sameSnapshot(original, inHistory)) {
    throw new ReviewError('jobber_original_history_conflict', 409);
  }
  // Cursor pagination is not a transaction. Check its head again so a new
  // Request inserted while the later pages were read cannot masquerade as a
  // complete, unique candidate set.
  const freshHead = (await query(HISTORY_QUERY, { id: source.client_id, after: null })).client;
  if (JSON.stringify(clientRequests(freshHead, source)) !== firstPageFingerprint) {
    throw new ReviewError('jobber_request_history_changed', 409);
  }
  return { original, requests };
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function freshProposal(env, accountId, callId, deps) {
  if (!id(accountId, 'Account') || id(accountId, 'Account') !== accountId
    || !/^[A-Za-z0-9:_-]{1,240}$/.test(callId || '')) {
    throw new ReviewError('invalid_call_identity', 400);
  }
  const row = await env.ANGI_ROUTER_DB.prepare(
    'SELECT * FROM quo_call_attributions WHERE account_id = ? AND quo_call_id = ?',
  ).bind(accountId, callId).first();
  if (!row) throw new ReviewError('quo_call_not_found', 404);
  const source = sourceFromCall(row, accountId, callId);
  const marketRoute = getJobberOAuthRoute(source.market === 'utah' ? 'ut' : 'mo_stl', 'website');
  if (!marketRoute || marketRoute.expectedAccountId !== source.account_id) {
    throw new ReviewError('quo_call_account_mismatch', 409);
  }
  const history = await readJobber(env, marketRoute, source, deps);
  const proposal = proposeCallRequestLineage({
    source: row, originalRequest: history.original,
    clientRequests: history.requests, historyComplete: true,
  });
  const snapshot_digest = await digest({ source, original: history.original,
    requests: [...history.requests].sort((a, b) => a.id.localeCompare(b.id)) });
  return { source, snapshot_digest, proposal, request_count: history.requests.length,
    original_request_operational: lineagePrivate.hasOperationalMilestone(history.original) };
}

async function existingLink(database, source) {
  return database.prepare('SELECT * FROM call_request_lineage_links WHERE account_id = ? AND quo_call_id = ?')
    .bind(source.account_id, source.quo_call_id).first();
}

async function activeLink(database, source) {
  return database.prepare('SELECT * FROM call_request_lineage_active_links WHERE account_id = ? AND quo_call_id = ?')
    .bind(source.account_id, source.quo_call_id).first();
}

async function targetUnclaimed(database, source, target) {
  const active = await database.prepare(`SELECT quo_call_id FROM call_request_lineage_active_links
    WHERE account_id = ? AND operational_request_id = ? AND quo_call_id <> ? LIMIT 1`)
    .bind(source.account_id, target, source.quo_call_id).first();
  if (active) return false;
  const direct = await database.prepare(`SELECT quo_call_id FROM quo_call_attributions
    WHERE account_id = ? AND jobber_request_id = ? AND quo_call_id <> ? LIMIT 1`)
    .bind(source.account_id, target, source.quo_call_id).first();
  return !direct;
}

function exactDecision(input, fresh) {
  if (!exactKeys(input.source, SOURCE_FIELDS)
    || !/^[a-f0-9]{64}$/.test(input.snapshot_digest || '')
    || !id(input.operational_request_id, 'Request')
    || typeof input.ambiguity_reviewed !== 'boolean') {
    throw new ReviewError('invalid_decision', 400);
  }
  if (!SOURCE_FIELDS.every(field => input.source[field] === fresh.source[field])
    || fresh.snapshot_digest !== input.snapshot_digest) {
    throw new ReviewError('lineage_snapshot_changed', 409);
  }
}

function verifiedReviewFields(input) {
  if (!/^[A-Za-z0-9:_-]{1,120}$/.test(input.decision_id || '')
    || !clean(input.reviewed_by, 120) || !clean(input.evidence_ref, 500)
    || clean(input.reviewed_by, 120) !== input.reviewed_by
    || clean(input.evidence_ref, 500) !== input.evidence_ref) {
    throw new ReviewError('decision_review_incomplete', 400);
  }
}

async function persistSupersession(database, current, input) {
  const next = {
    decision_id: input.decision_id, account_id: current.account_id,
    quo_call_id: current.quo_call_id, revision: current.revision + 1,
    prior_decision_id: current.decision_id,
    operational_request_id: id(input.operational_request_id, 'Request'),
    verified_by: input.reviewed_by, evidence_ref: input.evidence_ref,
    verified_at: new Date().toISOString(),
  };
  const fields = Object.keys(next);
  try {
    const result = await database.prepare(`INSERT INTO call_request_lineage_supersessions
      (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
      .bind(...fields.map(field => next[field])).run();
    const stored = await activeLink(database, next);
    if (!stored || stored.revision !== next.revision
      || stored.decision_id !== next.decision_id
      || stored.operational_request_id !== next.operational_request_id) {
      return { ok: false, reason: 'lineage_supersession_conflict' };
    }
    return { ok: true, inserted: Number(result?.meta?.changes ?? result?.changes ?? 0) > 0, link: stored };
  } catch { return { ok: false, reason: 'lineage_supersession_conflict' }; }
}

export async function handleCallRequestLineageReview({ request, env, action }, deps = leadHelpers) {
  // A dedicated review credential can be provisioned without rotating the
  // existing Stage 1 administrator secret used by unrelated endpoints.
  const reviewSecret = env.CALL_LINEAGE_REVIEW_SECRET || env.STAGE1_ADMIN_SECRET;
  if (!await contactHelpers.authorized(request, reviewSecret)) {
    return json({ ok: false, code: 'unauthorized' }, 401);
  }
  if (!env.ANGI_ROUTER_DB?.prepare) {
    return json({ ok: false, code: 'lineage_database_unavailable' }, 503);
  }
  try {
    if (action === 'preview') {
      const input = await inputFor(request, PREVIEW_FIELDS);
      const fresh = await freshProposal(env, input.account_id, input.quo_call_id, deps);
      const active = await activeLink(env.ANGI_ROUTER_DB, fresh.source);
      return json({ ok: true, ...fresh, active_link: active || null });
    }
    if (action === 'verify') {
      const input = await inputFor(request, VERIFY_FIELDS);
      if (!exactKeys(input.source, SOURCE_FIELDS)) throw new ReviewError('invalid_decision', 400);
      const fresh = await freshProposal(env, input.source.account_id, input.source.quo_call_id, deps);
      exactDecision(input, fresh);
      verifiedReviewFields(input);
      if (fresh.original_request_operational && input.ambiguity_reviewed !== true) {
        throw new ReviewError('original_operational_requires_explicit_review', 409);
      }
      const verification = verifyCallRequestLineage(fresh.proposal, {
        operational_request_id: input.operational_request_id,
        confirmed_by: input.reviewed_by,
        evidence_ref: input.evidence_ref,
        decision_id: input.decision_id,
        ambiguity_reviewed: input.ambiguity_reviewed,
      });
      if (!verification.ok) throw new ReviewError(verification.reason, 409);
      const prior = await existingLink(env.ANGI_ROUTER_DB, fresh.source);
      const active = await activeLink(env.ANGI_ROUTER_DB, fresh.source);
      if (active && active.revision > 0) throw new ReviewError('lineage_already_superseded', 409);
      if (prior) {
        if (prior.operational_request_id !== verification.link.operational_request_id
          || prior.decision_id !== verification.link.decision_id
          || prior.account_id !== verification.link.account_id
          || prior.original_request_id !== verification.link.original_request_id
          || prior.client_id !== verification.link.client_id
          || prior.call_started_at_utc !== verification.link.call_started_at_utc
          || prior.verified_by !== verification.link.verified_by
          || prior.evidence_ref !== verification.link.evidence_ref) {
          throw new ReviewError('lineage_link_conflict', 409);
        }
        return json({ ok: true, inserted: false, link: prior });
      }
      if (!await targetUnclaimed(env.ANGI_ROUTER_DB, fresh.source, verification.link.operational_request_id)) {
        throw new ReviewError('lineage_target_already_claimed', 409);
      }
      const saved = await persistVerifiedCallRequestLineage(env.ANGI_ROUTER_DB, verification);
      if (!saved.ok) throw new ReviewError(saved.reason, saved.reason === 'lineage_link_conflict' ? 409 : 503);
      return json({ ok: true, inserted: saved.inserted, link: saved.link });
    }
    if (action === 'supersede') {
      const input = await inputFor(request, SUPERSEDE_FIELDS);
      if (!exactKeys(input.source, SOURCE_FIELDS)) throw new ReviewError('invalid_decision', 400);
      const fresh = await freshProposal(env, input.source.account_id, input.source.quo_call_id, deps);
      exactDecision(input, fresh);
      verifiedReviewFields(input);
      const current = await activeLink(env.ANGI_ROUTER_DB, fresh.source);
      if (!current || current.decision_id !== input.prior_decision_id
        || !Number.isInteger(current.revision) || current.revision < 0) {
        throw new ReviewError('lineage_prior_decision_stale', 409);
      }
      const target = id(input.operational_request_id, 'Request');
      if (target === current.operational_request_id) throw new ReviewError('lineage_target_unchanged', 409);
      if (target === fresh.source.original_request_id) {
        if (!fresh.original_request_operational) {
          throw new ReviewError('original_request_not_operational', 409);
        }
        if (fresh.proposal.candidate_request_ids.length > 0 && !input.ambiguity_reviewed) {
          throw new ReviewError('ambiguous_candidates_require_explicit_review', 409);
        }
      } else {
        const confirmation = verifyCallRequestLineage(fresh.proposal, {
          operational_request_id: target, confirmed_by: input.reviewed_by,
          evidence_ref: input.evidence_ref, decision_id: input.decision_id,
          ambiguity_reviewed: input.ambiguity_reviewed,
        });
        if (!confirmation.ok) throw new ReviewError(confirmation.reason, 409);
        if (fresh.original_request_operational && !input.ambiguity_reviewed) {
          throw new ReviewError('original_operational_requires_explicit_review', 409);
        }
      }
      if (!await targetUnclaimed(env.ANGI_ROUTER_DB, fresh.source, target)) {
        throw new ReviewError('lineage_target_already_claimed', 409);
      }
      const saved = await persistSupersession(env.ANGI_ROUTER_DB, current, input);
      if (!saved.ok) throw new ReviewError(saved.reason, 409);
      return json({ ok: true, inserted: saved.inserted, active_link: saved.link });
    }
    throw new ReviewError('not_found', 404);
  } catch (error) {
    if (error instanceof ReviewError) return json({ ok: false, code: error.code }, error.status);
    return json({ ok: false, code: 'lineage_review_unavailable' }, 503);
  }
}

export const _private = { ORIGINAL_QUERY, HISTORY_QUERY, sourceFromCall, normalizeRequest,
  readJobber, freshProposal, MAX_PAGES };
