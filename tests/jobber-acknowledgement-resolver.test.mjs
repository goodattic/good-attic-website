import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJobberAcknowledgementResolve, resolveAcknowledgementEligibility, _private } from '../server/jobber-acknowledgement-resolver.js';
import { sourceHash } from '../server/acknowledgement-source.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

const encode = (type, id) => btoa(`gid://Jobber/${type}/${id}`);
const time = '2026-09-08T02:00:00.000Z';
const now = Date.parse(time) + 60_000;
const secret = 'unit-test-acknowledgement-broker-secret';
const cert = 'a89c0a6169eff7dc2ad9b4f6eb0c197671182b06';
const route = getJobberOAuthRoute('ut', 'website');
const env = receipt => ({ ANGI_ROUTER_DB: { prepare() { return { bind: () => ({ first: async () => receipt || null }) }; } } });
function note(overrides = {}) {
  return { __typename: 'RequestNote', id: encode('RequestNote', 30), createdAt: time,
    message: `Trusted Form: https://cert.trustedform.com/${cert}`,
    createdBy: { __typename: 'Application', id: encode('Application', 152570), name: 'Angi' }, ...overrides };
}
function record(overrides = {}) {
  return { id: encode('Request', 10), createdAt: time, jobberWebUri: 'https://secure.getjobber.com/work_requests/10',
    source: 'Angi', phone: '(801) 555-1212', client: { id: encode('Client', 20), firstName: 'Jamie',
      phones: [{ number: '8015551212', normalizedPhoneNumber: '+18015551212', primary: true, smsAllowed: true }] },
    notes: { nodes: [note()], pageInfo: { hasNextPage: false } }, ...overrides };
}
async function receipt(overrides = {}) {
  return { account_id: route.expectedAccountId, request_id: encode('Request', 10), client_id: encode('Client', 20),
    market_key: 'ut', source_kind: 'website', source_lead_id: 'website:c39b2580-0e7e-4aba-b19f-6abbd71f7136',
    source_created_at: time, phone_sha256: await sourceHash('+18015551212'), recorded_at: time, ...overrides };
}
const resolve = (r, stored = null, at = now, useRoute = route) => resolveAcknowledgementEligibility(env(stored), useRoute, r, at);

