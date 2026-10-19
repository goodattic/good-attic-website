import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  proposeCallRequestLineage,
  verifyCallRequestLineage,
  persistCallRequestLineageReview,
  persistVerifiedCallRequestLineage,
} from '../server/call-request-lineage.js';

const id = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const account = id('Account', 2498432);
const client = id('Client', 22);
const original = id('Request', 35017089);
const operational = id('Request', 35017723);
const callAt = '2026-10-12T19:48:00Z';
const origin = {
  account_id: account, market: 'utah', quo_call_id: 'ACclara',
  jobber_request_id: original, jobber_client_id: client, call_started_at_utc: callAt,
};
const sourceRequest = { id: original, account_id: account, client: { id: client }, createdAt: callAt };
const bookedRequest = { id: operational, account_id: account, client: { id: client },
  createdAt: '2026-10-12T19:57:00Z', assessment: { id: id('Assessment', 9) } };
const propose = overrides => proposeCallRequestLineage({
  source: origin, originalRequest: sourceRequest, clientRequests: [sourceRequest, bookedRequest],
  historyComplete: true, ...overrides,
});
const confirm = (proposal, overrides = {}) => verifyCallRequestLineage(proposal, {
  operational_request_id: operational, confirmed_by: 'owner', evidence_ref: 'jobber_request_history_review',
  decision_id: 'review-clara-1', ...overrides,
}, '2026-10-12T20:00:00Z');

function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0017_call_request_lineage.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  };
}

test('Clara-shaped duplicate is proposed and only explicit confirmation becomes a verified link', async () => {
  const proposal = propose();
  assert.equal(proposal.status, 'proposed');
  assert.deepEqual(proposal.candidate_request_ids, [operational]);
  const verification = confirm(proposal);
  assert.equal(verification.ok, true);
  const database = db();
  const saved = await persistVerifiedCallRequestLineage(database, verification);
  assert.equal(saved.ok, true);
  assert.equal(saved.inserted, true);
  assert.equal(saved.link.original_request_id, original);
  assert.equal(saved.link.operational_request_id, operational);
  const audit = database.sqlite.prepare('SELECT * FROM call_request_lineage_reviews').get();
  assert.equal(audit.decision, 'verified');
  assert.equal(audit.reason, 'explicit_confirmation');
  assert.deepEqual(JSON.parse(audit.candidate_request_ids_json), [operational]);
  assert.equal((await persistVerifiedCallRequestLineage(database, verification)).inserted, false);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_request_lineage_reviews').get().n, 1);
});

test('missing history, wrong account or Client, and missing original proof cannot be promoted', () => {
  for (const [input, reason] of [
    [{ historyComplete: false }, 'jobber_request_history_incomplete'],
    [{ originalRequest: { ...sourceRequest, account_id: id('Account', 2498453) } }, 'original_request_identity_conflict'],
    [{ originalRequest: { ...sourceRequest, client: { id: id('Client', 23) } } }, 'original_request_identity_conflict'],
    [{ clientRequests: [sourceRequest, { ...bookedRequest, account_id: id('Account', 2498453) }] }, 'candidate_identity_or_time_incomplete'],
    [{ clientRequests: [sourceRequest, { ...bookedRequest, client: { id: id('Client', 23) } }] }, 'candidate_identity_or_time_incomplete'],
    [{ source: { ...origin, jobber_client_id: null } }, 'call_origin_identity_incomplete'],
    [{ source: { ...origin, market: 'stl' } }, 'call_origin_identity_incomplete'],
  ]) {
    const proposal = propose(input);
    assert.equal(proposal.status, 'manual_review');
    assert.equal(proposal.reason, reason);
    assert.equal(confirm(proposal).ok, false);
  }
});

