import { _private as leads } from '../functions/api/leads.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';
import { canonicalJobberId, sourceHash } from './acknowledgement-source.js';
import { resolveCallOrigin } from './call-origin-stage3c-shadow.js';
import { verifyJobberWebhookSignature } from './jobber-appointment-webhook.js';
import { observeInvoiceLineageShadow, readJobberInvoiceLineage } from './invoice-lineage-shadow.js';

export const INVOICE_LINEAGE_SHADOW_FLAG = 'INVOICE_LINEAGE_SHADOW_ENABLED';
export const INVOICE_TOPICS = new Set(['INVOICE_CREATE', 'INVOICE_UPDATE']);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_CYCLE = 20;
const MAX_INVOICES_PER_CYCLE = 5;
const MAX_LINK_REPLAYS_PER_CYCLE = 5;
const MAX_JOBS_PER_CYCLE = 3;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const JOBBER_API_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_GRAPHQL_VERSION = '2025-04-16';
const REQUEST_PROOF_QUERY = `query InvoiceLineageRequestProof($id: EncodedId!) {
  account { id } request(id: $id) { id client { id } }
}`;
const JOB_INVOICES_QUERY = `query InvoiceLineageJobInvoices($id: EncodedId!) {
  account { id }
  job(id: $id) {
    id client { id } request { id client { id } }
    quote { id client { id } request { id client { id } } }
    invoices(first: 50) { nodes { id } pageInfo { hasNextPage endCursor } }
  }
}`;
const routeByAccount = new Map(['ut', 'mo_stl'].map(market => {
  const route = getJobberOAuthRoute(market, 'website');
  return [route.expectedAccountId, route];
}));
const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
const resultRows = result => result?.results || [];
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const all = async (db, sql, ...args) => resultRows(await db.prepare(sql).bind(...args).all());

function parsedWebhook(raw) {
  let event;
  try { event = JSON.parse(raw)?.data?.webHookEvent; }
  catch { return { ok: false, status: 400, code: 'invalid_json' }; }
  const topic = typeof event?.topic === 'string' ? event.topic.trim().toUpperCase() : '';
  if (!INVOICE_TOPICS.has(topic)) return { ok: false, status: 202, code: 'unsupported_topic' };
  const accountId = canonicalJobberId(event?.accountId, 'Account');
  const invoiceId = canonicalJobberId(event?.itemId, 'Invoice');
  const occurredAt = iso(event?.occurredAt || event?.occuredAt);
  if (!accountId || !invoiceId || !occurredAt) return { ok: false, status: 400, code: 'invalid_event_identity' };
  const route = routeByAccount.get(accountId);
  if (!route) return { ok: false, status: 202, code: 'account_not_enabled' };
  return { ok: true, accountId, invoiceId, occurredAt,
    marketKey: route.marketKey, topic };
}

