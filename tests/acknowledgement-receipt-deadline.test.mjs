import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { setImmediate as immediate } from 'node:timers/promises';
import { ACKNOWLEDGEMENT_RECEIPT_WAIT_MS, recordWebsiteAcknowledgementSourceSafely } from '../server/acknowledgement-source.js';
import { onRequestPost } from '../functions/api/leads.js';

const encode = (model, id) => btoa(`gid://Jobber/${model}/${id}`);
const lead = { market_key: 'ut', submission_id: 'c39b2580-0e7e-4aba-b19f-6abbd71f7136', submitted_at: '2026-09-08T02:00:00.000Z', phone: '8015551212' };
const jobber = { market_key: 'ut', request_id: encode('Request', 10), client_id: encode('Client', 20) };
const secretError = () => Error('secret-token test@example.invalid 8015551212');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 6; i++) await immediate(); };
async function until(check) { for (let i = 0; i < 100 && !check(); i++) await immediate(); assert.ok(check(), 'expected async stage reached'); }

function memoryDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return { sqlite, prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const methods = params => ({ first: async () => stmt.get(...params) || null, run: async () => ({ success: true, meta: { changes: Number(stmt.run(...params).changes) } }) });
    return { ...methods([]), bind: (...params) => methods(params) };
  } };
}

function fixture(t, stage) {
  const db = memoryDatabase(), gate = deferred(), readGate = deferred(), log = [], lifetime = [], reached = { write: false, readback: false };
  let conflict = false;
  const wrapped = { prepare(sql) {
    const prepared = db.prepare(sql);
    if (!sql.includes('acknowledgement_sources')) return prepared;
    return { bind(...params) {
      const bound = prepared.bind(...params);
      return {
        async run() { reached.write = true; if (stage === 'write' || stage === 'combined') await gate.promise; return bound.run(); },
        async first() { reached.readback = true; if (stage === 'readback') await gate.promise; if (stage === 'combined') await readGate.promise; const row = await bound.first(); return conflict && row ? { ...row, client_id: encode('Client', 999) } : row; },
      };
    } };
  } };
  t.after(() => db.sqlite.close());
  const env = { ACKNOWLEDGEMENT_SOURCE_ENABLED: 'true', ANGI_ROUTER_DB: wrapped };
  const logger = { error: (...args) => log.push(args) };
  return { db, gate, readGate, reached, env, logger, log, lifetime, conflict: () => { conflict = true; },
    start: (waitUntil = p => lifetime.push(p)) => recordWebsiteAcknowledgementSourceSafely(env, lead, jobber, logger, waitUntil) };
}

for (const stage of ['write', 'readback']) {
  for (const outcome of ['never', 'reject-before', 'reject-after', 'late-success', 'late-conflict']) {
    test(`${stage}: ${outcome} uses one bounded wait and observes late work safely`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const f = fixture(t, stage), unhandled = [];
      const listener = error => unhandled.push(error); process.on('unhandledRejection', listener); t.after(() => process.off('unhandledRejection', listener));
      let finished = false;
      const result = f.start().then(value => { finished = true; return value; });
      await until(() => f.reached[stage]);
      assert.equal(ACKNOWLEDGEMENT_RECEIPT_WAIT_MS, 2000);
      if (outcome === 'reject-before') {
        f.gate.reject(secretError());
        assert.equal((await result).reason, 'acknowledgement_receipt_unavailable');
        assert.equal(f.lifetime.length, 0);
      } else {
        t.mock.timers.tick(1999); await flush(); assert.equal(finished, false);
        t.mock.timers.tick(1);
        assert.equal((await result).reason, 'acknowledgement_receipt_timeout');
        assert.equal(f.lifetime.length, 1);
        if (outcome !== 'never') {
          if (outcome === 'late-conflict') f.conflict();
          if (outcome === 'reject-after') f.gate.reject(secretError()); else f.gate.resolve();
          const late = await f.lifetime[0];
          assert.equal(late.ok, outcome === 'late-success');
          if (outcome === 'late-success') {
            const saved = f.db.sqlite.prepare('SELECT * FROM acknowledgement_sources').get();
            assert.equal(saved.source_created_at, lead.submitted_at);
            assert.equal(saved.source_lead_id, `website:${lead.submission_id}`);
            assert.equal(saved.client_id, jobber.client_id);
          }
        }
      }
      const count = f.log.length; t.mock.timers.tick(10000); await flush(); assert.equal(f.log.length, count, 'no leaked/repeated timer');
      assert.deepEqual(unhandled, []);
      assert.doesNotMatch(JSON.stringify(f.log), /secret-token|example.invalid|8015551212|c39b2580|Z2lk/);
    });
  }
}

test('write and readback share one 2000ms deadline, not separate per-statement budgets', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, 'combined'); let finished = false;
  const result = f.start().then(value => { finished = true; return value; });
  await until(() => f.reached.write);
  t.mock.timers.tick(1500); f.gate.resolve(); await until(() => f.reached.readback);
  t.mock.timers.tick(499); await flush(); assert.equal(finished, false);
  t.mock.timers.tick(1); assert.equal((await result).reason, 'acknowledgement_receipt_timeout');
  f.readGate.resolve(); assert.equal((await f.lifetime[0]).recorded, true);
});

