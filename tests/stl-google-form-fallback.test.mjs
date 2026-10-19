import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { onRequestPost } from '../functions/api/leads.js';
import { _private as leads } from '../functions/api/leads.js';

const SUBMISSION_ID = '83534eaa-e6cb-4a2a-ac68-07bed5877c90';
const CAPTURED_AT = new Date().toISOString();
const STL_ACCOUNT = leads.MARKET_ROUTES.mo_stl.expectedAccountId;
const CLIENT = btoa('gid://Jobber/Client/8821');
const REQUEST = btoa('gid://Jobber/Request/9912');
const ready = token => ({ refresh_status: 'ready', access_token: token,
  access_expires_at: Date.now() + 3_600_000, refresh_revision: 0 });

function fixture({ googleAuth = { refresh_status: 'refresh_outcome_unknown' },
  websiteAuth = ready('stl-website-token'), intercept = () => null } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url))
    .filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const auth = { stl_google: googleAuth, stl: websiteAuth };
  const db = { sqlite, prepare(sql) {
    return { bind(...params) {
      const override = intercept(sql, params);
      return {
        async first() {
          if (override) return override.first?.();
          if (sql.includes('jobber_token_authority:select_auth')) return auth[params[0]] || null;
          return sqlite.prepare(sql).get(...params) || null;
        },
        async run() {
          if (override) return override.run?.();
          return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } };
        },
      };
    } };
  } };
  return { db, env: { ANGI_ROUTER_DB: db, ACKNOWLEDGEMENT_SOURCE_ENABLED: 'true',
    JOBBER_GOOGLE_ROUTING_MARKETS: 'ut,mo_stl,mo_kc', EXTERNAL_API_WRITES_ENABLED: 'false' } };
}

function form({ paid = true, submissionId = SUBMISSION_ID } = {}) {
  const data = {
    submission_id: submissionId, first_name: 'Test', last_name: 'Lead', phone: '3145551212',
    email: 'fixture@example.invalid', street_address: '1 Test Street', city: 'St. Louis',
    state: 'MO', zip: '63101', page_market: 'mo_stl',
  };
  if (paid) Object.assign(data, {
    attribution_captured_at: CAPTURED_AT,
    ad_landing_page: 'https://goodattic.energy/st-louis-mo/?gclid=PaidSTL_123456&utm_source=google&utm_medium=cpc&utm_campaign=stl-fall',
  });
  return new Request('https://goodattic.energy/api/leads', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
}

async function withJobber(callback, responder = null) {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const writes = [];
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.getjobber.com/api/graphql');
    const { query } = JSON.parse(options.body);
    const kind = query.includes('GoodAtticClientCreate') ? 'client' :
      query.includes('GoodAtticRequestCreate') ? 'request' : 'other';
    writes.push({ kind, bearer: options.headers.Authorization });
    if (responder) return responder(kind);
    if (kind === 'client') return Response.json({ data: { clientCreate: { client:
      { id: CLIENT, clientProperties: { nodes: [] } }, userErrors: [] } } });
    if (kind === 'request') return Response.json({ data: { requestCreate: { request:
      { id: REQUEST }, userErrors: [] } } });
    throw Error('unexpected_external_request');
  };
  try { return await callback(writes); }
  finally { globalThis.fetch = previousFetch; console.error = previousError; }
}

test('broken STL Google authorization falls back before a write and preserves exact paid source', async () => {
  const { db, env } = fixture();
  try {
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form() });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.jobber.jobber_source_app, 'website');
      assert.equal(body.jobber.source_app_fallback_reason, 'jobber_refresh_outcome_unknown');
      assert.equal(body.jobber.attributed_source, 'Google Ads');
      assert.equal(body.jobber.account_id, STL_ACCOUNT);
      assert.equal(body.source_proof_confirmed, true);
      assert.equal(body.transaction_confirmed, true);
      assert.deepEqual(writes.map(item => item.kind), ['client', 'request']);
      assert.ok(writes.every(item => item.bearer === 'bearer stl-website-token'));
      const proof = db.sqlite.prepare('SELECT * FROM website_stl_google_source_proofs').get();
      assert.equal(proof.state, 'completed');
      assert.equal(proof.market_key, 'mo_stl');
      assert.equal(proof.account_id, STL_ACCOUNT);
      assert.equal(proof.jobber_source_app, 'website');
      assert.equal(proof.jobber_request_id, REQUEST);
      assert.equal(proof.jobber_client_id, CLIENT);
      assert.equal(JSON.parse(proof.evidence_json).verified_signals.gclid, 'PaidSTL_123456');
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_google_source_proofs').get().n, 0);
      const transaction = db.sqlite.prepare('SELECT * FROM website_form_conversions').get();
      const receipt = db.sqlite.prepare('SELECT * FROM acknowledgement_sources').get();
      const ledger = db.sqlite.prepare('SELECT * FROM closed_loop_leads').get();
      assert.equal(transaction.jobber_request_id, REQUEST);
      assert.equal(receipt.source_lead_id, `website:${SUBMISSION_ID}`);
      assert.equal(receipt.account_id, STL_ACCOUNT);
      assert.equal(ledger.original_source, 'Google Ads');
      assert.equal(ledger.gclid, 'PaidSTL_123456');
      assert.equal(ledger.campaign, 'stl-fall');
      assert.equal(ledger.jobber_request_id, REQUEST);
      const retry = await onRequestPost({ env, request: form() });
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).duplicate, true);
      assert.equal(writes.length, 2);
      const changed = await onRequestPost({ env, request: form({ paid: false }) });
      assert.equal(changed.status, 503);
      assert.equal(writes.length, 2);
    });
  } finally { db.sqlite.close(); }
});

