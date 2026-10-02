import { normalizeAcknowledgementPhone as normalizePhone, canonicalJobberId } from './acknowledgement-source.js';

export const MANUAL_MATCH_FLAG = 'QUALIFIED_PHONE_MANUAL_MATCH_ENABLED';
export const MANUAL_UPLOAD_FLAG = 'QUALIFIED_PHONE_MANUAL_UPLOAD_ENABLED';
export const MANUAL_MATCH_LOOKBACK_MS = 0;
export const MANUAL_MATCH_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
export const MANUAL_CONVERSATION_SECONDS = 60;
const MAX_PAGES = 20;
const MARKET_NAMES = Object.freeze({ ut: 'utah', mo_stl: 'stl', mo_kc: 'kc' });
const MARKET_LINES = Object.freeze({ ut: '+13853364442', mo_stl: '+13149312620', mo_kc: '+18164340308' });
const ANGI_APPLICATION_ID = btoa('gid://Jobber/Application/152570');
const hold = reason => ({ ok: false, reason });

export const MANUAL_JOBBER_QUERIES = Object.freeze({
  phones: `query QualifiedPhoneClients($searchTerm:String!,$after:String) {
    account { id }
    clientPhones(searchTerm:$searchTerm,first:100,after:$after) {
      nodes { number normalizedPhoneNumber client { id isArchived } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
  client: `query QualifiedPhoneClient($id:EncodedId!) {
    account { id }
    client(id:$id) { id isArchived phones { number } }
  }`,
  requests: `query QualifiedPhoneRequests($id:EncodedId!,$after:String) {
    account { id }
    client(id:$id) { id isArchived requests(first:100,after:$after) {
      nodes { id createdAt }
      pageInfo { hasNextPage endCursor }
    } }
  }`,
  jobs: `query QualifiedPhoneJobs($id:EncodedId!,$after:String) {
    account { id }
    client(id:$id) { id isArchived jobs(first:100,after:$after) {
      nodes { id createdAt }
      pageInfo { hasNextPage endCursor }
    } }
  }`,
  request: `query QualifiedPhoneRequest($id:EncodedId!) {
    account { id }
    request(id:$id) { id createdAt source requestStatus client { id isArchived phones { number } }
      notes(first:100) { nodes { __typename ... on RequestNote {
        createdBy { __typename ... on Application { id } }
      } } pageInfo { hasNextPage } }
    }
  }`,
});

/** Require the canonical Quo answer timestamp, not a completed-call inference. */
export function manualConversationEligible(quoCall, googleCall) {
  if (String(quoCall?.final_status || '').trim().toLowerCase() !== 'completed') {
    return hold('manual_call_not_answered');
  }
  const seconds = Number(quoCall?.duration_seconds);
  if (!Number.isFinite(seconds) || seconds < MANUAL_CONVERSATION_SECONDS) {
    return hold('manual_call_under_60s');
  }
  const answered = Date.parse(quoCall?.answered_at || '');
  const started = Date.parse(quoCall?.call_started_at_utc || '');
  if (!Number.isFinite(answered) || !Number.isFinite(started)
    || answered < started || answered > started + 7 * 24 * 60 * 60 * 1000) {
    return hold('answered_unverified');
  }
  if (String(googleCall?.call_status || '').trim().toLowerCase() !== 'received') {
    return hold('google_call_not_received');
  }
  return { ok: true };
}

function checkedPhone(raw, normalized) {
  if (typeof raw !== 'string' || (normalized != null && typeof normalized !== 'string')) return { conflict: true };
  const number = normalizePhone(raw);
  const provider = normalized ? normalizePhone(normalized) : null;
  if ((raw.trim() && !number) || (normalized && !provider) || (number && provider && number !== provider)) {
    return { conflict: true };
  }
  return { phone: provider || number || null };
}

function page(connection, seen) {
  if (!connection || !Array.isArray(connection.nodes) || connection.nodes.length > 100
    || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw Error('jobber_history_incomplete');
  if (!connection.pageInfo.hasNextPage) return null;
  const cursor = connection.pageInfo.endCursor;
  if (typeof cursor !== 'string' || !cursor || cursor.length > 1000 || seen.has(cursor) || !connection.nodes.length) {
    throw Error('jobber_history_incomplete');
  }
  seen.add(cursor);
  return cursor;
}

async function allPages(read, query, variables, select) {
  const rows = [], seen = new Set();
  let after = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await read(query, { ...variables, after });
    const connection = select(data);
    const next = page(connection, seen);
    rows.push(...connection.nodes);
    if (!next) return rows;
    after = next;
  }
  throw Error('jobber_history_incomplete');
}

function assertAccount(data, expectedAccountId) {
  if (data?.account?.id !== expectedAccountId) throw Error('jobber_account_mismatch');
  return data;
}

function knownExternalSource(source) {
  const value = typeof source === 'string' ? source.trim().toLowerCase() : '';
  if (!value) return null;
  if (/website|fieldflow|angi|angie|homeadvisor|home advisor/.test(value)) return 'request_other_intake_source';
  // Generic "Google" may mean a click form or an ad call. Do not guess.
  if (value === 'google' || value === 'google ads') return 'request_source_ambiguous';
  return null;
}

async function sourceHold(db, accountId, marketKey, requestId) {
  const [receipt, websiteLead, closedLoopLead, disposition, autoQuo] = await Promise.all([
    db.prepare('SELECT source_kind FROM acknowledgement_sources WHERE account_id=? AND request_id=?').bind(accountId, requestId).first(),
    db.prepare('SELECT request_id FROM closed_loop_stage1_leads WHERE market_key=? AND request_id=?').bind(marketKey, requestId).first(),
    db.prepare('SELECT jobber_request_id FROM closed_loop_leads WHERE jobber_request_id=?').bind(requestId).first(),
    db.prepare('SELECT disposition FROM closed_loop_lead_dispositions WHERE market_key=? AND request_id=?').bind(marketKey, requestId).first(),
    db.prepare("SELECT operation_id FROM quo_intake_operations WHERE account_id=? AND request_id=? AND operation_kind='intake' LIMIT 1")
      .bind(accountId, requestId).first(),
  ]);
  if (receipt || websiteLead || closedLoopLead) return 'request_other_intake_source';
  if (disposition) return 'jobber_lead_excluded';
  if (autoQuo) return 'request_auto_quo_intake';
  return null;
}

/** Read-only Jobber proof for a manually created Request. Never infers identity from notes. */
export async function resolveManualJobberRequest({ callerPhone, callAt, marketKey, accountId, read, db }) {
  const caller = normalizePhone(callerPhone), started = Date.parse(callAt || '');
  if (!caller || !Number.isFinite(started) || !MARKET_NAMES[marketKey] || !accountId || !read || !db?.prepare) {
    return hold('jobber_match_fields_missing');
  }
  const checkedRead = async (query, vars) => assertAccount(await read(query, vars), accountId);
  try {
    const clients = new Map();
    for (const searchTerm of [caller, caller.slice(2)]) {
      const entries = await allPages(checkedRead, MANUAL_JOBBER_QUERIES.phones, { searchTerm }, data => data.clientPhones);
      for (const entry of entries) {
        const candidate = checkedPhone(entry?.number, entry?.normalizedPhoneNumber);
        if (candidate.conflict && (normalizePhone(entry?.number) === caller || normalizePhone(entry?.normalizedPhoneNumber) === caller)) {
          return hold('jobber_phone_identity_conflict');
        }
        if (candidate.phone !== caller) continue;
        const id = canonicalJobberId(entry?.client?.id, 'Client');
        if (!id || typeof entry.client.isArchived !== 'boolean') return hold('jobber_phone_search_invalid');
        clients.set(id, entry.client.isArchived);
      }
    }
    if (!clients.size) return hold('jobber_client_missing');
    if (clients.size > 1) return hold('jobber_shared_phone');
    const [clientId] = clients.keys();
    const direct = (await checkedRead(MANUAL_JOBBER_QUERIES.client, { id: clientId })).client;
    if (direct?.id !== clientId || typeof direct.isArchived !== 'boolean' || !Array.isArray(direct.phones)
      || direct.phones.length > 1000) return hold('jobber_client_read_invalid');
    if (direct.isArchived) return hold('jobber_client_archived');
    let matched = false;
    for (const item of direct.phones) {
      const checked = checkedPhone(item?.number, item?.normalizedPhoneNumber);
      if (checked.conflict) return hold('jobber_phone_identity_conflict');
      matched ||= checked.phone === caller;
    }
    if (!matched) return hold('jobber_phone_changed');

    const load = async (kind, query) => allPages(checkedRead, query, { id: clientId }, data => {
      if (data.client?.id !== clientId || data.client.isArchived !== false) throw Error('jobber_history_incomplete');
      return data.client[kind];
    });
    const requests = await load('requests', MANUAL_JOBBER_QUERIES.requests);
    const jobs = await load('jobs', MANUAL_JOBBER_QUERIES.jobs);
    const seenRequests = new Set(), seenJobs = new Set();
    for (const item of requests) {
      const id = canonicalJobberId(item?.id, 'Request');
      if (!id || seenRequests.has(id) || !Number.isFinite(Date.parse(item.createdAt || ''))) return hold('jobber_history_incomplete');
      seenRequests.add(id);
    }
    for (const item of jobs) {
      const id = canonicalJobberId(item?.id, 'Job');
      if (!id || seenJobs.has(id) || !Number.isFinite(Date.parse(item.createdAt || ''))) return hold('jobber_history_incomplete');
      seenJobs.add(id);
    }
    if (jobs.some(item => Date.parse(item.createdAt) < started)) return hold('prior_job_requires_review');
    if (requests.some(item => Date.parse(item.createdAt) < started - MANUAL_MATCH_LOOKBACK_MS)) {
      return hold('prior_request_requires_review');
    }
    const candidates = requests.filter(item => {
      const at = Date.parse(item.createdAt);
      return at >= started - MANUAL_MATCH_LOOKBACK_MS && at <= started + MANUAL_MATCH_LOOKAHEAD_MS;
    });
    if (!candidates.length) return hold('awaiting_manual_request');
    if (candidates.length > 1) return hold('ambiguous_jobber_request');
    const listed = candidates[0];
    const request = (await checkedRead(MANUAL_JOBBER_QUERIES.request, { id: listed.id })).request;
    if (request?.id !== listed.id || request.client?.id !== clientId || Date.parse(request.createdAt || '') !== Date.parse(listed.createdAt)) {
      return hold('jobber_request_identity_changed');
    }
    if (request.client.isArchived !== false) return hold('jobber_client_archived');
    if (typeof request.requestStatus !== 'string' || !request.requestStatus.trim()) {
      return hold('jobber_request_status_missing');
    }
    if (/archiv|junk|spam|discard|delet/i.test(request.requestStatus)) {
      return hold('jobber_request_archived_or_junk');
    }
    if (!Array.isArray(request.client.phones) || request.client.phones.length > 1000) return hold('jobber_phone_response_invalid');
    let requestPhoneMatch = false;
    for (const item of request.client.phones) {
      const checked = checkedPhone(item?.number, item?.normalizedPhoneNumber);
      if (checked.conflict) return hold('jobber_phone_identity_conflict');
      requestPhoneMatch ||= checked.phone === caller;
    }
    if (!requestPhoneMatch) return hold('jobber_request_client_phone_mismatch');
    if (!Array.isArray(request.notes?.nodes) || typeof request.notes?.pageInfo?.hasNextPage !== 'boolean'
      || request.notes.pageInfo.hasNextPage) return hold('jobber_request_notes_incomplete');
    if (request.notes.nodes.some(note => note?.__typename === 'RequestNote'
      && note.createdBy?.__typename === 'Application'
      && canonicalJobberId(note.createdBy.id, 'Application') === ANGI_APPLICATION_ID)) {
      return hold('request_other_intake_source');
    }
    const explicitSource = knownExternalSource(request.source);
    if (explicitSource) return hold(explicitSource);
    const recordedSource = await sourceHold(db, accountId, marketKey, request.id);
    if (recordedSource) return hold(recordedSource);
    return { ok: true, manual: true, record: {
      market_key: marketKey, phone: caller, created_at: new Date(Date.parse(request.createdAt)).toISOString(),
      jobber_request_id: request.id, jobber_client_id: clientId, prior_completed_work: false,
    } };
  } catch (error) {
    return hold(error?.message === 'jobber_account_mismatch' ? 'jobber_account_mismatch'
      : error?.message === 'jobber_history_incomplete' ? 'jobber_history_incomplete' : 'jobber_read_unavailable');
  }
}

/** A Quo call can link to a manual Request without rewriting its permanent call identity. */
export async function persistManualCallLink(db, { accountId, marketKey, quoCall, record, at = new Date().toISOString() }) {
  const market = MARKET_NAMES[marketKey];
  const row = await db.prepare('SELECT market,caller_phone,destination_number,direction,jobber_request_id,jobber_client_id FROM quo_call_attributions WHERE account_id=? AND quo_call_id=?')
    .bind(accountId, quoCall.quo_call_id).first();
  if (!row || row.market !== market || row.direction !== 'incoming' || row.destination_number !== MARKET_LINES[marketKey]
    || row.destination_number !== quoCall.destination_number || normalizePhone(row.caller_phone) !== normalizePhone(quoCall.caller_phone)
    || (row.jobber_request_id && row.jobber_request_id !== record.jobber_request_id)
    || (row.jobber_client_id && row.jobber_client_id !== record.jobber_client_id)) return hold('quo_call_link_conflict');
  const write = await db.prepare(`UPDATE quo_call_attributions SET
    jobber_request_id=COALESCE(jobber_request_id,?),jobber_client_id=COALESCE(jobber_client_id,?),updated_at=?
    WHERE account_id=? AND quo_call_id=? AND (jobber_request_id IS NULL OR jobber_request_id=?)
      AND (jobber_client_id IS NULL OR jobber_client_id=?)`)
    .bind(record.jobber_request_id, record.jobber_client_id, at, accountId, quoCall.quo_call_id,
      record.jobber_request_id, record.jobber_client_id).run();
  if (write?.success === false) return hold('quo_call_link_write_failed');
  const linked = await db.prepare('SELECT jobber_request_id,jobber_client_id FROM quo_call_attributions WHERE account_id=? AND quo_call_id=?')
    .bind(accountId, quoCall.quo_call_id).first();
  return linked?.jobber_request_id === record.jobber_request_id && linked?.jobber_client_id === record.jobber_client_id
    ? { ok: true } : hold('quo_call_link_conflict');
}

/** One Request can produce at most one qualified-phone conversion, even with several distinct calls. */
export async function claimQualifiedPhoneRequest(db, { marketKey, requestId, googleResource, quoCallId, manual = false,
  at = new Date().toISOString() }) {
  await db.prepare(`INSERT OR IGNORE INTO qualified_phone_request_claims
    (market_key,jobber_request_id,google_resource,quo_call_id,match_origin,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(marketKey, requestId, googleResource, quoCallId, manual ? 'manual' : 'prelinked', at, at).run();
  const claim = await db.prepare('SELECT google_resource,quo_call_id,match_origin FROM qualified_phone_request_claims WHERE market_key=? AND jobber_request_id=?')
    .bind(marketKey, requestId).first();
  return claim?.google_resource === googleResource && claim?.quo_call_id === quoCallId
    ? { ok: true, match_origin: claim.match_origin } : hold('request_already_claimed_by_call');
}
