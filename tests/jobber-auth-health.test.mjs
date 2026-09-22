import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJobberAuthHealth } from '../server/jobber-auth-health.js';

const env = { CONTACT_SYNC_BROKER_SECRET: 'broker-secret' };
const request = (body, auth = 'broker-secret') => new Request('https://goodattic.energy/api/jobber/oauth/health', { method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const account = 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==';

test('auth health requires the broker secret and validates the market', async () => {
  assert.equal((await handleJobberAuthHealth({ request: request({ market: 'stl' }, 'wrong'), env })).status, 401);
  assert.equal((await handleJobberAuthHealth({ request: request({ market: 'unknown' }), env })).status, 400);
});

test('auth health performs only a read-only account check', async () => {
  let refreshed = 0; let queried = 0;
  const response = await handleJobberAuthHealth({ request: request({ market: 'stl' }), env }, {
    refreshJobberAccessToken: async () => { refreshed += 1; return { accessToken: 'token' }; },
    jobberGraphql: async (_env, token, query, variables) => { queried += 1; assert.equal(token, 'token'); assert.match(query, /account/); assert.deepEqual(variables, {}); return { data: { account: { id: account } } }; },
  });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, healthy: true, market: 'stl', account_id: account });
  assert.equal(refreshed, 1); assert.equal(queried, 1);
});

test('auth health converts refresh failures into a sanitized unhealthy result', async () => {
  const response = await handleJobberAuthHealth({ request: request({ market: 'utah' }), env }, { refreshJobberAccessToken: async () => { const error = new Error('secret details'); error.code = 'jobber_refresh_response_unknown'; throw error; } });
  assert.deepEqual(await response.json(), { ok: true, healthy: false, market: 'utah', code: 'jobber_refresh_response_unknown' });
});
