import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  MANUAL_JOBBER_QUERIES, manualConversationEligible, resolveManualJobberRequest,
  persistManualCallLink, claimQualifiedPhoneRequest,
} from '../server/qualified-phone-manual-match.js';

const id = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const accountId = id('Account', 2498432);
const clientId = id('Client', 100);
const requestId = id('Request', 200);
const callAt = '2026-09-25T14:30:19Z';
const phone = '+18015551234';
const secondaryPhones = [
  { number: '(385) 555-1212', normalizedPhoneNumber: '+13855551212' },
  { number: '(801) 555-1234', normalizedPhoneNumber: phone },
];

function fixture(overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE acknowledgement_sources(account_id TEXT,request_id TEXT,source_kind TEXT);
    CREATE TABLE closed_loop_stage1_leads(market_key TEXT,request_id TEXT);
    CREATE TABLE closed_loop_leads(jobber_request_id TEXT);
    CREATE TABLE closed_loop_lead_dispositions(market_key TEXT,request_id TEXT,disposition TEXT);
    CREATE TABLE quo_intake_operations(account_id TEXT,request_id TEXT,operation_kind TEXT,operation_id TEXT);
    CREATE TABLE quo_call_attributions(account_id TEXT,quo_call_id TEXT,market TEXT,caller_phone TEXT,
      destination_number TEXT,direction TEXT,jobber_request_id TEXT,jobber_client_id TEXT,updated_at TEXT);
    CREATE TABLE qualified_phone_calls(google_resource TEXT PRIMARY KEY,outcome_id TEXT,state TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE google_ads_outcome_outbox(outcome_id TEXT PRIMARY KEY,market_key TEXT,jobber_request_id TEXT,
      quo_call_id TEXT,attribution_path TEXT,event_name TEXT);`);
  sqlite.exec(readFileSync(new URL('../migrations/0020_qualified_phone_request_claims.sql', import.meta.url), 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: result.changes } }; },
      };
    },
  };
  const state = {
    clients: [{ id: clientId, isArchived: false }],
    phones: secondaryPhones.map(item => ({ ...item })),
    requests: [{ id: requestId, createdAt: '2026-09-25T15:00:00Z' }],
    jobs: [], source: null, requestStatus: 'new', requestClientArchived: false,
    accountId, notes: [], notesHasNextPage: false,
    ...overrides,
  };
  const read = async (query, variables) => {
    const account = { id: state.accountId };
    if (query === MANUAL_JOBBER_QUERIES.phones) return { account, clientPhones: {
      nodes: state.clients.map(client => ({ number: phone, normalizedPhoneNumber: phone, client })),
      pageInfo: { hasNextPage: false, endCursor: null },
    } };
    if (query === MANUAL_JOBBER_QUERIES.client) return { account, client: {
      id: variables.id, isArchived: false, phones: state.phones,
    } };
    if (query === MANUAL_JOBBER_QUERIES.requests) return { account, client: {
      id: variables.id, isArchived: false, requests: { nodes: state.requests, pageInfo: { hasNextPage: false, endCursor: null } },
    } };
    if (query === MANUAL_JOBBER_QUERIES.jobs) return { account, client: {
      id: variables.id, isArchived: false, jobs: { nodes: state.jobs, pageInfo: { hasNextPage: false, endCursor: null } },
    } };
    if (query === MANUAL_JOBBER_QUERIES.request) {
      const request = state.requests.find(row => row.id === variables.id);
      return { account, request: request && { ...request, source: state.source, requestStatus: state.requestStatus,
        client: { id: clientId, isArchived: state.requestClientArchived, phones: state.phones },
        notes: { nodes: state.notes, pageInfo: { hasNextPage: state.notesHasNextPage } },
      } };
    }
    throw Error('unexpected_query');
  };
  return { db, sqlite, state, read, resolve: () => resolveManualJobberRequest({
    callerPhone: phone, callAt, marketKey: 'ut', accountId, read, db,
  }) };
}

test('manual conversation requires an answered Quo call of at least 60 seconds', () => {
  const quo = { final_status: 'completed', duration_seconds: 60,
    call_started_at_utc: '2026-09-25T14:30:19Z', answered_at: '2026-09-25T14:30:20Z' };
  const google = { call_status: 'RECEIVED' };
  assert.equal(manualConversationEligible(quo, google).ok, true);
  assert.equal(manualConversationEligible({ ...quo, duration_seconds: 59 }, google).reason, 'manual_call_under_60s');
  assert.equal(manualConversationEligible({ ...quo, final_status: 'no-answer' }, google).reason, 'manual_call_not_answered');
  assert.equal(manualConversationEligible({ ...quo, answered_at: null }, google).reason, 'answered_unverified');
  assert.equal(manualConversationEligible({ ...quo, answered_at: '2026-09-25T14:30:18Z' }, google).reason, 'answered_unverified');
  assert.equal(manualConversationEligible(quo, { call_status: 'MISSED' }).reason, 'google_call_not_received');
});

test('archived or junk Request status and archived Request client are held', async () => {
  const f = fixture();
  for (const status of ['archived', 'junk', 'spam', 'deleted']) {
    f.state.requestStatus = status;
    assert.equal((await f.resolve()).reason, 'jobber_request_archived_or_junk');
  }
  f.state.requestStatus = null;
  assert.equal((await f.resolve()).reason, 'jobber_request_status_missing');
  f.state.requestStatus = 'new';
  f.state.requestClientArchived = true;
  assert.equal((await f.resolve()).reason, 'jobber_client_archived');
});

test('manual Request matches a secondary Client phone, with normalized identity and Request time', async () => {
  const f = fixture();
  // The direct Client query intentionally selects the live-proven `number`
  // field only; index rows carry Jobber's normalizedPhoneNumber separately.
  f.state.phones = f.state.phones.map(({ number }) => ({ number }));
  const result = await f.resolve();
  assert.equal(result.ok, true);
  assert.equal(result.manual, true);
  assert.equal(result.record.jobber_request_id, requestId);
  assert.equal(result.record.jobber_client_id, clientId);
  assert.equal(result.record.created_at, '2026-09-25T15:00:00.000Z');
});

test('manual Request window includes call start through exactly +7 days, but never earlier Requests', async () => {
  const f = fixture({ requests: [{ id: requestId, createdAt: '2026-10-02T14:30:19Z' }] });
  assert.equal((await f.resolve()).ok, true);
  f.state.requests[0].createdAt = '2026-10-02T14:30:20Z';
  assert.equal((await f.resolve()).reason, 'awaiting_manual_request');
  f.state.requests[0].createdAt = '2026-09-25T14:30:19Z';
  assert.equal((await f.resolve()).ok, true);
  f.state.requests[0].createdAt = '2026-09-25T14:30:18Z';
  assert.equal((await f.resolve()).reason, 'prior_request_requires_review');
});

test('missing or competing Request, shared phone, prior work, and incomplete history are held', async () => {
  const f = fixture();
  f.state.requests = [];
  assert.equal((await f.resolve()).reason, 'awaiting_manual_request');
  f.state.requests = [{ id: requestId, createdAt: '2026-09-25T15:00:00Z' },
    { id: id('Request', 201), createdAt: '2026-09-25T15:02:00Z' }];
  assert.equal((await f.resolve()).reason, 'ambiguous_jobber_request');
  f.state.requests.pop();
  f.state.clients.push({ id: id('Client', 101), isArchived: false });
  assert.equal((await f.resolve()).reason, 'jobber_shared_phone');
  f.state.clients.pop();
  f.state.jobs = [{ id: id('Job', 300), createdAt: '2026-09-24T15:00:00Z' }];
  assert.equal((await f.resolve()).reason, 'prior_job_requires_review');
  f.state.jobs = [{ id: id('Job', 300), createdAt: null }];
  assert.equal((await f.resolve()).reason, 'jobber_history_incomplete');
});

test('website/Angi source, website ledger, excluded lead, wrong account, and conflicting phone hold', async () => {
  const f = fixture();
  f.state.source = 'Angi Leads';
  assert.equal((await f.resolve()).reason, 'request_other_intake_source');
  f.state.source = null;
  f.state.notes = [{ __typename: 'RequestNote', createdBy: {
    __typename: 'Application', id: id('Application', 152570),
  } }];
  assert.equal((await f.resolve()).reason, 'request_other_intake_source');
  f.state.notes = [];
  f.state.notesHasNextPage = true;
  assert.equal((await f.resolve()).reason, 'jobber_request_notes_incomplete');
  f.state.notesHasNextPage = false;
  f.sqlite.prepare('INSERT INTO closed_loop_stage1_leads VALUES(?,?)').run('ut', requestId);
  assert.equal((await f.resolve()).reason, 'request_other_intake_source');
  f.sqlite.prepare('DELETE FROM closed_loop_stage1_leads').run();
  f.sqlite.prepare('INSERT INTO closed_loop_leads VALUES(?)').run(requestId);
  assert.equal((await f.resolve()).reason, 'request_other_intake_source');
  f.sqlite.prepare('DELETE FROM closed_loop_leads').run();
  f.sqlite.prepare('INSERT INTO closed_loop_lead_dispositions VALUES(?,?,?)').run('ut', requestId, 'test_excluded');
  assert.equal((await f.resolve()).reason, 'jobber_lead_excluded');
  f.sqlite.prepare('DELETE FROM closed_loop_lead_dispositions').run();
  f.state.source = 'Quo';
  assert.equal((await f.resolve()).ok, true);
  f.sqlite.prepare('INSERT INTO quo_intake_operations VALUES(?,?,?,?)').run(accountId, requestId, 'intake', 'old-auto-create');
  assert.equal((await f.resolve()).reason, 'request_auto_quo_intake');
  f.sqlite.prepare('DELETE FROM quo_intake_operations').run();
  f.state.source = null;
  f.state.accountId = id('Account', 2498453);
  assert.equal((await f.resolve()).reason, 'jobber_account_mismatch');
  f.state.accountId = accountId;
  f.state.phones[1] = { number: '(801) 555-1234', normalizedPhoneNumber: '+18015559999' };
  assert.equal((await f.resolve()).reason, 'jobber_phone_identity_conflict');
});

test('guarded ledger link never overwrites another Request and repeated delivery is idempotent', async () => {
  const f = fixture();
  f.sqlite.prepare('INSERT INTO quo_call_attributions VALUES(?,?,?,?,?,?,?,?,?)').run(
    accountId, 'quo-1', 'utah', phone, '+13853364442', 'incoming', null, null, callAt,
  );
  const input = { accountId, marketKey: 'ut', quoCall: {
    quo_call_id: 'quo-1', caller_phone: phone, destination_number: '+13853364442',
  }, record: { jobber_request_id: requestId, jobber_client_id: clientId } };
  assert.equal((await persistManualCallLink(f.db, input)).ok, true);
  assert.equal((await persistManualCallLink(f.db, input)).ok, true);
  assert.equal(f.sqlite.prepare('SELECT jobber_request_id FROM quo_call_attributions').get().jobber_request_id, requestId);
  assert.equal((await persistManualCallLink(f.db, {
    ...input, record: { ...input.record, jobber_request_id: id('Request', 201) },
  })).reason, 'quo_call_link_conflict');
});

test('Request claim prevents two calls uploading one manual Request across restarts', async () => {
  const f = fixture();
  const first = { marketKey: 'ut', requestId, googleResource: 'call-view-1', quoCallId: 'quo-1' };
  assert.equal((await claimQualifiedPhoneRequest(f.db, first)).ok, true);
  assert.equal((await claimQualifiedPhoneRequest(f.db, first)).ok, true);
  assert.equal((await claimQualifiedPhoneRequest(f.db, {
    ...first, googleResource: 'call-view-2', quoCallId: 'quo-2',
  })).reason, 'request_already_claimed_by_call');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM qualified_phone_request_claims').get().n, 1);
});

test('claim migration reserves already-uploaded Requests before new manual matches', () => {
  const f = fixture();
  f.sqlite.prepare('INSERT INTO qualified_phone_calls VALUES(?,?,?,?,?)').run('live-call', 'outcome-1', 'uploaded', callAt, callAt);
  f.sqlite.prepare('INSERT INTO google_ads_outcome_outbox VALUES(?,?,?,?,?,?)').run('outcome-1', 'ut', requestId, 'quo-live', 'quo_call', 'qualified_lead');
  f.sqlite.exec(readFileSync(new URL('../migrations/0020_qualified_phone_request_claims.sql', import.meta.url), 'utf8'));
  assert.equal(f.sqlite.prepare('SELECT google_resource FROM qualified_phone_request_claims').get().google_resource, 'live-call');
});