test('native Angi is proven by its exact app-authored Request note in Utah and STL, and a repeated certificate shares a source identity', async () => {
  const first = await resolve(record());
  assert.equal(first.eligibility, 'eligible'); assert.equal(first.sourceKind, 'angi');
  assert.equal(first.sourceLeadId, `trustedform:${await sourceHash(`https://cert.trustedform.com/${cert}`)}`);
  assert.equal(first.sourceCreatedAt, time);
  const next = await resolve(record({ id: encode('Request', 11), notes: { nodes: [note(), note({ id: encode('RequestNote', 31) })], pageInfo: { hasNextPage: false } } }));
  assert.equal(next.sourceLeadId, first.sourceLeadId);
  assert.equal((await resolve(record(), null, now, getJobberOAuthRoute('mo_stl'))).eligibility, 'eligible');
  assert.equal((await resolve(record(), null, now, getJobberOAuthRoute('mo_kc'))).reason, 'angi_market_not_enabled');
});

test('copied, inherited, wrongly authored or label-only Angi material cannot authorize a customer message', async () => {
  for (const forged of [
    note({ __typename: 'ClientNote' }),
    note({ createdBy: { __typename: 'User', id: encode('User', 1), name: 'Angi' } }),
    note({ createdBy: { __typename: 'Application', id: encode('Application', 1), name: 'Angi' } }),
    note({ message: `Trusted Form: https://cert.trustedform.com.evil.test/${cert}` }),
    note({ message: `Trusted Form: https://cert.trustedform.com/${cert}?copy=1` }),
  ]) assert.equal((await resolve(record({ notes: { nodes: [forged], pageInfo: { hasNextPage: false } } }))).eligibility, 'held');
  const manual = record({ source: 'Jobber' }); manual.client.leadSource = 'Angi';
  assert.equal((await resolve(manual)).eligibility, 'suppressed');
});

test('old notes, multiple distinct certificates, partial pagination and malformed provenance hold instead of choosing a convenient proof', async () => {
  for (const [r, reason] of [
    [record({ notes: { nodes: [note({ createdAt: '2026-09-07T02:00:00Z' })], pageInfo: { hasNextPage: false } } }), 'angi_note_time_or_identity_invalid'],
    [record({ notes: { nodes: [note(), note({ message: `Trusted Form: https://cert.trustedform.com/${'b'.repeat(40)}` })], pageInfo: { hasNextPage: false } } }), 'angi_multiple_source_certificates'],
    [record({ notes: { nodes: [note()], pageInfo: { hasNextPage: true } } }), 'angi_notes_incomplete'],
    [record({ notes: { nodes: [note(), note({ message: 'Trusted Form: https://invalid.example/test' })], pageInfo: { hasNextPage: false } } }), 'angi_source_certificate_invalid'],
    [record({ notes: null }), 'angi_note_response_invalid'],
  ]) assert.equal((await resolve(r)).reason, reason);
});

test('website receipt, rather than a source label, attests automatic intake; Google routing preserves website identity', async () => {
  for (const source of ['Good Attic Website Leads', 'Good Attic Google Leads', 'changed client marketing label']) {
    const result = await resolve(record({ source }), await receipt());
    assert.equal(result.eligibility, 'eligible'); assert.equal(result.sourceKind, 'website');
    assert.match(result.sourceLeadId, /^website:/);
  }
  for (const source of ['Jobber', 'Website', 'Google', 'Manual']) {
    const r = record({ source }); r.client.leadSource = 'Good Attic Website Leads';
    assert.equal((await resolve(r)).eligibility, 'suppressed');
  }
  const fresh = await resolve(record({ source: 'Good Attic Website Leads' }));
  assert.equal(fresh.reason, 'website_attestation_pending'); assert.equal(fresh.retryable, true);
  const expired = await resolve(record({ source: 'Good Attic Website Leads' }), null, now + 300_000);
  assert.equal(expired.reason, 'website_attestation_missing'); assert.equal(expired.retryable, false);
});

test('website receipts cannot be adopted across accounts, clients, Requests, markets, or changed customer phones', async () => {
  for (const patch of [
    { account_id: encode('Account', 2498453) }, { client_id: encode('Client', 21) },
    { request_id: encode('Request', 11) }, { market_key: 'mo_stl' },
    { source_lead_id: 'website:editable-label' }, { source_created_at: '2026-09-07T00:00:00Z' },
  ]) assert.equal((await resolve(record(), await receipt(patch))).reason, 'website_receipt_identity_conflict');
  assert.equal((await resolve(record(), await receipt({ phone_sha256: await sourceHash('+18015559999') }))).reason, 'website_receipt_phone_mismatch');
});

test('ambiguous or contradictory phones hold, and Jobber SMS capability is never misrepresented as a customer preference', async () => {
  const blocked = record(); blocked.client.phones[0].smsAllowed = false;
  const result = await resolve(blocked);
  assert.equal(result.eligibility, 'eligible'); assert.equal(result.smsAllowed, false); assert.equal(result.smsPreference, 'unknown');
  const variants = [
    record({ phone: '8015551212 ext 9' }),
    record({ phone: '+18015559999' }),
    record({ phone: null, client: { ...record().client, phones: [] } }),
    record({ phone: null, client: { ...record().client, phones: [...record().client.phones, { number: '8015559999', normalizedPhoneNumber: '+18015559999', primary: true, smsAllowed: true }] } }),
    record({ client: { ...record().client, phones: [{ ...record().client.phones[0], normalizedPhoneNumber: '+18015559999' }] } }),
    record({ client: { ...record().client, phones: [{ ...record().client.phones[0], number: '8015551212 ext 9' }] } }),
  ];
  for (const variant of variants) assert.equal((await resolve(variant)).eligibility, 'held');
});

function context(account = 2498432, extra = {}) {
  return { env: { ...env(null), CONTACT_SYNC_BROKER_SECRET: secret }, request: new Request('https://site.test/api/jobber/acknowledgement-resolve', {
    method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ account_id: encode('Account', account), request_id: encode('Request', 10), ...extra }),
  }) };
}
function dependencies(r = record(), account = 2498432, calls = []) {
  return { now: () => now,
    refreshJobberAccessToken: async (_env, route) => { calls.push(route); return { accessToken: 'must-never-leak' }; },
    jobberGraphql: async (_env, _token, query) => { assert.equal(query, _private.QUERY); assert.doesNotMatch(query, /mutation|leadSource/); return { data: { account: { id: encode('Account', account) }, request: r } }; },
  };
}

test('private broker uses the existing exact account authority and returns only narrow source facts', async () => {
  for (const [account, market, key] of [[2498432, 'utah', 'ut'], [2498453, 'stl', 'mo_stl'], [1919824, 'kc', 'mo_kc']]) {
    const calls = [], response = await handleJobberAcknowledgementResolve(context(account), dependencies(record(), account, calls));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.market, market); assert.equal(calls[0].marketKey, key);
    assert.equal(body.request.phone, '+18015551212'); assert.equal(body.request.firstName, 'Jamie');
    assert.doesNotMatch(JSON.stringify(body), /must-never-leak|Trusted Form|createdBy|notes|client\.leadSource/);
  }
});

test('authorization, arbitrary-query, cross-account, wrong-object and mismatched-link inputs never return eligible data', async () => {
  const unauthorized = context(); unauthorized.request.headers.delete('authorization');
  assert.equal((await handleJobberAcknowledgementResolve(unauthorized, dependencies())).status, 401);
  assert.equal((await handleJobberAcknowledgementResolve(context(2498432, { query: 'mutation Bad' }), dependencies())).status, 400);
  assert.equal((await handleJobberAcknowledgementResolve(context(999), dependencies())).status, 400);
  for (const [r, account, status] of [
    [record(), 2498453, 409], [record({ id: encode('Request', 11) }), 2498432, 409],
    [record({ jobberWebUri: 'https://secure.getjobber.com/work_requests/11' }), 2498432, 502],
    [record({ jobberWebUri: 'https://secure.getjobber.com.evil.test/work_requests/10' }), 2498432, 502],
  ]) assert.equal((await handleJobberAcknowledgementResolve(context(), dependencies(r, account))).status, status);
  const missingDb = context(); missingDb.env.ANGI_ROUTER_DB.prepare = () => { throw Error('secret database error'); };
  const failed = await handleJobberAcknowledgementResolve(missingDb, dependencies());
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /secret database/);
});