test('fast success clears its timer and does not extend request lifetime', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, 'none'); assert.equal((await f.start()).recorded, true);
  t.mock.timers.tick(10000); await flush(); assert.deepEqual(f.log, []); assert.deepEqual(f.lifetime, []);
});

test('late failure remains contained even if request lifetime registration or logging throws', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, 'write');
  f.logger.error = () => { throw secretError(); };
  const result = f.start(() => { throw secretError(); }); await until(() => f.reached.write);
  t.mock.timers.tick(2000); assert.equal((await result).reason, 'acknowledgement_receipt_timeout');
  f.gate.reject(secretError()); await flush();
});

for (const [market, key, state, zip, suffix] of [['ut', 'utah', 'UT', '84101', 'SLC'], ['mo_stl', 'stl', 'MO', '63101', 'STL'], ['mo_kc', 'kc', 'MO', '64101', 'KC']]) {
  for (const stage of ['write', 'readback']) {
    test(`${market} accepted form survives ${stage} timeout with bound waitUntil and all downstream delivery`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const f = fixture(t, stage), requests = [], received = [];
      const originalFetch = globalThis.fetch, originalError = console.error;
      t.after(() => { globalThis.fetch = originalFetch; console.error = originalError; });
      console.error = f.logger.error;
      f.db.sqlite.prepare('INSERT INTO angi_router_jobber_auth (account_key, access_token, access_expires_at, updated_at) VALUES (?, ?, ?, ?)').run(key, 'unit-test-token', Date.now() + 3_600_000, lead.submitted_at);
      let clientGate = deferred(), clientReached = false;
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body); received.push({ url, body });
        if (url === 'https://api.getjobber.com/api/graphql') {
          requests.push(body.query); assert.equal(options.headers.Authorization, 'bearer unit-test-token');
          if (body.query.includes('clientCreate')) { clientReached = true; await clientGate.promise; return Response.json({ data: { clientCreate: { client: { id: encode('Client', 20), clientProperties: { nodes: [] } }, userErrors: [] } } }); }
          if (body.query.includes('requestCreate')) return Response.json({ data: { requestCreate: { request: { id: encode('Request', 10), jobberWebUri: 'https://secure.getjobber.com/work_requests/10' }, userErrors: [] } } });
        }
        if (url === 'https://ghl.example.invalid/hook' || String(url).startsWith('https://fieldflow.example.invalid/')) return Response.json({ ok: true });
        throw Error('Unexpected external operation in mock');
      };
      const context = {
        request: new Request('https://goodattic.energy/api/leads', { method: 'POST', body: JSON.stringify({ name: 'Test Person', phone: lead.phone, email: 'test@example.invalid', street_address: '1 Test Street', city: 'Test City', state, zip, page_market: market }) }),
        env: { ...f.env, GHL_WEBHOOK_URL: 'https://ghl.example.invalid/hook', FIELDFLOW_ATTRIBUTION_BASE_URL: 'https://fieldflow.example.invalid/attribution', [`FIELDFLOW_ATTRIBUTION_TOKEN_${suffix}`]: 'unit-test-fieldflow' },
        waitUntil(promise) { assert.equal(this, context, 'Pages request context must remain bound'); f.lifetime.push(promise); },
      };
      let finished = false; const result = onRequestPost(context).then(value => { finished = true; return value; });
      await until(() => clientReached); t.mock.timers.tick(5000); await flush();
      assert.equal(finished, false); assert.equal(f.reached.write, false, 'receipt timer does not cap Jobber creation');
      clientGate.resolve(); await until(() => f.reached[stage]);
      t.mock.timers.tick(1999); await flush(); assert.equal(finished, false);
      t.mock.timers.tick(1);
      const response = await result, body = await response.json();
      assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.jobber.market_key, market);
      assert.deepEqual(Object.keys(body).sort(), ['fieldflow', 'ghl', 'jobber', 'message', 'ok']);
      assert.equal(body.ghl.ok, true); assert.equal(body.fieldflow.ok, true);
      assert.equal(requests.filter(q => q.includes('clientCreate')).length, 1);
      assert.equal(requests.filter(q => q.includes('requestCreate')).length, 1);
      assert.equal(received.filter(r => r.url === 'https://ghl.example.invalid/hook').length, 1);
      const delivered = received.filter(r => String(r.url).startsWith('https://fieldflow.example.invalid/'));
      assert.equal(delivered.length, 1); assert.equal(delivered[0].body.schema_version, '2026-07-31');
      assert.equal(f.lifetime.length, 1);
      f.gate.resolve(); assert.equal((await f.lifetime[0]).recorded, true); await flush();
      assert.equal(requests.length, 2, 'late receipt cannot repeat Jobber creation');
      assert.equal(f.db.sqlite.prepare('SELECT * FROM acknowledgement_sources').get().market_key, market);
      assert.doesNotMatch(JSON.stringify(f.log), /secret-token|example.invalid|8015551212|Test Person|1 Test Street/);
    });
  }
}
