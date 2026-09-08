import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  normalizeAcknowledgementPhone, sourceHash, recordWebsiteAcknowledgementSource,
  recordWebsiteAcknowledgementSourceSafely, readWebsiteAcknowledgementSource,
} from '../server/acknowledgement-source.js';
import { onRequestPost } from '../functions/api/leads.js';

const encode = (model, id) => btoa(`gid://Jobber/${model}/${id}`);
const submission = 'c39b2580-0e7e-4aba-b19f-6abbd71f7136';
const time = '2026-09-08T02:00:00.000Z';
function database(all = false) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(file => all || file.startsWith('0005_')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return { sqlite, prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const methods = params => ({
      first: async () => stmt.get(...params) || null,
      run: async () => ({ success: true, meta: { changes: Number(stmt.run(...params).changes) } }),
    });
    return { ...methods([]), bind: (...params) => methods(params) };
  } };
}
const lead = (market = 'ut') => ({ market_key: market, submission_id: submission, submitted_at: time, phone: '(801) 555-1212' });
const jobber = (market = 'ut', id = 10) => ({ market_key: market, request_id: encode('Request', id), client_id: encode('Client', 20) });

test('strict NANP normalization rejects extensions, invalid prefixes, international guesses and blank values', () => {
  for (const raw of ['8015551212', '1 (801) 555-1212', '+1 801 555 1212']) assert.equal(normalizeAcknowledgementPhone(raw), '+18015551212');
  for (const raw of ['', null, '+448015551212', '+8015551212', '8015551212x9', '18010551212', '0000000000', '++18015551212', '1+8015551212']) assert.equal(normalizeAcknowledgementPhone(raw), null);
});

test('feature default does not touch D1, while enabled receipts retain exact market identities without raw customer information', async () => {
  assert.equal((await recordWebsiteAcknowledgementSource({}, lead(), jobber())).recorded, false);
  for (const [market, account] of [['ut', 2498432], ['mo_stl', 2498453], ['mo_kc', 1919824]]) {
    const db = database(), env = { ACKNOWLEDGEMENT_SOURCE_ENABLED: 'true', ANGI_ROUTER_DB: db };
    assert.equal((await recordWebsiteAcknowledgementSource(env, lead(market), jobber(market), () => Date.parse(time))).recorded, true);
    const receipt = await readWebsiteAcknowledgementSource(env, encode('Account', account), encode('Request', 10));
    assert.equal(receipt.market_key, market);
    assert.equal(receipt.source_lead_id, `website:${submission}`);
    assert.equal(receipt.phone_sha256, await sourceHash('+18015551212'));
    assert.doesNotMatch(JSON.stringify(receipt), /801|555-1212|firstName|address|email/);
    db.sqlite.close();
  }
});

test('repeat receipts are harmless but a Request, client, source UUID or cross-market identity cannot be replaced', async () => {
  const db = database(), env = { ACKNOWLEDGEMENT_SOURCE_ENABLED: 'true', ANGI_ROUTER_DB: db };
  await recordWebsiteAcknowledgementSource(env, lead(), jobber(), () => Date.parse(time));
  await recordWebsiteAcknowledgementSource(env, lead(), jobber(), () => Date.parse(time) + 1000);
  for (const [l, j] of [
    [{ ...lead(), phone: '8015559999' }, jobber()],
    [lead(), { ...jobber(), client_id: encode('Client', 30) }],
    [{ ...lead(), submission_id: '0f3d8593-6609-4b0c-8336-f91df8bf0e6f' }, jobber()],
    [lead(), jobber('ut', 11)],
    [lead(), jobber('mo_stl')],
  ]) await assert.rejects(() => recordWebsiteAcknowledgementSource(env, l, j, () => Date.parse(time)), /receipt_(conflict|invalid)/);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM acknowledgement_sources').get().n, 1);
  db.sqlite.close();
});

test('receipt persistence failure is contained after Jobber success without disclosing customer fields or exception details', async () => {
  const logs = [], env = { ACKNOWLEDGEMENT_SOURCE_ENABLED: 'true', ANGI_ROUTER_DB: { prepare() { throw Error('secret token / customer number'); } } };
  const result = await recordWebsiteAcknowledgementSourceSafely(env, lead(), jobber(), { error: (...args) => logs.push(args) });
  assert.equal(result.ok, false);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /secret token|customer number|801|555-1212/);
});

test('public forms preserve routing and the success response even when the new receipt table is unavailable', async () => {
  const originalFetch = globalThis.fetch, originalError = console.error;
  try {
    console.error = () => {};
    for (const [market, key, state, zip] of [['ut', 'utah', 'UT', '84101'], ['mo_stl', 'stl', 'MO', '63101'], ['mo_kc', 'kc', 'MO', '64101']]) {
      for (const receiptAvailable of [true, false]) {
        const db = database(true), writes = [];
        db.sqlite.prepare('INSERT INTO angi_router_jobber_auth (account_key, access_token, access_expires_at, updated_at) VALUES (?, ?, ?, ?)').run(key, 'unit-test-token', Date.now() + 3_600_000, time);
        if (!receiptAvailable) db.sqlite.exec('DROP TABLE acknowledgement_sources');
        globalThis.fetch = async (url, options) => {
          assert.equal(url, 'https://api.getjobber.com/api/graphql');
          assert.equal(options.headers.Authorization, 'bearer unit-test-token');
          const body = JSON.parse(options.body); writes.push(body.query);
          if (body.query.includes('clientCreate')) return Response.json({ data: { clientCreate: { client: { id: encode('Client', 20), clientProperties: { nodes: [] } }, userErrors: [] } } });
          if (body.query.includes('requestCreate')) return Response.json({ data: { requestCreate: { request: { id: encode('Request', 10), jobberWebUri: 'https://secure.getjobber.com/work_requests/10' }, userErrors: [] } } });
          throw Error('Unexpected external operation');
        };
        const request = new Request('https://goodattic.energy/api/leads', { method: 'POST', body: JSON.stringify({
          name: 'Test Person', phone: '8015551212', email: 'test@example.invalid', street_address: '1 Test Street',
          city: 'Test City', state, zip, page_market: market, submission_id: 'caller-controlled-not-used',
        }) });
        const response = await onRequestPost({ request, env: { ACKNOWLEDGEMENT_SOURCE_ENABLED: 'true', ANGI_ROUTER_DB: db } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true); assert.equal(body.jobber.market_key, market);
        assert.deepEqual(Object.keys(body).sort(), ['fieldflow', 'ghl', 'jobber', 'message', 'ok']);
        assert.equal(writes.length, 2);
        if (receiptAvailable) {
          const receipt = db.sqlite.prepare('SELECT * FROM acknowledgement_sources').get();
          assert.equal(receipt.market_key, market);
          assert.match(receipt.source_lead_id, /^website:[0-9a-f-]{36}$/);
          assert.doesNotMatch(receipt.source_lead_id, /caller-controlled/);
        }
        db.sqlite.close();
      }
    }
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
});
