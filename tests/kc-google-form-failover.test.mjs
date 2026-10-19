import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { onRequestPost } from '../functions/api/leads.js';
import { _private as leads } from '../functions/api/leads.js';
import { _private as attribution } from '../server/fieldflow-attribution.js';
import { findVerifiedKcQuoteLead } from '../server/kc-website-quote-proof.js';

const SUBMISSION_ID = '31534eaa-e6cb-4a2a-ac68-07bed5877c90';
const CAPTURED_AT = new Date().toISOString();
const KC_ACCOUNT = leads.MARKET_ROUTES.mo_kc.expectedAccountId;
const CLIENT = btoa('gid://Jobber/Client/8821');
const REQUEST = btoa('gid://Jobber/Request/9912');
const ready = token => ({ refresh_status: 'ready', access_token: token,
  access_expires_at: Date.now() + 3_600_000, refresh_revision: 0 });

function fixture({ googleAuth = { refresh_status: 'refresh_outcome_unknown' },
  websiteAuth = ready('kc-website-token'), intercept = () => null } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const auth = { kc_google: googleAuth, kc: websiteAuth };
  const db = { sqlite, prepare(sql) {
    return { bind(...params) {
      const override = intercept(sql, params);
      return {
        async first() {
          if (override) return override.first?.();
          if (sql.includes('jobber_token_authority:select_auth')) return auth[params[0]] || null;
          return sqlite.prepare(sql).get(...params) || null;
        },
        async all() {
          if (override) return override.all?.();
          return { results: sqlite.prepare(sql).all(...params) };
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

function form({ submission_id = SUBMISSION_ID, paid = true, paidTouch = false } = {}) {
  const data = {
    submission_id, first_name: 'Test', last_name: 'Lead', phone: '8165551212',
    email: 'fixture@example.invalid', street_address: '1 Test Street', city: 'Kansas City',
    state: 'MO', zip: '64101', page_market: 'mo_kc',
  };
  if (paidTouch) Object.assign(data, {
    attribution_captured_at: CAPTURED_AT,
    ad_landing_page: 'https://goodattic.energy/kansas-city-mo/',
    paid_touch_captured_at: CAPTURED_AT,
    paid_touch_landing_page: 'https://goodattic.energy/kansas-city-mo/?gclid=PaidKC_123456&utm_source=google&utm_medium=cpc&utm_campaign=kc-fall',
  });
  else if (paid) Object.assign(data, {
    attribution_captured_at: CAPTURED_AT,
    ad_landing_page: 'https://goodattic.energy/kansas-city-mo/?gclid=PaidKC_123456&utm_source=google&utm_medium=cpc&utm_campaign=kc-fall',
  });
  return new Request('https://goodattic.energy/api/leads', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
}

async function withJobber(callback) {
  const priorFetch = globalThis.fetch;
  const priorError = console.error;
  const writes = [];
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.getjobber.com/api/graphql');
    const { query } = JSON.parse(options.body);
    const kind = query.includes('GoodAtticClientCreate') ? 'client' :
      query.includes('GoodAtticRequestCreate') ? 'request' : 'other';
    writes.push({ kind, bearer: options.headers.Authorization });
    if (kind === 'client') return Response.json({ data: { clientCreate: { client:
      { id: CLIENT, clientProperties: { nodes: [] } }, userErrors: [] } } });
    if (kind === 'request') return Response.json({ data: { requestCreate: { request:
      { id: REQUEST }, userErrors: [] } } });
    throw Error('unexpected_external_request');
  };
  try { return await callback(writes); }
  finally { globalThis.fetch = priorFetch; console.error = priorError; }
}

test('broken KC Google auth uses KC Website app once with durable paid proof and exact Request receipt', async () => {
  const { db, env } = fixture();
  try {
    await withJobber(async writes => {
      const first = await onRequestPost({ env, request: form({ paidTouch: true }) });
      assert.equal(first.status, 200);
      const body = await first.json();
      assert.equal(body.jobber.jobber_source_app, 'website');
      assert.equal(body.jobber.source_app_fallback_reason, 'jobber_refresh_outcome_unknown');
      assert.equal(body.jobber.attributed_source, 'Google Ads');
      assert.equal(body.jobber.account_id, KC_ACCOUNT);
      assert.equal(body.source_proof_confirmed, true);
      assert.equal(body.transaction_confirmed, true);
      assert.deepEqual(writes.map(item => item.kind), ['client', 'request']);
      assert.ok(writes.every(item => item.bearer === 'bearer kc-website-token'));
      const proof = db.sqlite.prepare('SELECT * FROM website_google_source_proofs').get();
      assert.equal(proof.state, 'completed');
      assert.equal(proof.jobber_request_id, REQUEST);
      assert.equal(proof.jobber_client_id, CLIENT);
      assert.equal(proof.source_reason, 'paid_touch_gclid');
      const evidence = JSON.parse(proof.evidence_json);
      assert.equal(evidence.attribution.paid_touch_landing_page.includes('PaidKC_123456'), true);
      assert.equal(evidence.verified_signals.gclid, 'PaidKC_123456');
      const receipt = db.sqlite.prepare('SELECT * FROM acknowledgement_sources').get();
      assert.equal(receipt.account_id, KC_ACCOUNT);
      assert.equal(receipt.request_id, REQUEST);
      assert.equal(receipt.client_id, CLIENT);
      assert.equal(receipt.source_lead_id, `website:${SUBMISSION_ID}`);
      const conversion = db.sqlite.prepare('SELECT * FROM website_form_conversions').get();
      assert.equal(conversion.jobber_request_id, REQUEST);
      const ledger = db.sqlite.prepare('SELECT * FROM closed_loop_leads WHERE jobber_request_id = ?').get(REQUEST);
      assert.equal(ledger.submission_id, SUBMISSION_ID);
      assert.equal(ledger.market_key, 'mo_kc');
      assert.equal(ledger.jobber_account_id, KC_ACCOUNT);
      assert.equal(ledger.jobber_client_id, CLIENT);
      assert.equal(ledger.original_source, 'Google Ads');
      assert.equal(ledger.campaign, 'kc-fall');
      assert.equal(ledger.gclid, 'PaidKC_123456');
      assert.equal(ledger.gbraid, null);
      assert.equal(ledger.wbraid, null);
      const exactRecord = {
        market_key: 'mo_kc', lead_source: 'Google Ads', source_key: 'google',
        source_detail: 'google_ads', source_reason: proof.source_reason,
        submission_id: SUBMISSION_ID, jobber_account_id: KC_ACCOUNT,
        jobber_request_id: REQUEST, jobber_client_id: CLIENT,
        occurred_at: receipt.source_created_at, campaign: 'kc-fall',
        gclid: 'PaidKC_123456',
      };
      assert.deepEqual(await attribution.verifiedKcGoogleWebsiteLead(db, exactRecord),
        { gclid: 'PaidKC_123456', gbraid: '', wbraid: '', campaign: 'kc-fall' });
      assert.equal(await attribution.verifiedKcGoogleWebsiteLead(db,
        { ...exactRecord, campaign: 'unverified-campaign' }), null);
      db.sqlite.prepare('UPDATE acknowledgement_sources SET client_id = ? WHERE request_id = ?')
        .run('different-client', REQUEST);
      assert.equal(await attribution.verifiedKcGoogleWebsiteLead(db, exactRecord), null);
      db.sqlite.prepare('UPDATE acknowledgement_sources SET client_id = ? WHERE request_id = ?')
        .run(CLIENT, REQUEST);

      const retry = await onRequestPost({ env, request: form({ paidTouch: true }) });
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).duplicate, true);
      assert.equal(writes.length, 2);
      const changed = await onRequestPost({ env, request: form() });
      assert.equal(changed.status, 503, 'same UUID with changed paid evidence is held');
      assert.equal(writes.length, 2);
    });
  } finally { db.sqlite.close(); }
});

test('healthy Google token stays on KC Google app; ordinary website forms stay on Website app', async () => {
  for (const [paid, expected] of [[true, 'google-token'], [false, 'kc-website-token']]) {
    const { db, env } = fixture({ googleAuth: ready('google-token') });
    try {
      await withJobber(async writes => {
        const response = await onRequestPost({ env, request: form({ paid }) });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.jobber.jobber_source_app, paid ? 'google' : 'website');
        assert.ok(writes.every(item => item.bearer === `bearer ${expected}`));
        assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_google_source_proofs').get().n, paid ? 1 : 0);
        assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM closed_loop_leads').get().n, paid ? 1 : 0);
        if (!paid) {
          const attestation = db.sqlite.prepare('SELECT * FROM kc_website_nonpaid_source_attestations').get();
          assert.equal(attestation.state, 'completed');
          assert.equal(attestation.jobber_request_id, REQUEST);
          assert.equal(attestation.jobber_client_id, CLIENT);
          const verified = await findVerifiedKcQuoteLead(db,
            { accountId: KC_ACCOUNT, requestId: REQUEST, clientId: CLIENT });
          assert.equal(verified.ok, true);
          assert.equal(verified.lead.original_source, 'Organic Online');
          assert.equal(verified.lead.campaign, null);
        }
      });
    } finally { db.sqlite.close(); }
  }
});

test('KC nonpaid attestation failure or timeout holds intake before any Jobber write', async () => {
  for (const failure of ['abort', 'timeout']) {
    const { db, env } = fixture({ intercept: sql => {
      if (!sql.includes('INSERT OR IGNORE INTO kc_website_nonpaid_source_attestations')) return null;
      return { run: () => failure === 'timeout' ? new Promise(() => {})
        : Promise.reject(new Error('attestation_unavailable')) };
    } });
    env.FORM_TRANSACTION_TIMEOUT_MS = '30';
    try {
      await withJobber(async writes => {
        const response = await onRequestPost({ env, request: form({ paid: false }) });
        assert.equal(response.status, 503, failure);
        assert.equal((await response.json()).details.code, 'kc_nonpaid_source_unavailable');
        assert.deepEqual(writes, [], failure);
        assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_form_conversions').get().n, 0);
      });
    } finally { db.sqlite.close(); }
  }
});

test('KC nonpaid form keeps Jobber intake available when reservation fails and records its lineage gap', async () => {
  const { db, env } = fixture({ intercept: sql =>
    sql.includes('INSERT OR IGNORE INTO website_form_conversions')
      ? { run: () => { throw new Error('reservation_unavailable'); } } : null });
  try {
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form({ paid: false }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).transaction_confirmed, false);
      assert.deepEqual(writes.map(item => item.kind), ['client', 'request']);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM website_form_conversions').get().n, 0);
      const gap = db.sqlite.prepare('SELECT reason, jobber_request_id, jobber_client_id FROM website_form_reconciliation_attempts').get();
      assert.deepEqual({ ...gap }, { reason: 'kc_nonpaid_reservation_unavailable',
        jobber_request_id: REQUEST, jobber_client_id: CLIENT });
    });
  } finally { db.sqlite.close(); }
});

test('one KC submission cannot switch between paid and nonpaid before Jobber writes', async () => {
  for (const firstPaid of [true, false]) {
    const { db, env } = fixture({ googleAuth: { refresh_status: 'refresh_outcome_unknown' },
      websiteAuth: { refresh_status: 'refresh_outcome_unknown' } });
    try {
      await withJobber(async writes => {
        const first = await onRequestPost({ env, request: form({ paid: firstPaid }) });
        assert.ok(first.status >= 500);
        const firstTable = firstPaid ? 'website_google_source_proofs'
          : 'kc_website_nonpaid_source_attestations';
        const otherTable = firstPaid ? 'kc_website_nonpaid_source_attestations'
          : 'website_google_source_proofs';
        assert.equal(db.sqlite.prepare(`SELECT state FROM ${firstTable}`).get().state, 'prepared');
        const switched = await onRequestPost({ env, request: form({ paid: !firstPaid }) });
        assert.equal(switched.status, 503);
        assert.deepEqual(writes, [], 'source switch must not reach Jobber');
        assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${firstTable}`).get().n, 1);
        assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${otherTable}`).get().n, 0);
      });
    } finally { db.sqlite.close(); }
  }
});

