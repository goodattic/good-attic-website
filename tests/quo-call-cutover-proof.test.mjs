import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/jobber/quo-intake-cutover-proof.js';

const NONCE = '6e282ebb-4f56-4e85-90a4-955989811430';
const makeRequest = (secret = 'proof-secret', body = { nonce: NONCE }) => new Request(
  'https://goodattic.energy/api/jobber/quo-intake-cutover-proof', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify(body),
  },
);
function fixture({ flag = 'false', pending = 0, failure = false } = {}) {
  const queries = [];
  const db = { prepare(sql) {
    queries.push(sql);
    return { async first() {
      if (failure) throw Error('D1 unavailable');
      return { count: pending };
    } };
  } };
  return { env: { PHONE_STAGE_CUTOVER_SECRET: 'proof-secret', QUO_CALL_AUTO_REQUEST_ENABLED: flag,
    ANGI_ROUTER_DB: db }, queries };
}

test('cutover proof requires the dedicated secret before reading D1', async () => {
  const f = fixture();
  const missing = await onRequestPost({ request: makeRequest(), env: { ...f.env, PHONE_STAGE_CUTOVER_SECRET: undefined } });
  assert.equal(missing.status, 503);
  const wrong = await onRequestPost({ request: makeRequest('wrong'), env: f.env });
  assert.equal(wrong.status, 401);
  assert.deepEqual(f.queries, []);
});

test('proof reflects the live Pages call flag and durable in-flight count, without customer data', async () => {
  const now = Date.parse('2026-10-05T18:00:00Z');
  for (const { flag, pending } of [{ flag: 'true', pending: 0 }, { flag: 'false', pending: 2 },
    { flag: 'false', pending: 0 }]) {
    const f = fixture({ flag, pending });
    const response = await onRequestPost({ request: makeRequest(), env: f.env }, { now: () => now });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body, { ok: true, service: 'good-attic-website-quo-intake', nonce: NONCE,
      call_auto_request_enabled: flag !== 'false', in_flight_broker_writes: pending,
      verified_at: '2026-10-05T18:00:00.000Z' });
    assert.equal(f.queries.length, 1);
    assert.match(f.queries[0], /quo_intake_operations/);
    assert.doesNotMatch(f.queries[0], /operation_kind/);
    assert.doesNotMatch(JSON.stringify(body), /phone|client|request_id|caller/i);
  }
});

test('invalid nonce or unavailable D1 cannot produce a ready cutover proof', async () => {
  const f = fixture();
  assert.equal((await onRequestPost({ request: makeRequest('proof-secret', { nonce: 'guess' }), env: f.env })).status, 400);
  assert.deepEqual(f.queries, []);
  const down = fixture({ failure: true });
  const response = await onRequestPost({ request: makeRequest(), env: down.env });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});
