import { canonicalJobberId } from './acknowledgement-source.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

const MARKET_FROM_QUO = { utah: 'ut', stl: 'mo_stl' };
const HELD_RECHECK_MS = 60 * 60 * 1000;
const id = (value, type) => canonicalJobberId(value, type);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const held = reason => ({ status: 'held', reason, events: [] });

/** Resolve the Request actually used by a Stage 3c Request/Quote/Job observation. */
export function operationalRequestId(type, object) {
  if (type === 'request') return id(object?.id, 'Request');
  if (type === 'quote') return id(object?.request?.id, 'Request');
  if (type !== 'job') return null;
  const jobRequest = id(object?.request?.id, 'Request');
  const quoteRequest = id(object?.quote?.request?.id, 'Request');
  if ((object?.request?.id && !jobRequest) || (object?.quote?.request?.id && !quoteRequest)) return null;
  if (object?.quote && (!quoteRequest || id(object.quote.client?.id, 'Client') !== objectClientId(object))) return null;
  if (jobRequest && quoteRequest && jobRequest !== quoteRequest) return null;
  return jobRequest || quoteRequest;
}

function objectClientId(object) { return id(object?.client?.id, 'Client'); }
function requestProof(result, accountId, requestId, clientId) {
  return id(result?.account?.id, 'Account') === accountId
    && id(result?.request?.id, 'Request') === requestId
    && id(result?.request?.client?.id, 'Client') === clientId;
}

function validOrigin(call, { accountId, marketKey, clientId, originalRequestId }) {
  return call?.account_id === accountId && MARKET_FROM_QUO[call.market] === marketKey
    && id(call.jobber_client_id, 'Client') === clientId
    && id(call.jobber_request_id, 'Request') === originalRequestId
    && typeof call.quo_call_id === 'string' && call.quo_call_id.length > 0
    && call.direction === 'incoming' && Boolean(time(call.call_started_at_utc));
}