test('KC source class exclusion is atomic in D1 even when a caller skips the read check', () => {
  for (const firstPaid of [true, false]) {
    const { db } = fixture();
    const at = new Date().toISOString();
    const insertPaid = () => db.sqlite.prepare(`INSERT OR IGNORE INTO website_google_source_proofs
      (submission_id, source_lead_id, market_key, account_id, source_key, source_detail,
        source_reason, evidence_json, state, created_at, updated_at)
      VALUES (?, ?, 'mo_kc', ?, 'google', 'google_ads', 'gclid', '{}', 'prepared', ?, ?)`).run(
      SUBMISSION_ID, `website:${SUBMISSION_ID}`, KC_ACCOUNT, at, at);
    const insertNonpaid = () => db.sqlite.prepare(`INSERT OR IGNORE INTO kc_website_nonpaid_source_attestations
      (submission_id, market_key, source_key, source_label, source_detail, source_reason,
        source_created_at, state, account_id, created_at, updated_at)
      VALUES (?, 'mo_kc', 'website', 'Organic Online', 'organic_online',
        'non_google_attribution', ?, 'prepared', ?, ?, ?)`).run(
      SUBMISSION_ID, at, KC_ACCOUNT, at, at);
    try {
      (firstPaid ? insertPaid : insertNonpaid)();
      assert.throws(firstPaid ? insertNonpaid : insertPaid, /kc_source_conflict/);
    } finally { db.sqlite.close(); }
  }
});

