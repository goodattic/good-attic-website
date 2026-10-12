import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  INVOICE_LINEAGE_QUERY, readJobberInvoiceLineage,
  deriveInvoiceLineage, observeInvoiceLineageShadow,
} from '../server/invoice-lineage-shadow.js';

const gid = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const ACCOUNT = gid('Account', 2498432);
const INVOICE = gid('Invoice', 170748133);
const CLIENT = gid('Client', 148362284);
const REQUEST = gid('Request', 35017723);
const QUOTE = gid('Quote', 66764742);
const JOB = gid('Job', 154980901);

const job = (overrides = {}) => ({
  id: JOB, client: { id: CLIENT }, request: { id: REQUEST, client: { id: CLIENT } },
  quote: { id: QUOTE, client: { id: CLIENT }, request: { id: REQUEST, client: { id: CLIENT } } },
  ...overrides,
});
const connection = (items = []) => ({ nodes: items, pageInfo: { hasNextPage: false, endCursor: null } });
const snapshot = (overrides = {}) => ({
  account: { id: ACCOUNT },
  invoice: { id: INVOICE, updatedAt: '2026-10-12T21:00:00Z', invoiceStatus: 'PAID',
    client: { id: CLIENT }, amounts: { total: 1250.5, paymentsTotal: 1250.5, invoiceBalance: 0 },
    jobs: connection([job()]), archivedJobs: connection(),
    ...overrides },
});
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of ['../migrations/0008_quo_call_attributions.sql',
    '../migrations/0017_call_request_lineage.sql',
    '../migrations/0023_call_request_lineage_supersessions.sql',
    '../migrations/0019_invoice_lineage_shadow.sql',
    '../migrations/0024_invoice_lineage_webhook_inbox.sql']) {
    sqlite.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  const wrap = (sql) => {
    let args = [];
    return { bind(...values) { args = values; return this; }, run() {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    } };
  };
  return { sqlite, prepare: wrap, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}

test('reader performs only a versioned, account-scoped invoice query', async () => {
  const calls = [];
  const result = await readJobberInvoiceLineage({ marketKey: 'ut', invoiceId: INVOICE,
    tokenForMarket: async market => { assert.equal(market, 'ut'); return 'test-token'; },
    fetchImpl: async (url, options) => { calls.push({ url, options });
      return { ok: true, json: async () => ({ data: snapshot() }) }; },
  });
  assert.equal(result.account.id, ACCOUNT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.getjobber.com/api/graphql');
  assert.equal(calls[0].options.headers['X-JOBBER-GRAPHQL-VERSION'], '2025-04-16');
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.query, /^query CallOriginInvoiceLineage/);
  assert.equal(body.variables.id, INVOICE);
  assert.match(INVOICE_LINEAGE_QUERY, /paymentsTotal invoiceBalance/);
  assert.match(INVOICE_LINEAGE_QUERY, /archivedJobs\(first: 2\)/);
  assert.doesNotMatch(INVOICE_LINEAGE_QUERY, /\bmutation\b/i);
});

test('reader rejects GraphQL errors without treating a partial invoice as evidence', async () => {
  await assert.rejects(() => readJobberInvoiceLineage({ marketKey: 'ut', invoiceId: INVOICE,
    tokenForMarket: async () => 'test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({
      data: snapshot(), errors: [{ message: 'one field failed' }],
    }) }),
  }), /jobber_invoice_graphql_failed/);
});

test('single matching Job resolves invoice, Request, quote, and aggregate payment state', () => {
  const row = deriveInvoiceLineage({ marketKey: 'ut', accountId: ACCOUNT,
    invoiceId: INVOICE, data: snapshot() });
  assert.equal(row.lineage_status, 'resolved');
  assert.deepEqual(row.hold_reasons, []);
  assert.equal(row.invoice_client_id, CLIENT);
  assert.equal(row.job_id, JOB);
  assert.equal(row.quote_id, QUOTE);
  assert.equal(row.operational_request_id, REQUEST);
  assert.equal(row.invoice_total_micros, 1250500000);
  assert.equal(row.payments_total_micros, 1250500000);
  assert.equal(row.invoice_balance_micros, 0);
  assert.equal(row.invoice_status, 'paid');
});