test('healthy STL Google app remains the writer; organic STL uses Website app without paid proof', async () => {
  for (const [paid, expected] of [[true, 'google-token'], [false, 'stl-website-token']]) {
    const { db, env } = fixture({ googleAuth: ready('google-token') });
    try {
      await withJobber(async writes => {
        const response = await onRequestPost({ env, request: form({ paid }) });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.jobber.jobber_source_app, paid ? 'google' : 'website');
        assert.ok(writes.every(item => item.bearer === `bearer ${expected}`));
        assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_stl_google_source_proofs').get().n,
          paid ? 1 : 0);
      });
    } finally { db.sqlite.close(); }
  }
});

test('broken STL Website authorization stops paid intake before a Jobber mutation', async () => {
  const { db, env } = fixture({ websiteAuth: { refresh_status: 'refresh_outcome_unknown' } });
  try {
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form() });
      assert.ok(response.status >= 500);
      assert.equal(writes.length, 0);
      assert.equal(db.sqlite.prepare('SELECT state FROM website_stl_google_source_proofs').get().state,
        'prepared');
    });
  } finally { db.sqlite.close(); }
});

test('a prepared paid STL proof blocks a same-UUID organic retry after reservation release', async () => {
  const websiteAuth = { refresh_status: 'refresh_outcome_unknown' };
  const { db, env } = fixture({ websiteAuth });
  try {
    await withJobber(async writes => {
      const paidAttempt = await onRequestPost({ env, request: form() });
      assert.ok(paidAttempt.status >= 500);
      assert.equal(db.sqlite.prepare('SELECT state FROM website_stl_google_source_proofs').get().state,
        'prepared');
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_form_conversions').get().n, 0);
      Object.assign(websiteAuth, ready('stl-website-token'));

      const organicRetry = await onRequestPost({ env, request: form({ paid: false }) });
      assert.equal(organicRetry.status, 503);
      assert.equal((await organicRetry.json()).details.code, 'google_source_chain_unconfirmed');
      assert.equal(writes.length, 0);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_form_conversions').get().n, 0);
    });
  } finally { db.sqlite.close(); }
});

test('an STL proof read failure blocks organic Jobber writes', async () => {
  const { db, env } = fixture({ intercept: sql =>
    sql.includes('SELECT * FROM website_stl_google_source_proofs')
      ? { first: () => { throw Error('proof_read_unavailable'); } } : null });
  try {
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form({ paid: false }) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).details.code, 'google_source_proof_unavailable');
      assert.equal(writes.length, 0);
    });
  } finally { db.sqlite.close(); }
});

test('an in-flight STL UUID blocks a second organic Jobber write before paid proof is prepared', async () => {
  const { db, env } = fixture();
  try {
    db.sqlite.prepare(`INSERT INTO website_form_conversions
      (submission_id, transaction_id, market_key, state, conversion_state, created_at, updated_at)
      VALUES (?, ?, 'mo_stl', 'processing', 'not_confirmed', ?, ?)`)
      .run(SUBMISSION_ID, SUBMISSION_ID, CAPTURED_AT, CAPTURED_AT);
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form({ paid: false }) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).details.code, 'stl_form_transaction_unavailable');
      assert.equal(writes.length, 0);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_stl_google_source_proofs').get().n,
        0);
    });
  } finally { db.sqlite.close(); }
});

test('an uncertain STL Jobber write is fenced and never retried for the same UUID', async () => {
  const { db, env } = fixture();
  try {
    await withJobber(async writes => {
      const first = await onRequestPost({ env, request: form() });
      assert.ok(first.status >= 500);
      assert.equal(db.sqlite.prepare('SELECT state FROM website_stl_google_source_proofs').get().state,
        'write_started');
      const retry = await onRequestPost({ env, request: form() });
      assert.ok(retry.status >= 500);
      assert.equal(writes.length, 1);
    }, () => { throw Error('unknown_jobber_outcome'); });
  } finally { db.sqlite.close(); }
});

test('an unconfirmed STL proof after Request creation holds downstream attribution', async () => {
  const { db, env } = fixture({ intercept: sql =>
    sql.includes('UPDATE website_stl_google_source_proofs') && sql.includes("SET state = 'completed'")
      ? { run: () => { throw Error('proof_completion_unavailable'); } } : null });
  try {
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form() });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.source_proof_confirmed, false);
      assert.equal(body.fieldflow.reason, 'google_source_chain_unconfirmed');
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM closed_loop_leads').get().n, 0);
      assert.deepEqual(writes.map(item => item.kind), ['client', 'request']);
    });
  } finally { db.sqlite.close(); }
});