test('KC paid form keeps its Jobber Request but skips local lineage when the proof chain cannot be verified', async () => {
  const { db, env } = fixture({ intercept: sql =>
    sql.includes('FROM website_google_source_proofs p') ? { first: () => null } : null });
  try {
    await withJobber(async writes => {
      const response = await onRequestPost({ env, request: form() });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.source_proof_confirmed, true);
      assert.equal(body.fieldflow.ledger.ok, false);
      assert.equal(body.fieldflow.ledger.reason, 'kc_paid_source_proof_unconfirmed');
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM closed_loop_leads').get().n, 0);
      assert.deepEqual(writes.map(item => item.kind), ['client', 'request']);
    });
  } finally { db.sqlite.close(); }
});

test('KC paid source without a click ID records Google Ads without inventing a click', async () => {
  const { db, env } = fixture();
  try {
    await withJobber(async writes => {
      const payload = await form({ paid: false }).json();
      payload.attribution_captured_at = CAPTURED_AT;
      payload.ad_landing_page = 'https://goodattic.energy/kansas-city-mo/?gad_source=5';
      const request = new Request('https://goodattic.energy/api/leads', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const response = await onRequestPost({ env, request });
      assert.equal(response.status, 200);
      const ledger = db.sqlite.prepare('SELECT * FROM closed_loop_leads').get();
      assert.equal(ledger.original_source, 'Google Ads');
      assert.equal(ledger.gclid, null);
      assert.equal(ledger.gbraid, null);
      assert.equal(ledger.wbraid, null);
      assert.equal(db.sqlite.prepare('SELECT source_reason FROM website_google_source_proofs').get().source_reason,
        'gad_source');
      assert.deepEqual(writes.map(item => item.kind), ['client', 'request']);
    });
  } finally { db.sqlite.close(); }
});

test('reservation, source proof, and Website auth failures stop before a Jobber write', async () => {
  for (const reason of ['reservation', 'proof', 'website_auth']) {
    const intercept = (sql) => {
      if (reason === 'reservation' && sql.includes('INSERT OR IGNORE INTO website_form_conversions')) {
        return { run: () => { throw Error('reservation_unavailable'); } };
      }
      if (reason === 'proof' && sql.includes('INSERT OR IGNORE INTO website_google_source_proofs')) {
        return { run: () => { throw Error('proof_unavailable'); } };
      }
      return null;
    };
    const { db, env } = fixture({ intercept,
      websiteAuth: reason === 'website_auth' ? { refresh_status: 'refresh_outcome_unknown' } : ready('kc-website-token') });
    try {
      await withJobber(async writes => {
        const response = await onRequestPost({ env, request: form() });
        assert.ok(response.status >= 500, reason);
        assert.equal(writes.length, 0, reason);
      });
    } finally { db.sqlite.close(); }
  }
});

test('an uncertain Jobber write is fenced; same UUID never creates a second Client', async () => {
  const { db, env } = fixture();
  const priorFetch = globalThis.fetch;
  const priorError = console.error;
  let writes = 0;
  console.error = () => {};
  globalThis.fetch = async () => { writes += 1; throw Error('unknown_jobber_outcome'); };
  try {
    const first = await onRequestPost({ env, request: form() });
    assert.ok(first.status >= 500);
    const proof = db.sqlite.prepare('SELECT state FROM website_google_source_proofs').get();
    assert.equal(proof.state, 'write_started');
    const retry = await onRequestPost({ env, request: form() });
    assert.ok(retry.status >= 500);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = priorFetch; console.error = priorError; db.sqlite.close(); }
});

test('historic failure reconciliation can link two UUIDs to one recovered Request without inventing click evidence', () => {
  const { db } = fixture();
  try {
    const insert = db.sqlite.prepare(`INSERT INTO website_lead_intake_reconciliations
      (submission_id, market_key, source_key, disposition, jobber_account_id, jobber_client_id,
       jobber_request_id, click_evidence, evidence_provenance, evidence_note, recorded_at)
      VALUES (?, 'mo_kc', 'google', ?, ?, ?, ?, 'unavailable',
        'jobber_live_reconciliation', 'Original click and UTM fields unavailable', ?)`);
    const now = new Date().toISOString();
    insert.run(SUBMISSION_ID, 'recovered_new', KC_ACCOUNT, CLIENT, REQUEST, now);
    insert.run('1cfb9f77-6b94-4bcf-aaec-9e28bff9a1d3', 'duplicate', KC_ACCOUNT, CLIENT, REQUEST, now);
    const rows = db.sqlite.prepare('SELECT * FROM website_lead_intake_reconciliations').all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.jobber_request_id === REQUEST && row.click_evidence === 'unavailable'));
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM closed_loop_leads').get().n, 0);
  } finally { db.sqlite.close(); }
});