test('one Client with two plausible operational Requests stays ambiguous', () => {
  const other = { ...bookedRequest, id: id('Request', 35018000), createdAt: '2026-10-12T20:12:00Z' };
  const proposal = propose({ clientRequests: [sourceRequest, bookedRequest, other] });
  assert.equal(proposal.status, 'manual_review');
  assert.equal(proposal.reason, 'multiple_operational_request_candidates');
  assert.equal(confirm(proposal).reason, 'ambiguous_candidates_require_explicit_review');
  assert.equal(confirm(proposal, { ambiguity_reviewed: true }).ok, true);
  assert.equal(confirm(proposal, { operational_request_id: id('Request', 999), ambiguity_reviewed: true }).ok, false);
});

test('a candidate proposal and ambiguous case are durable review records, without a verified link', async () => {
  const database = db();
  const proposal = propose();
  const review = { decision_id: 'proposal-clara-1', recorded_at: '2026-10-12T19:59:00Z' };
  assert.deepEqual(await persistCallRequestLineageReview(database, proposal, review), { ok: true, inserted: true });
  assert.deepEqual(await persistCallRequestLineageReview(database, proposal, review), { ok: true, inserted: false });
  const other = { ...bookedRequest, id: id('Request', 35018000) };
  const ambiguous = propose({ clientRequests: [sourceRequest, bookedRequest, other] });
  assert.equal((await persistCallRequestLineageReview(database, ambiguous,
    { decision_id: 'ambiguity-clara-1', recorded_at: '2026-10-12T20:01:00Z' })).ok, true);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_request_lineage_links').get().n, 0);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_request_lineage_reviews').get().n, 2);
  assert.equal(database.sqlite.prepare("SELECT decision FROM call_request_lineage_reviews WHERE decision_id='ambiguity-clara-1'").get().decision, 'manual_review');
  assert.equal((await persistCallRequestLineageReview(database, ambiguous, review)).reason, 'review_identity_conflict');
});

test('an old Request, a Request without a milestone, and a live original Request do not create a transfer', () => {
  assert.equal(propose({ clientRequests: [sourceRequest, { ...bookedRequest, createdAt: '2026-09-01T00:00:00Z' }] }).status, 'no_link');
  assert.equal(propose({ clientRequests: [sourceRequest, { ...bookedRequest, assessment: null }] }).status, 'no_link');
  assert.equal(propose({ originalRequest: { ...sourceRequest, assessment: { id: 'a' } }, clientRequests: [sourceRequest] }).status, 'same_request');
  assert.equal(propose({ originalRequest: { ...sourceRequest, assessment: { id: 'a' } } }).status, 'proposed');
});

test('missing or ambiguous confirmation cannot produce a durable link', async () => {
  const proposal = propose();
  for (const patch of [
    { confirmed_by: '' }, { evidence_ref: '' }, { decision_id: '' },
    { operational_request_id: id('Request', 999) },
  ]) assert.equal(confirm(proposal, patch).ok, false);
  const database = db();
  assert.equal((await persistVerifiedCallRequestLineage(database, { ok: false })).ok, false);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_request_lineage_links').get().n, 0);
});

test('conflicting links cannot silently replace one another and verified evidence is immutable', async () => {
  const database = db();
  const first = confirm(propose());
  assert.equal((await persistVerifiedCallRequestLineage(database, first)).ok, true);
  const changedTarget = confirm(propose({ clientRequests: [sourceRequest, { ...bookedRequest, id: id('Request', 35018000) }] }), {
    operational_request_id: id('Request', 35018000), decision_id: 'review-clara-2',
  });
  assert.equal((await persistVerifiedCallRequestLineage(database, changedTarget)).reason, 'lineage_link_conflict');
  const competingCall = confirm(propose({ source: { ...origin, quo_call_id: 'ACnext' } }), { decision_id: 'review-next' });
  assert.equal((await persistVerifiedCallRequestLineage(database, competingCall)).reason, 'lineage_link_conflict');
  assert.throws(() => database.sqlite.exec("UPDATE call_request_lineage_links SET evidence_ref='changed'"), /lineage_link_immutable/);
  assert.throws(() => database.sqlite.exec('DELETE FROM call_request_lineage_reviews'), /lineage_review_immutable/);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_request_lineage_links').get().n, 1);
});
