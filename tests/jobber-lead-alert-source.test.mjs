import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLeadAlertSource } from '../server/jobber-lead-alert-source.js';
import { sourceHash } from '../server/acknowledgement-source.js';
import { resolveAcknowledgementEligibility } from '../server/jobber-acknowledgement-resolver.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

const id = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const createdAt = '2026-10-14T20:00:00.000Z';
const now = Date.parse(createdAt) + 60_000;
const certificate = 'b'.repeat(40);
const routes = Object.fromEntries(['ut', 'mo_stl', 'mo_kc'].map(key => [key, getJobberOAuthRoute(key)]));
const markets = { ut: ['utah', 'PNqw8amabk', '+13853364442'], mo_stl: ['stl', 'PN6LVKAV9A', '+13149312620'], mo_kc: ['kc', 'PNZBZnj8mz', '+18164340308'] };

function request(overrides = {}) {
  return { id: id('Request', 10), createdAt, source: 'Jobber', phone: '+18015551212',
    client: { id: id('Client', 20), phones: [{ number: '8015551212', normalizedPhoneNumber: '+18015551212', primary: true, smsAllowed: true }] },
    notes: { nodes: [], pageInfo: { hasNextPage: false } }, ...overrides };
}
function note(overrides = {}) {
  return { __typename: 'RequestNote', id: id('RequestNote', 30), createdAt,
    message: `Trusted Form: https://cert.trustedform.com/${certificate}`,
    createdBy: { __typename: 'Application', id: id('Application', 152570), name: 'Angi' }, ...overrides };
}
async function receipt(route, overrides = {}) {
  return { account_id: route.expectedAccountId, request_id: id('Request', 10), client_id: id('Client', 20),
    market_key: route.marketKey, source_kind: 'website',
    source_lead_id: 'website:c39b2580-0e7e-4aba-b19f-6abbd71f7136', source_created_at: createdAt,
    phone_sha256: await sourceHash('+18015551212'), recorded_at: createdAt, ...overrides };
}
function quoRow(route, overrides = {}) {
  const [market, phoneNumberId, to] = markets[route.marketKey];
  return { operation_id: 'quo-fixture', operation_kind: 'intake', operation_state: 'completed',
    account_id: route.expectedAccountId, market, phone: '+18015551212', phone_number_id: phoneNumberId,
    client_id: id('Client', 20), request_id: id('Request', 10),
    source_json: JSON.stringify({ type: 'call', id: 'CAfixture', from: '+18015551212', to, occurred_at: createdAt }), ...overrides };
}
function environment(stored = null, rows = []) {
  return { ANGI_ROUTER_DB: { prepare() { return { bind() { return {
    first: async () => stored, all: async () => ({ success: true, results: rows }),
  }; } }; } } };
}
const classify = (route, record, stored = null, rows = [], at = now) =>
  resolveLeadAlertSource(environment(stored, rows), route, record, at);

test('exact server receipt verifies a website form in every market despite changed Jobber phone or display labels', async () => {
  for (const route of Object.values(routes)) {
    const form = await receipt(route);
    const changed = request({ source: 'Jobber', phone: '+18015559999', client: {
      ...request().client, phones: [{ number: '8015559999', normalizedPhoneNumber: '+18015559999', primary: true, smsAllowed: true }],
    } });
    const proof = await classify(route, changed, form);
    assert.deepEqual(proof, { state: 'verified', kind: 'website', reason: 'website_receipt_verified',
      retryable: false, sourceLeadId: form.source_lead_id, sourceCreatedAt: createdAt });
    assert.equal((await classify(route, changed, { ...form, phone_sha256: null })).state, 'verified',
      'a server-written receipt can prove a form even when phone was unsuitable for a welcome SMS');
    const welcome = await resolveAcknowledgementEligibility(environment(form), route, changed, now);
    assert.equal(welcome.reason, 'website_receipt_phone_mismatch', 'internal source proof must not loosen customer welcome rules');
  }
});