test('resolved call origin stores the exact crosswalk and keeps payment changes as revisions', async () => {
  const db = database();
  let current = snapshot();
  const origin = async ({ accountId, object }) => {
    assert.equal(accountId, ACCOUNT);
    assert.equal(object.id, REQUEST);
    assert.equal(object.client.id, CLIENT);
    return { status: 'resolved', account_id: ACCOUNT, client_id: CLIENT,
      operational_request_id: REQUEST, original_request_id: gid('Request', 35017089),
      quo_call_id: ('AC' + 'c'.repeat(32)), evidence_kind: 'verified_lineage',
      link_decision_id: 'decision-1', link_revision: 0 };
  };
  const observe = () => observeInvoiceLineageShadow({ database: db, marketKey: 'ut',
    accountId: ACCOUNT, invoiceId: INVOICE, readInvoice: async () => current,
    resolveCallOrigin: origin, observedAt: '2026-10-12T22:00:00Z' });
  await observe();
  await observe();
  let row = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow').get();
  assert.equal(row.call_origin_status, 'resolved');
  assert.equal(row.original_request_id, gid('Request', 35017089));
  assert.equal(row.operational_request_id, REQUEST);
  assert.equal(row.payments_total_micros, 1250500000);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_revisions').get().n, 1);
  current = snapshot({ invoiceStatus: 'PARTIALLY_PAID',
    amounts: { total: 1250.5, paymentsTotal: 625.25, invoiceBalance: 625.25 },
    updatedAt: '2026-10-13T00:00:00Z' });
  await observe();
  row = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow').get();
  assert.equal(row.payments_total_micros, 625250000);
  assert.equal(row.invoice_balance_micros, 625250000);
  assert.equal(row.invoice_total_micros, 1250500000);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow_revisions').get().n, 2);
});

test('multi-job, pagination, missing Request, and conflicting Job/Quote Requests are held', () => {
  const cases = [
    [snapshot({ jobs: connection([job(), job({ id: gid('Job', 2) })]) }), 'multiple_jobs_on_invoice'],
    [snapshot({ jobs: { nodes: [job()], pageInfo: { hasNextPage: true, endCursor: 'next' } } }), 'job_connection_incomplete'],
    [snapshot({ jobs: connection([job({ request: null, quote: { id: QUOTE, client: { id: CLIENT }, request: null } })]) }), 'request_missing'],
    [snapshot({ jobs: connection([job({ quote: { id: QUOTE, client: { id: CLIENT },
      request: { id: gid('Request', 99), client: { id: CLIENT } } } })]) }), 'job_quote_request_conflict'],
  ];
  for (const [data, reason] of cases) {
    const row = deriveInvoiceLineage({ marketKey: 'ut', accountId: ACCOUNT, invoiceId: INVOICE, data });
    assert.equal(row.lineage_status, 'held');
    assert.ok(row.hold_reasons.includes(reason), reason);
  }
});

test('account and client mismatches hold; no origin resolver is called', async () => {
  const db = database();
  const row = await observeInvoiceLineageShadow({ database: db, marketKey: 'ut',
    accountId: ACCOUNT, invoiceId: INVOICE, readInvoice: async () => ({
      ...snapshot({ client: { id: gid('Client', 55) } }), account: { id: gid('Account', 99) },
    }), resolveCallOrigin: () => { throw new Error('must not run'); } });
  assert.equal(row.lineage_status, 'held');
  assert.ok(row.hold_reasons.includes('jobber_account_conflict'));
  assert.ok(row.hold_reasons.includes('invoice_job_client_conflict'));
  assert.equal(row.call_origin_status, 'held');
  const stored = db.sqlite.prepare('SELECT * FROM invoice_lineage_shadow').get();
  assert.equal(stored.quo_call_id, null);
});

test('quote-to-Request edge works when Job Request is absent, but mismatched Request client holds', () => {
  const direct = deriveInvoiceLineage({ marketKey: 'ut', accountId: ACCOUNT,
    invoiceId: INVOICE, data: snapshot({ jobs: connection([job({ request: null })]) }) });
  assert.equal(direct.lineage_status, 'resolved');
  assert.equal(direct.operational_request_id, REQUEST);
  const mismatch = deriveInvoiceLineage({ marketKey: 'ut', accountId: ACCOUNT,
    invoiceId: INVOICE, data: snapshot({ jobs: connection([job({ request: {
      id: REQUEST, client: { id: gid('Client', 8) },
    } })]) }) });
  assert.equal(mismatch.lineage_status, 'held');
  assert.ok(mismatch.hold_reasons.includes('invoice_request_client_conflict'));
});

test('origin verification failure holds call attribution while retaining invoice evidence', async () => {
  const db = database();
  const result = await observeInvoiceLineageShadow({ database: db, marketKey: 'ut',
    accountId: ACCOUNT, invoiceId: INVOICE, readInvoice: async () => snapshot(),
    resolveCallOrigin: async () => { throw new Error('temporary Jobber read failure'); } });
  assert.equal(result.lineage_status, 'resolved');
  assert.equal(result.call_origin_status, 'held');
  assert.equal(result.call_origin_hold_reason, 'call_origin_verification_failed');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM invoice_lineage_shadow').get().n, 1);
});