async function sourceHash(type, object, firstScheduledAt) {
  const bytes = new TextEncoder().encode(JSON.stringify({ type, object, firstScheduledAt: firstScheduledAt || null }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function lineageVersion(database, accountId, requestId) {
  const [direct, linked] = await Promise.all([
    rows(database, `SELECT quo_call_id FROM quo_call_attributions
      WHERE account_id = ? AND jobber_request_id = ?`, accountId, requestId),
    rows(database, `SELECT decision_id,revision FROM call_request_lineage_active_links
      WHERE account_id = ? AND operational_request_id = ?`, accountId, requestId),
  ]);
  return { direct_call_count: direct.length,
    direct_max_call_id: direct.map(row => row.quo_call_id).sort().at(-1) || null,
    link_decision_id: linked.map(row => row.decision_id).sort().at(-1) || null,
    link_revision: linked.length === 1 ? linked[0].revision : null };
}

function sameCheckpoint(check, current, sourceHashValue) {
  return check?.source_hash === sourceHashValue
    && check.operational_request_id === current.operational_request_id
    && check.account_id === current.account_id
    && check.link_decision_id === current.link_decision_id
    && check.link_revision === current.link_revision
    && Number(check.direct_call_count) === current.direct_call_count
    && check.direct_max_call_id === current.direct_max_call_id;
}

async function writeCheckpoint(database, current, status, reason, eventCount) {
  await database.prepare(`INSERT INTO call_origin_shadow_object_checks (
    market_key,object_type,object_id,operational_request_id,account_id,source_hash,
    source_updated_at,first_scheduled_at,link_decision_id,link_revision,direct_call_count,
    direct_max_call_id,check_status,diagnostic_code,event_count,checked_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(market_key,object_type,object_id) DO UPDATE SET
    operational_request_id=excluded.operational_request_id,account_id=excluded.account_id,
    source_hash=excluded.source_hash,source_updated_at=excluded.source_updated_at,
    first_scheduled_at=excluded.first_scheduled_at,link_decision_id=excluded.link_decision_id,
    link_revision=excluded.link_revision,
    direct_call_count=excluded.direct_call_count,direct_max_call_id=excluded.direct_max_call_id,
    check_status=excluded.check_status,diagnostic_code=excluded.diagnostic_code,
    event_count=excluded.event_count,checked_at=excluded.checked_at`)
    .bind(current.market_key,current.object_type,current.object_id,current.operational_request_id,
      current.account_id,current.source_hash,current.source_updated_at,current.first_scheduled_at,
      current.link_decision_id,current.link_revision,current.direct_call_count,current.direct_max_call_id,status,
      reason,eventCount,new Date().toISOString()).run();
}

/**
 * readRequest is an injected read-only Jobber query returning
 * {account:{id}, request:{id, client:{id}}}; it must not use cached phone/name matches.
 */
export async function resolveCallOrigin({ database, marketKey, accountId, type, object, readRequest }) {
  const route = getJobberOAuthRoute(marketKey, 'website');
  if (!route || !['ut', 'mo_stl'].includes(marketKey)
    || id(accountId, 'Account') !== route.expectedAccountId) return held('jobber_account_unverified');
  const requestId = operationalRequestId(type, object);
  if (!requestId) return held('operational_request_relationship_missing_or_conflicting');
  const clientId = objectClientId(object);
  if (!clientId) return held('jobber_object_client_missing');
  if (typeof readRequest !== 'function' || !database?.prepare) return held('authoritative_read_unavailable');

  let current;
  try { current = await readRequest(requestId); }
  catch { return held('operational_request_read_failed'); }
  if (!requestProof(current, route.expectedAccountId, requestId, clientId)) {
    return held('operational_request_account_or_client_conflict');
  }

  let direct, linked;
  try {
    [direct, linked] = await Promise.all([
      rows(database, 'SELECT * FROM quo_call_attributions WHERE account_id = ? AND jobber_request_id = ?', accountId, requestId),
      rows(database, 'SELECT * FROM call_request_lineage_active_links WHERE account_id = ? AND operational_request_id = ?', accountId, requestId),
    ]);
  } catch { return held('call_lineage_read_failed'); }
  if (direct.length > 1 || linked.length > 1
    || (direct.length && linked.length && direct[0].quo_call_id !== linked[0].quo_call_id)) {
    return held('multiple_call_origins_for_request');
  }
  if (!direct.length && !linked.length) return { status: 'not_call_origin', reason: null, events: [] };

  const link = linked[0] || null;
  let call = direct[0] || null;
  if (link) {
    if (link.account_id !== accountId || link.market_key !== marketKey
      || id(link.operational_request_id, 'Request') !== requestId
      || id(link.client_id, 'Client') !== clientId) return held('verified_lineage_identity_conflict');
    let sourceRows;
    try {
      sourceRows = await rows(database, 'SELECT * FROM quo_call_attributions WHERE account_id = ? AND quo_call_id = ?', accountId, link.quo_call_id);
    } catch { return held('call_lineage_read_failed'); }
    if (sourceRows.length !== 1) return held('original_call_missing_or_ambiguous');
    call = sourceRows[0];
    if (!validOrigin(call, { accountId, marketKey, clientId, originalRequestId: link.original_request_id })
      || time(call.call_started_at_utc) !== time(link.call_started_at_utc)) return held('verified_lineage_source_conflict');
    if (link.original_request_id !== requestId) {
      let original;
      try { original = await readRequest(link.original_request_id); }
      catch { return held('original_request_read_failed'); }
      if (!requestProof(original, route.expectedAccountId, link.original_request_id, clientId)) {
        return held('original_request_account_or_client_conflict');
      }
    }
  } else if (!validOrigin(call, { accountId, marketKey, clientId, originalRequestId: requestId })) {
    return held('original_call_identity_conflict');
  } else {
    // The immutable Quo source still points to the first Request after staff move the work.
    const active = await rows(database, `SELECT operational_request_id FROM call_request_lineage_active_links
      WHERE account_id = ? AND quo_call_id = ?`, accountId, call.quo_call_id);
    if (active.length > 1 || active.length === 1 && active[0].operational_request_id !== requestId) {
      return held('call_origin_active_on_other_request');
    }
  }
  return { status: 'resolved', reason: null, account_id: accountId, market_key: marketKey,
    quo_call_id: call.quo_call_id, original_request_id: call.jobber_request_id,
    operational_request_id: requestId, client_id: clientId,
    call_started_at_utc: time(call.call_started_at_utc),
    evidence_kind: link ? 'verified_lineage' : 'original_request',
    link_decision_id: link?.decision_id || null, link_revision: link?.revision ?? null, events: [] };
}

function event(base, name, objectId, occurredAt, type, object, fields = {}) {
  if (Date.parse(occurredAt) < Date.parse(base.call_started_at_utc) - 120_000) return null;
  return {
    event_id: `call-origin:${base.account_id}:${base.quo_call_id}:${base.link_decision_id || 'direct'}:${base.operational_request_id}:${name}:${objectId}`,
    account_id: base.account_id, market_key: base.market_key, quo_call_id: base.quo_call_id,
    original_request_id: base.original_request_id,
    operational_request_id: base.operational_request_id, client_id: base.client_id,
    call_started_at_utc: base.call_started_at_utc,
    evidence_kind: base.evidence_kind, link_decision_id: base.link_decision_id,
    event_name: name,
    source_object_type: type, source_object_id: object.id, occurred_at: occurredAt,
    assessment_id: fields.assessment_id || null,
    quote_id: fields.quote_id || null, job_id: fields.job_id || null,
  };
}

/** No click IDs, values, or Google action IDs are manufactured in this ledger. */
export function deriveCallOriginShadowEvents(base, type, object, firstScheduledAt) {
  if (base?.status !== 'resolved') return [];
  const output = [];
  if (type === 'request') {
    const assessment = object.assessment;
    if (assessment?.id && assessment.startAt && assessment.endAt) {
      const scheduledAt = time(firstScheduledAt);
      if (scheduledAt) output.push(event(base, 'appointment_set', object.id, scheduledAt, type, object,
        { assessment_id: assessment.id }));
    }
    if (assessment?.id && assessment.isComplete === true) {
      const completedAt = time(assessment.completedAt);
      if (completedAt) output.push(event(base, 'assessment_completed', object.id, completedAt, type, object,
        { assessment_id: assessment.id }));
    }
  }
  const quote = type === 'quote' ? object : type === 'job' ? object.quote : null;
  if (quote?.id) {
    const approvedAt = time(quote.lastTransitioned?.approvedAt);
    if (approvedAt) output.push(event(base, 'quote_approved', quote.id, approvedAt, type, object,
      { quote_id: quote.id, job_id: type === 'job' ? object.id : null }));
  }
  if (type === 'job' && quote?.id) {
    const createdAt = time(object.createdAt);
    if (createdAt) output.push(event(base, 'job_created', object.id, createdAt, type, object,
      { quote_id: quote.id, job_id: object.id }));
  }
  return output.filter(Boolean);
}

/** Read-only Jobber/Quo inputs; writes only the separate D1 shadow ledger. */
export async function observeCallOriginShadow({ database, marketKey, accountId, type, object, readRequest, firstScheduledAt }) {
  const route = getJobberOAuthRoute(marketKey, 'website');
  if (!route || !['ut', 'mo_stl'].includes(marketKey)
    || id(accountId, 'Account') !== route.expectedAccountId) return held('jobber_account_unverified');
  const requestId = operationalRequestId(type, object);
  if (!requestId || !object?.id || !database?.prepare) return held('operational_request_relationship_missing_or_conflicting');
  const version = await lineageVersion(database, accountId, requestId);
  if (!version.direct_call_count && !version.link_decision_id) return { status: 'not_call_origin', reason: null, events: [] };
  const current = { market_key: marketKey, object_type: type, object_id: object.id,
    operational_request_id: requestId, account_id: accountId,
    source_hash: await sourceHash(type, object, firstScheduledAt),
    source_updated_at: typeof object.updatedAt === 'string' ? object.updatedAt : null,
    first_scheduled_at: firstScheduledAt || null, ...version };
  const prior = await database.prepare(`SELECT * FROM call_origin_shadow_object_checks
    WHERE market_key = ? AND object_type = ? AND object_id = ?`)
    .bind(marketKey, type, object.id).first();
  if (sameCheckpoint(prior, current, current.source_hash)
    && (prior.check_status === 'resolved'
      || prior.check_status === 'held' && Date.now() - Date.parse(prior.checked_at) < HELD_RECHECK_MS)) {
    return { status: 'skipped', reason: 'shadow_object_unchanged', events: [] };
  }
  const resolved = await resolveCallOrigin({ database, marketKey, accountId, type, object, readRequest });
  if (resolved.status !== 'resolved') {
    await writeCheckpoint(database, current, 'held', resolved.reason || 'call_origin_unresolved', 0);
    return resolved;
  }
  const events = deriveCallOriginShadowEvents(resolved, type, object, firstScheduledAt);
  let inserted = 0;
  for (const row of events) {
    const fields = Object.keys(row);
    const result = await database.prepare(`INSERT OR IGNORE INTO call_origin_shadow_events
      (${fields.join(', ')}, observed_at) VALUES (${fields.map(() => '?').join(', ')}, ?)`)
      .bind(...fields.map(field => row[field]), new Date().toISOString()).run();
    inserted += Number(result?.meta?.changes ?? result?.changes ?? 0);
  }
  await writeCheckpoint(database, current, 'resolved', null, events.length);
  return { ...resolved, events, inserted };
}