test('receipt identity mismatch and conflicting Quo operation hold before any internal lead text', async () => {
  const route = routes.ut, form = await receipt(route);
  for (const patch of [{ account_id: routes.mo_stl.expectedAccountId }, { client_id: id('Client', 21) },
    { request_id: id('Request', 11) }, { market_key: 'mo_stl' }, { source_lead_id: 'website:editable' },
    { phone_sha256: 'invalid' }, { source_created_at: '2026-10-13T20:00:00Z' }]) {
    const result = await classify(route, request(), { ...form, ...patch });
    assert.equal(result.state, 'held'); assert.equal(result.kind, null);
  }
  const conflict = await classify(route, request(), form, [quoRow(route)]);
  assert.equal(conflict.state, 'held'); assert.equal(conflict.reason, 'source_identity_conflict');
});

test('verified Quo intake suppresses a Request even when its shared app label says Website', async () => {
  for (const route of Object.values(routes)) {
    const record = request({ source: 'Good Attic Website Leads' });
    const proof = await classify(route, record, null, [quoRow(route)]);
    assert.equal(proof.state, 'suppressed'); assert.equal(proof.reason, 'verified_quo_phone_intake');
    const malformed = await classify(route, record, null, [quoRow(route, { client_id: id('Client', 21) })]);
    assert.equal(malformed.state, 'held'); assert.equal(malformed.reason, 'source_identity_conflict');
  }
});

test('native app-authored Angi Request proves internal lead source in all markets while KC welcome remains excluded', async () => {
  for (const route of Object.values(routes)) {
    const record = request({ source: 'Angi', notes: { nodes: [note()], pageInfo: { hasNextPage: false } } });
    const proof = await classify(route, record);
    assert.equal(proof.state, 'verified'); assert.equal(proof.kind, 'angi');
    assert.match(proof.sourceLeadId, /^trustedform:[0-9a-f]{64}$/);
    if (route.marketKey === 'mo_kc') {
      const welcome = await resolveAcknowledgementEligibility(environment(), route, record, now);
      assert.equal(welcome.reason, 'angi_market_not_enabled');
    }
  }
});

test('Angi labels or copied notes cannot verify a lead, but a late app note can still arrive during grace', async () => {
  const route = routes.ut;
  const missing = await classify(route, request({ source: 'Angi' }));
  assert.equal(missing.state, 'pending'); assert.equal(missing.retryable, true);
  assert.equal((await classify(route, request({ source: 'Angi' }), null, [], now + 300_000)).state, 'held');
  for (const forged of [note({ __typename: 'ClientNote' }),
    note({ createdBy: { __typename: 'User', id: id('User', 2), name: 'Angi' } }),
    note({ message: `Trusted Form: https://cert.trustedform.com/${certificate}?copy=1` })]) {
    const proof = await classify(route, request({ source: 'Angi', notes: { nodes: [forged], pageInfo: { hasNextPage: false } } }));
    assert.notEqual(proof.state, 'verified');
  }
  const manualWithAngiMarketingLabel = request(); manualWithAngiMarketingLabel.client.leadSource = 'Angi';
  assert.equal((await classify(route, manualWithAngiMarketingLabel, null, [], now + 300_000)).state, 'suppressed');
});

test('all new unproven Requests wait briefly for website receipt, then manual Requests suppress', async () => {
  const route = routes.ut;
  const fresh = await classify(route, request());
  assert.deepEqual(fresh, { state: 'pending', kind: null, reason: 'source_proof_pending',
    retryable: true, sourceLeadId: null, sourceCreatedAt: null });
  const old = await classify(route, request(), null, [], now + 300_000);
  assert.equal(old.state, 'suppressed'); assert.equal(old.reason, 'not_verified_automatic_intake');
  const websiteLabel = await classify(route, request({ source: 'Good Attic Website Leads' }), null, [], now + 300_000);
  assert.equal(websiteLabel.state, 'held'); assert.equal(websiteLabel.reason, 'website_attestation_missing');
});