/** Signed ingress stores only the invoice ID; Jobber is queried on the cron. */
export async function handleInvoiceLineageWebhook({ request, env, clock = () => Date.now() }) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ ok: false, code: 'payload_too_large' }, 413);
  }
  let rawAccountId = '';
  try { rawAccountId = JSON.parse(raw)?.data?.webHookEvent?.accountId || ''; }
  catch { /* Verify before reporting invalid JSON. */ }
  const route = routeByAccount.get(rawAccountId);
  const secrets = [...new Set([route && env?.[route.clientSecretEnvKey], env?.JOBBER_CLIENT_SECRET]
    .filter(secret => typeof secret === 'string' && secret.length > 0))];
  const signed = (await Promise.all(secrets.map(secret => verifyJobberWebhookSignature(
    raw, request.headers.get('X-Jobber-Hmac-SHA256'), secret,
  )))).some(Boolean);
  if (!signed) return json({ ok: false, code: 'invalid_signature' }, 401);
  const event = parsedWebhook(raw);
  if (!event.ok) return json({ ok: event.status === 202, accepted: false, code: event.code }, event.status);
  if (env?.[INVOICE_LINEAGE_SHADOW_FLAG] !== 'true') {
    return json({ ok: true, accepted: false, mode: 'disabled' }, 202);
  }
  if (!env?.ANGI_ROUTER_DB?.prepare) return json({ ok: false, code: 'shadow_database_unavailable' }, 503);
  const receivedAt = new Date(clock()).toISOString();
  const eventKey = await sourceHash([event.accountId, event.topic, event.invoiceId, event.occurredAt].join(':'));
  try {
    await run(env.ANGI_ROUTER_DB, `INSERT OR IGNORE INTO invoice_lineage_webhook_inbox
      (event_key, account_id, market_key, topic, invoice_id, occurred_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, eventKey, event.accountId, event.marketKey,
    event.topic, event.invoiceId, event.occurredAt, receivedAt);
    return json({ ok: true, accepted: true, mode: 'shadow' }, 202);
  } catch {
    return json({ ok: false, code: 'invoice_shadow_enqueue_failed' }, 503);
  }
}

function tokenProvider(env) {
  const cached = new Map();
  return async marketKey => {
    if (!cached.has(marketKey)) {
      const route = getJobberOAuthRoute(marketKey, 'website');
      if (!route || !['ut', 'mo_stl'].includes(marketKey)) throw new Error('invoice_market_invalid');
      const { accessToken } = await leads.refreshJobberAccessToken(env, route);
      cached.set(marketKey, accessToken);
    }
    return cached.get(marketKey);
  };
}

async function readRequestProof({ marketKey, requestId, tokenForMarket, fetchImpl }) {
  const token = await tokenForMarket(marketKey);
  const response = await fetchImpl(JOBBER_API_URL, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_GRAPHQL_VERSION },
    body: JSON.stringify({ query: REQUEST_PROOF_QUERY, variables: { id: requestId } }),
  });
  if (!response.ok) throw new Error('jobber_request_proof_read_failed');
  const body = await response.json();
  if (body?.errors?.length || !body?.data) throw new Error('jobber_request_proof_graphql_failed');
  return body.data;
}

/** Read-only Jobber Job lookup for an already observed, exact call-origin Job. */
export async function readJobberJobInvoiceIds({ marketKey, jobId, tokenForMarket,
  fetchImpl = globalThis.fetch } = {}) {
  if (!canonicalJobberId(jobId, 'Job') || typeof tokenForMarket !== 'function') {
    throw new Error('invoice_discovery_job_invalid');
  }
  const token = await tokenForMarket(marketKey);
  const response = await fetchImpl(JOBBER_API_URL, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_GRAPHQL_VERSION },
    body: JSON.stringify({ query: JOB_INVOICES_QUERY, variables: { id: jobId } }),
  });
  if (!response.ok) throw new Error('invoice_discovery_job_read_failed');
  const body = await response.json();
  if (body?.errors?.length || !body?.data) throw new Error('invoice_discovery_job_graphql_failed');
  return body.data;
}

/** No invoice IDs are accepted from a partial page or conflicting Job graph. */
export function deriveDiscoveredInvoiceIds(candidate, data) {
  const id = canonicalJobberId;
  const job = data?.job;
  if (id(data?.account?.id, 'Account') !== candidate.account_id
    || id(job?.id, 'Job') !== candidate.job_id) return { held: 'job_account_or_id_conflict' };
  if (id(job?.client?.id, 'Client') !== candidate.client_id
    || job?.quote && id(job.quote.client?.id, 'Client') !== candidate.client_id) {
    return { held: 'job_client_conflict' };
  }
  const requestIds = [job?.request?.id, job?.quote?.request?.id]
    .filter(value => value !== null && value !== undefined);
  if (!requestIds.length || requestIds.some(value => id(value, 'Request') !== candidate.request_id)) {
    return { held: 'job_request_conflict_or_missing' };
  }
  const requestClients = [job?.request?.client?.id, job?.quote?.request?.client?.id]
    .filter(value => value !== null && value !== undefined);
  if (!requestClients.length || requestClients.some(value => id(value, 'Client') !== candidate.client_id)) {
    return { held: 'job_request_client_conflict_or_missing' };
  }
  const connection = job?.invoices;
  if (!Array.isArray(connection?.nodes) || !connection.pageInfo
    || typeof connection.pageInfo.hasNextPage !== 'boolean') {
    return { held: 'job_invoice_connection_incomplete' };
  }
  if (connection.pageInfo.hasNextPage) return { held: 'job_invoice_connection_paginated' };
  const invoices = new Set();
  for (const row of connection.nodes) {
    const invoiceId = id(row?.id, 'Invoice');
    if (!invoiceId) return { held: 'job_invoice_id_invalid' };
    invoices.add(invoiceId);
  }
  return { invoiceIds: [...invoices] };
}

const accountByMarket = Object.fromEntries(['ut', 'mo_stl'].map(market =>
  [market, getJobberOAuthRoute(market, 'website').expectedAccountId]));

async function callOriginJobsAfter(db, cursorKey) {
  return all(db, `SELECT o.market_key, o.object_id AS job_id,
      o.request_id, o.client_id
    FROM closed_loop_stage1_objects o
    WHERE o.object_type = 'job' AND o.market_key IN ('ut', 'mo_stl')
      AND o.request_id IS NOT NULL AND o.client_id IS NOT NULL
      AND (o.market_key || ':' || o.object_id) > ?
      AND (EXISTS (
        SELECT 1 FROM call_request_lineage_active_links l
        WHERE l.market_key = o.market_key
          AND l.account_id = CASE o.market_key WHEN 'ut' THEN ? ELSE ? END
          AND l.operational_request_id = o.request_id AND l.client_id = o.client_id
      ) OR EXISTS (
        SELECT 1 FROM quo_call_attributions q
        WHERE q.account_id = CASE o.market_key WHEN 'ut' THEN ? ELSE ? END
          AND q.market = CASE o.market_key WHEN 'ut' THEN 'utah' ELSE 'stl' END
          AND q.jobber_request_id = o.request_id AND q.jobber_client_id = o.client_id
          AND NOT EXISTS (
            SELECT 1 FROM call_request_lineage_active_links l
            WHERE l.account_id = q.account_id AND l.quo_call_id = q.quo_call_id
              AND l.operational_request_id <> o.request_id
          )
      ))
    ORDER BY o.market_key, o.object_id LIMIT ?`, cursorKey,
  accountByMarket.ut, accountByMarket.mo_stl,
  accountByMarket.ut, accountByMarket.mo_stl, MAX_JOBS_PER_CYCLE);
}

async function discoverInvoices(db, at, { readJob, tokenForMarket, fetchImpl }) {
  const checkpoint = await db.prepare('SELECT job_key FROM invoice_lineage_discovery_cursor WHERE id = 1').first();
  let jobs = await callOriginJobsAfter(db, checkpoint?.job_key || '');
  if (!jobs.length && checkpoint?.job_key) jobs = await callOriginJobsAfter(db, '');
  const stats = { jobs: 0, held: 0, invoices: 0 };
  for (const row of jobs) {
    const candidate = { ...row, account_id: accountByMarket[row.market_key] };
    const jobKey = `${row.market_key}:${row.job_id}`;
    let result;
    try {
      const data = await (readJob
        ? readJob(row.market_key, row.job_id)
        : readJobberJobInvoiceIds({ marketKey: row.market_key, jobId: row.job_id,
          tokenForMarket, fetchImpl }));
      result = deriveDiscoveredInvoiceIds(candidate, data);
    } catch { result = { held: 'job_invoice_discovery_read_failed' }; }
    await run(db, `INSERT INTO invoice_lineage_job_discovery
      (account_id, market_key, job_id, request_id, client_id, status,
        diagnostic_code, invoice_count, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, job_id) DO UPDATE SET
        request_id=excluded.request_id, client_id=excluded.client_id,
        status=excluded.status, diagnostic_code=excluded.diagnostic_code,
        invoice_count=excluded.invoice_count, checked_at=excluded.checked_at`,
    candidate.account_id, row.market_key, row.job_id, row.request_id, row.client_id,
    result.held ? 'held' : 'checked', result.held || null,
    result.invoiceIds?.length || 0, at);
    if (result.held) stats.held++;
    else for (const invoiceId of result.invoiceIds) {
      const queued = await run(db, `INSERT INTO invoice_lineage_webhook_inbox
        (event_key, account_id, market_key, topic, invoice_id, occurred_at, received_at)
        VALUES (?, ?, ?, 'JOB_DISCOVERY', ?, ?, ?)
        ON CONFLICT(event_key) DO UPDATE SET state='pending',
          occurred_at=excluded.occurred_at, received_at=excluded.received_at,
          attempts=0, next_retry_at=NULL, last_error=NULL, processed_at=NULL
        WHERE invoice_lineage_webhook_inbox.state='done'
          AND invoice_lineage_webhook_inbox.received_at < excluded.received_at`,
      `discovery:${candidate.account_id}:${invoiceId}:${jobKey}`,
      candidate.account_id, row.market_key, invoiceId, at, at);
      stats.invoices += changes(queued);
    }
    await run(db, `INSERT INTO invoice_lineage_discovery_cursor (id, job_key, updated_at)
      VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET
        job_key=excluded.job_key, updated_at=excluded.updated_at`, jobKey, at);
    stats.jobs++;
  }
  return stats;
}

function retryableHold(row) {
  const transient = new Set(['job_missing', 'request_missing', 'job_connection_incomplete',
    'invoice_total_missing_or_invalid', 'payments_total_missing_or_invalid',
    'invoice_balance_missing_or_invalid']);
  return (row.lineage_status === 'held' && row.hold_reasons.some(reason => transient.has(reason)))
    || (row.call_origin_status === 'held' && ['operational_request_read_failed',
      'original_request_read_failed', 'call_lineage_read_failed', 'call_origin_verification_failed']
      .includes(row.call_origin_hold_reason));
}

async function finishEvents(db, events, state, at, errorCode = null) {
  for (const event of events) {
    const attempts = Number(event.attempts) + 1;
    const finalState = state === 'retryable' && attempts >= MAX_ATTEMPTS ? 'manual_review' : state;
    await run(db, `UPDATE invoice_lineage_webhook_inbox SET state = ?, next_retry_at = ?,
      last_error = ?, processed_at = ?, claimed_at = NULL WHERE event_key = ?
      AND state = 'processing' AND claimed_at = ?`, finalState,
    finalState === 'retryable' ? new Date(Date.parse(at) + RETRY_DELAY_MS).toISOString() : null,
    errorCode, finalState === 'done' ? at : null, event.event_key, at);
  }
}

// A newly verified or superseded exact Request link can follow an earlier
// invoice observation. Queue one replay per immutable decision ID. The active
// link view prevents stale decisions from creating new replay work.
async function enqueueActiveLinkReplays(db, at) {
  return run(db, `INSERT OR IGNORE INTO invoice_lineage_webhook_inbox
    (event_key, account_id, market_key, topic, invoice_id, occurred_at, received_at)
    SELECT 'lineage:' || i.account_id || ':' || i.invoice_id || ':' || l.decision_id,
      i.account_id, i.market_key, 'LINEAGE_REPLAY', i.invoice_id, l.verified_at, ?
    FROM invoice_lineage_shadow i
    JOIN call_request_lineage_active_links l
      ON l.account_id = i.account_id
      AND l.market_key = i.market_key
      AND l.operational_request_id = i.operational_request_id
      AND l.client_id = i.invoice_client_id
    WHERE i.lineage_status = 'resolved'
      AND NOT EXISTS (SELECT 1 FROM invoice_lineage_webhook_inbox queued
        WHERE queued.event_key = 'lineage:' || i.account_id || ':' || i.invoice_id || ':' || l.decision_id)
      AND (i.call_origin_status <> 'resolved'
        OR i.call_origin_evidence_kind <> 'verified_lineage'
        OR i.link_decision_id IS NOT l.decision_id
        OR i.link_revision IS NOT l.revision)
    ORDER BY l.verified_at LIMIT ?`, at, MAX_LINK_REPLAYS_PER_CYCLE);
}

/** Bounded five-minute-cycle drain; only Jobber queries and D1 shadow writes. */
export async function invoiceLineageShadowCycle(env, {
  clock = () => Date.now(), readInvoice, readRequest, readJob,
  resolveOrigin = resolveCallOrigin,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env?.[INVOICE_LINEAGE_SHADOW_FLAG] !== 'true') return { disabled: true };
  const db = env?.ANGI_ROUTER_DB;
  if (!db?.prepare) return { failed: true, diagnostic_code: 'shadow_database_unavailable' };
  const at = new Date(clock()).toISOString();
  const stale = new Date(Date.parse(at) - CLAIM_LEASE_MS).toISOString();
  const tokenForMarket = tokenProvider(env);
  const discovery = await discoverInvoices(db, at, { readJob, tokenForMarket, fetchImpl });
  await enqueueActiveLinkReplays(db, at);
  const due = await all(db, `SELECT * FROM invoice_lineage_webhook_inbox
    WHERE state = 'pending' OR (state = 'retryable' AND next_retry_at <= ?)
      OR (state = 'processing' AND claimed_at <= ?)
    ORDER BY received_at LIMIT ?`, at, stale, MAX_EVENTS_PER_CYCLE);
  const grouped = new Map();
  for (const row of due) {
    const key = `${row.account_id}:${row.invoice_id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const readInvoiceSnapshot = readInvoice || ((marketKey, invoiceId) =>
    readJobberInvoiceLineage({ marketKey, invoiceId, tokenForMarket, fetchImpl }));
  const readRequestSnapshot = readRequest || ((marketKey, requestId) =>
    readRequestProof({ marketKey, requestId, tokenForMarket, fetchImpl }));
  const stats = { mode: 'shadow', invoices: 0, events: 0, resolved: 0, held: 0,
    retried: 0, manual_review: 0, discovery };
  for (const events of [...grouped.values()].slice(0, MAX_INVOICES_PER_CYCLE)) {
    const claimed = [];
    for (const event of events) {
      const result = await run(db, `UPDATE invoice_lineage_webhook_inbox
        SET state = 'processing', claimed_at = ?, attempts = attempts + 1
        WHERE event_key = ? AND (state = 'pending'
          OR (state = 'retryable' AND next_retry_at <= ?)
          OR (state = 'processing' AND claimed_at <= ?))`,
      at, event.event_key, at, stale);
      if (changes(result) === 1) claimed.push(event);
    }
    if (!claimed.length) continue;
    const event = claimed[0];
    stats.invoices++;
    stats.events += claimed.length;
    try {
      const data = await readInvoiceSnapshot(event.market_key, event.invoice_id);
      const observation = await observeInvoiceLineageShadow({ database: db,
        marketKey: event.market_key, accountId: event.account_id, invoiceId: event.invoice_id,
        readInvoice: async () => data,
        resolveCallOrigin: input => resolveOrigin({ ...input,
          readRequest: requestId => readRequestSnapshot(event.market_key, requestId) }),
        observedAt: at });
      if (observation.lineage_status === 'resolved') stats.resolved++;
      else stats.held++;
      const transient = retryableHold(observation);
      const state = transient ? 'retryable'
        : observation.lineage_status === 'held' || observation.call_origin_status === 'held'
          ? 'manual_review' : 'done';
      const reason = observation.hold_reasons?.[0] || observation.call_origin_hold_reason || null;
      await finishEvents(db, claimed, state, at, reason);
      if (state === 'retryable') stats.retried++;
      if (state === 'manual_review') stats.manual_review++;
    } catch {
      await finishEvents(db, claimed, 'retryable', at, 'invoice_shadow_observation_failed');
      stats.retried++;
    }
  }
  return stats;
}

export async function invoiceLineageShadowHealth(env) {
  if (env?.[INVOICE_LINEAGE_SHADOW_FLAG] !== 'true') return { enabled: false };
  try {
    const inbox = await all(env.ANGI_ROUTER_DB,
      'SELECT state, count(*) AS count FROM invoice_lineage_webhook_inbox GROUP BY state');
    const ledger = await all(env.ANGI_ROUTER_DB,
      'SELECT lineage_status, call_origin_status, count(*) AS count FROM invoice_lineage_shadow GROUP BY lineage_status, call_origin_status');
    const discovery = await all(env.ANGI_ROUTER_DB,
      'SELECT status, count(*) AS count FROM invoice_lineage_job_discovery GROUP BY status');
    const currentCalls = await env.ANGI_ROUTER_DB.prepare(
      'SELECT count(*) AS count FROM invoice_lineage_shadow_current_calls').first();
    return { enabled: true, inbox, ledger, discovery, current_calls: currentCalls?.count || 0 };
  } catch { return { enabled: true, error: 'invoice_shadow_schema_unavailable' }; }
}
