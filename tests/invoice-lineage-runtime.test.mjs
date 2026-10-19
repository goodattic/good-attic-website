import test from 'node:test';
const CALL = 'AC' + '1'.padStart(32, '0');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import {
  handleInvoiceLineageWebhook, invoiceLineageShadowCycle,
  invoiceLineageShadowHealth, deriveDiscoveredInvoiceIds,
  readJobberJobInvoiceIds,
} from '../server/invoice-lineage-runtime.js';
import { observeInvoiceLineageShadow } from '../server/invoice-lineage-shadow.js';

registerHooks({ load(url, context, next) {
  if (url.endsWith('.sql')) return { format: 'module',
    source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}`,
    shortCircuit: true };
  return next(url, context);
} });

const ACCOUNT = btoa('gid://Jobber/Account/2498432');
const OTHER_ACCOUNT = btoa('gid://Jobber/Account/1919824');
const INVOICE = btoa('gid://Jobber/Invoice/170748133');
const SECOND_INVOICE = btoa('gid://Jobber/Invoice/170748134');
const CLIENT = btoa('gid://Jobber/Client/148362284');
const JOB = btoa('gid://Jobber/Job/154980901');
const QUOTE = btoa('gid://Jobber/Quote/66764742');
const REQUEST = btoa('gid://Jobber/Request/35017723');
const REPLACEMENT_REQUEST = btoa('gid://Jobber/Request/35019999');
const ORIGINAL_REQUEST = btoa('gid://Jobber/Request/35017089');
const SECRET = 'test-jobber-webhook-secret';
const fixed = () => Date.parse('2026-10-12T22:00:00Z');
const connection = (nodes = []) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const job = (overrides = {}) => ({ id: JOB, client: { id: CLIENT },
  request: { id: REQUEST, client: { id: CLIENT } },
  quote: { id: QUOTE, client: { id: CLIENT }, request: { id: REQUEST, client: { id: CLIENT } } },
  ...overrides });
const snapshot = (overrides = {}) => ({ account: { id: ACCOUNT },
  invoice: { id: INVOICE, updatedAt: '2026-10-12T21:59:00Z', invoiceStatus: 'UNPAID',
    client: { id: CLIENT }, amounts: { total: 2500, paymentsTotal: 0, invoiceBalance: 2500 },
    jobs: connection([job()]), archivedJobs: connection(), ...overrides } });

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of ['../migrations/0008_quo_call_attributions.sql',
    '../migrations/0010_stage1_shadow.sql',
    '../migrations/0017_call_request_lineage.sql',
    '../migrations/0023_call_request_lineage_supersessions.sql',
    '../migrations/0019_invoice_lineage_shadow.sql',
    '../migrations/0024_invoice_lineage_webhook_inbox.sql']) {
    sqlite.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  const prepare = sql => {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async run() { const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes) } }; } };
  };
  return { sqlite, prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run());
      sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
async function webhook(topic = 'INVOICE_CREATE', changes = {}, secret = SECRET) {
  const payload = JSON.stringify({ data: { webHookEvent: { topic, accountId: ACCOUNT,
    itemId: INVOICE, occurredAt: '2026-10-12T21:59:00Z', ...changes } } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(payload))).toString('base64');
  return new Request('https://test.example/webhooks/jobber/invoice-lineage', {
    method: 'POST', headers: { 'X-Jobber-Hmac-SHA256': signature }, body: payload,
  });
}
const env = db => ({ ANGI_ROUTER_DB: db, INVOICE_LINEAGE_SHADOW_ENABLED: 'true',
  JOBBER_CLIENT_SECRET_SLC: SECRET });

function seedCallAndLink(sqlite) {
  const callId = CALL;
  const at = '2026-10-12T19:45:45Z';
  sqlite.prepare(`INSERT INTO quo_call_attributions
    (attribution_id, account_id, market, phone_number_id, quo_call_id, caller_phone,
    call_started_at_original, call_started_at_utc, destination_number, direction,
    final_status, jobber_request_id, jobber_client_id, source_event_id, created_at, updated_at)
    VALUES (?, ?, 'utah', 'phone-id', ?, '+16142166149', ?, ?, '+13853364442',
      'incoming', 'completed', ?, ?, 'source-event', ?, ?)`)
    .run('call-attribution', ACCOUNT, callId, at, at, ORIGINAL_REQUEST, CLIENT, at, at);
  sqlite.prepare(`INSERT INTO call_request_lineage_links
    (account_id, quo_call_id, market_key, original_request_id, operational_request_id,
    client_id, call_started_at_utc, decision_id, verified_by, evidence_ref, verified_at)
    VALUES (?, ?, 'ut', ?, ?, ?, ?, 'decision-1', 'owner', 'review-1', ?)`)
    .run(ACCOUNT, callId, ORIGINAL_REQUEST, REQUEST, CLIENT, at, at);
  return callId;
}

function seedJobSnapshot(sqlite, requestId = REQUEST) {
  sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
    (market_key, object_type, object_id, request_id, client_id, object_json, observed_at)
    VALUES ('ut', 'job', ?, ?, ?, '{}', '2026-10-12T20:00:00Z')`)
    .run(JOB, requestId, CLIENT);
}

const discoveredJob = (invoices = connection([{ id: INVOICE }])) => ({
  account: { id: ACCOUNT }, job: { id: JOB, client: { id: CLIENT },
    request: { id: REQUEST, client: { id: CLIENT } },
    quote: { id: QUOTE, client: { id: CLIENT },
      request: { id: REQUEST, client: { id: CLIENT } } }, invoices },
});

test('Job discovery reads only a versioned query and holds partial invoice pages', async () => {
  let query;
  const result = await readJobberJobInvoiceIds({ marketKey: 'ut', jobId: JOB,
    tokenForMarket: async () => 'test-token', fetchImpl: async (_url, init) => {
      query = JSON.parse(init.body).query;
      assert.equal(init.headers['X-JOBBER-GRAPHQL-VERSION'], '2025-04-16');
      return { ok: true, json: async () => ({ data: discoveredJob() }) };
    } });
  assert.match(query, /^query InvoiceLineageJobInvoices/);
  assert.match(query, /invoices\(first: 50\)/);
  assert.equal(result.job.invoices.nodes[0].id, INVOICE);
  const candidate = { account_id: ACCOUNT, job_id: JOB, request_id: REQUEST, client_id: CLIENT };
  assert.deepEqual(deriveDiscoveredInvoiceIds(candidate, result).invoiceIds, [INVOICE]);
  assert.equal(deriveDiscoveredInvoiceIds(candidate, discoveredJob({
    nodes: [{ id: INVOICE }], pageInfo: { hasNextPage: true, endCursor: 'next' },
  })).held, 'job_invoice_connection_paginated');
  assert.equal(deriveDiscoveredInvoiceIds(candidate, { ...result,
    account: { id: OTHER_ACCOUNT } }).held, 'job_account_or_id_conflict');
});

test('round-robin Job fallback discovers an invoice and refreshes payment totals', async () => {
  const db = database();
  seedCallAndLink(db.sqlite);
  seedJobSnapshot(db.sqlite);
  let reads = 0;
  let current = snapshot();
  const settings = { readJob: async (market, jobId) => {
    assert.equal(market, 'ut'); assert.equal(jobId, JOB); return discoveredJob(); },
  readInvoice: async () => { reads++; return current; },
  readRequest: async (_market, requestId) => ({ account: { id: ACCOUNT },
    request: { id: requestId, client: { id: CLIENT } } }) };
  const first = await invoiceLineageShadowCycle(env(db), { clock: fixed, ...settings });
  assert.equal(first.discovery.jobs, 1);
  assert.equal(first.discovery.invoices, 1);
  assert.equal(first.invoices, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM invoice_lineage_webhook_inbox WHERE topic='JOB_DISCOVERY'").get().n, 1);
  current = snapshot({ invoiceStatus: 'PAID',
    amounts: { total: 2500, paymentsTotal: 2500, invoiceBalance: 0 },
    updatedAt: '2026-10-12T22:05:00Z' });
  const second = await invoiceLineageShadowCycle(env(db), {
    clock: () => fixed() + 5 * 60000, ...settings });
  assert.equal(second.discovery.jobs, 1);
  assert.equal(second.invoices, 1);
  assert.equal(reads, 2);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM invoice_lineage_webhook_inbox WHERE topic='JOB_DISCOVERY'").get().n, 1);
  const row = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow_current_calls').get();
  assert.equal(row.payments_total_micros, 2500000000);
  assert.equal(row.invoice_balance_micros, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_revisions').get().n, 2);
  assert.equal(db.sqlite.prepare('SELECT job_key FROM invoice_lineage_discovery_cursor').get().job_key,
    `ut:${JOB}`);
});

test('Job fallback records pagination hold and enqueues no partial invoice IDs', async () => {
  const db = database();
  seedCallAndLink(db.sqlite);
  seedJobSnapshot(db.sqlite);
  const result = await invoiceLineageShadowCycle(env(db), { clock: fixed,
    readJob: async () => discoveredJob({ nodes: [{ id: INVOICE }],
      pageInfo: { hasNextPage: true, endCursor: 'next' } }),
    readInvoice: async () => { throw new Error('invoice_should_not_be_read'); } });
  assert.equal(result.discovery.held, 1);
  assert.equal(result.invoices, 0);
  assert.equal(db.sqlite.prepare('SELECT diagnostic_code FROM invoice_lineage_job_discovery').get().diagnostic_code,
    'job_invoice_connection_paginated');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_webhook_inbox').get().n, 0);
});

test('signed invoice webhook enqueues once; unsigned, wrong account, and disabled do not write', async () => {
  const db = database();
  const good = await handleInvoiceLineageWebhook({ request: await webhook(), env: env(db), clock: fixed });
  assert.equal(good.status, 202);
  await handleInvoiceLineageWebhook({ request: await webhook(), env: env(db), clock: fixed });
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_webhook_inbox').get().n, 1);
  const unsigned = await handleInvoiceLineageWebhook({ request: await webhook('INVOICE_UPDATE', {}, 'wrong'),
    env: env(db), clock: fixed });
  assert.equal(unsigned.status, 401);
  const unknown = await handleInvoiceLineageWebhook({ request: await webhook('INVOICE_UPDATE', {
    accountId: btoa('gid://Jobber/Account/777'),
  }), env: { ...env(db), JOBBER_CLIENT_SECRET: SECRET }, clock: fixed });
  assert.equal(unknown.status, 202);
  const disabled = await handleInvoiceLineageWebhook({ request: await webhook('INVOICE_UPDATE'),
    env: { ...env(db), INVOICE_LINEAGE_SHADOW_ENABLED: 'false' }, clock: fixed });
  assert.equal(disabled.status, 202);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_webhook_inbox').get().n, 1);
});

test('one bounded cron read drains duplicate invoice events into exact call-origin shadow', async () => {
  const db = database();
  await handleInvoiceLineageWebhook({ request: await webhook(), env: env(db), clock: fixed });
  await handleInvoiceLineageWebhook({ request: await webhook('INVOICE_UPDATE', {
    occurredAt: '2026-10-12T21:59:01Z',
  }), env: env(db), clock: fixed });
  let reads = 0;
  const result = await invoiceLineageShadowCycle(env(db), { clock: fixed,
    readInvoice: async (market, invoiceId) => { reads++;
      assert.equal(market, 'ut'); assert.equal(invoiceId, INVOICE); return snapshot(); },
    readRequest: async (market, requestId) => ({ account: { id: ACCOUNT },
      request: { id: requestId, client: { id: CLIENT } } }),
    resolveOrigin: async ({ type, object, readRequest }) => {
      assert.equal(type, 'request');
      assert.equal(object.id, REQUEST);
      assert.equal((await readRequest(REQUEST)).request.id, REQUEST);
      return { status: 'resolved', account_id: ACCOUNT, client_id: CLIENT,
        operational_request_id: REQUEST, original_request_id: ORIGINAL_REQUEST,
        quo_call_id: CALL, evidence_kind: 'verified_lineage',
        link_decision_id: 'decision-1', link_revision: 0 };
    } });
  assert.equal(reads, 1);
  assert.equal(result.invoices, 1);
  assert.equal(result.events, 2);
  assert.equal(result.resolved, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM invoice_lineage_webhook_inbox WHERE state='done'").get().n, 2);
  const row = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow').get();
  assert.equal(row.lineage_status, 'resolved');
  assert.equal(row.call_origin_status, 'resolved');
  assert.equal(row.original_request_id, ORIGINAL_REQUEST);
  assert.equal(row.operational_request_id, REQUEST);
  assert.equal(row.invoice_total_micros, 2500000000);
  assert.equal(row.payments_total_micros, 0);
  assert.equal(row.invoice_balance_micros, 2500000000);
  const health = await invoiceLineageShadowHealth(env(db));
  assert.equal(health.enabled, true);
  assert.equal(health.inbox.find(item => item.state === 'done').count, 2);
});

test('new invoice without a Request remains held and retries when Jobber relationship arrives', async () => {
  const db = database();
  await handleInvoiceLineageWebhook({ request: await webhook(), env: env(db), clock: fixed });
  let current = snapshot({ jobs: connection() });
  const settings = { readInvoice: async () => current,
    resolveOrigin: async () => ({ status: 'not_call_origin' }) };
  const first = await invoiceLineageShadowCycle(env(db), { clock: fixed, ...settings });
  assert.equal(first.held, 1);
  assert.equal(first.retried, 1);
  let row = db.sqlite.prepare('SELECT * FROM invoice_lineage_webhook_inbox').get();
  assert.equal(row.state, 'retryable');
  assert.equal(row.attempts, 1);
  const tooSoon = await invoiceLineageShadowCycle(env(db), { clock: () => fixed() + 5 * 60000, ...settings });
  assert.equal(tooSoon.invoices, 0);
  current = snapshot();
  const second = await invoiceLineageShadowCycle(env(db), { clock: () => fixed() + 15 * 60000, ...settings });
  assert.equal(second.resolved, 1);
  row = db.sqlite.prepare('SELECT * FROM invoice_lineage_webhook_inbox').get();
  assert.equal(row.state, 'done');
  assert.equal(row.attempts, 2);
});

test('multi-job invoice goes to manual review without assigning a call', async () => {
  const db = database();
  await handleInvoiceLineageWebhook({ request: await webhook(), env: env(db), clock: fixed });
  const result = await invoiceLineageShadowCycle(env(db), { clock: fixed,
    readInvoice: async () => snapshot({ jobs: connection([job(), job({ id: btoa('gid://Jobber/Job/2') })]) }),
    resolveOrigin: async () => { throw new Error('must not call origin resolver'); } });
  assert.equal(result.manual_review, 1);
  const inbox = db.sqlite.prepare('SELECT * FROM invoice_lineage_webhook_inbox').get();
  assert.equal(inbox.state, 'manual_review');
  assert.equal(inbox.last_error, 'multiple_jobs_on_invoice');
  const row = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow').get();
  assert.equal(row.lineage_status, 'held');
  assert.equal(row.quo_call_id, null);
});

test('transient Jobber read failures retry and eventually stop at manual review', async () => {
  const db = database();
  await handleInvoiceLineageWebhook({ request: await webhook(), env: env(db), clock: fixed });
  for (let attempt = 0; attempt < 5; attempt++) {
    const cycle = await invoiceLineageShadowCycle(env(db), { clock: () => fixed() + attempt * 15 * 60000,
      readInvoice: async () => { throw new Error('temporary provider error'); } });
    assert.equal(cycle.invoices, 1);
  }
  const row = db.sqlite.prepare('SELECT * FROM invoice_lineage_webhook_inbox').get();
  assert.equal(row.state, 'manual_review');
  assert.equal(row.attempts, 5);
  assert.equal(row.last_error, 'invoice_shadow_observation_failed');
});

test('supersession immediately hides old invoice attribution and replays the new exact Request', async () => {
  const db = database();
  const callId = seedCallAndLink(db.sqlite);
  const oldSnapshot = snapshot();
  await observeInvoiceLineageShadow({ database: db, marketKey: 'ut', accountId: ACCOUNT,
    invoiceId: INVOICE, readInvoice: async () => oldSnapshot,
    resolveCallOrigin: async () => ({ status: 'resolved', account_id: ACCOUNT,
      client_id: CLIENT, operational_request_id: REQUEST, original_request_id: ORIGINAL_REQUEST,
      quo_call_id: callId, evidence_kind: 'verified_lineage', link_decision_id: 'decision-1',
      link_revision: 0 }) });
  const nextJob = job({ request: { id: REPLACEMENT_REQUEST, client: { id: CLIENT } },
    quote: { id: QUOTE, client: { id: CLIENT },
      request: { id: REPLACEMENT_REQUEST, client: { id: CLIENT } } } });
  const nextSnapshot = snapshot({ id: SECOND_INVOICE, jobs: connection([nextJob]) });
  await observeInvoiceLineageShadow({ database: db, marketKey: 'ut', accountId: ACCOUNT,
    invoiceId: SECOND_INVOICE, readInvoice: async () => nextSnapshot,
    resolveCallOrigin: async () => ({ status: 'not_call_origin' }) });
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_current_calls').get().n, 1);
  const oldRevisions = db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_revisions WHERE invoice_id=?')
    .get(INVOICE).n;
  db.sqlite.prepare(`INSERT INTO call_request_lineage_supersessions
    (decision_id, account_id, quo_call_id, revision, prior_decision_id,
      operational_request_id, verified_by, evidence_ref, verified_at)
    VALUES ('decision-2', ?, ?, 1, 'decision-1', ?, 'owner', 'review-2', ?)`)
    .run(ACCOUNT, callId, REPLACEMENT_REQUEST, '2026-10-12T22:01:00Z');
  // The view invalidates the old attribution before the cron has replayed it.
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_current_calls').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_revisions WHERE invoice_id=?')
    .get(INVOICE).n, oldRevisions);
  const result = await invoiceLineageShadowCycle(env(db), { clock: () => fixed() + 2 * 60000,
    readInvoice: async (_market, invoiceId) => {
      assert.equal(invoiceId, SECOND_INVOICE); return nextSnapshot; },
    readRequest: async (_market, requestId) => ({ account: { id: ACCOUNT },
      request: { id: requestId, client: { id: CLIENT } } }) });
  assert.equal(result.invoices, 1);
  assert.equal(result.resolved, 1);
  const current = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow_current_calls').all();
  assert.equal(current.length, 1);
  assert.equal(current[0].invoice_id, SECOND_INVOICE);
  assert.equal(current[0].link_decision_id, 'decision-2');
  assert.equal(current[0].link_revision, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_revisions WHERE invoice_id=?')
    .get(INVOICE).n, oldRevisions);
});

test('Stage3c routes invoice topic to signed shadow ingress only', async () => {
  const { default: stage3c } = await import('../workers/stage3c-live.js');
  const db = database();
  const request = await webhook('INVOICE_UPDATE');
  const response = await stage3c.fetch(new Request('https://test.example/webhooks/jobber', {
    method: 'POST', headers: request.headers, body: await request.text(),
  }), env(db));
  assert.equal(response.status, 202);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_webhook_inbox').get().n, 1);
});
