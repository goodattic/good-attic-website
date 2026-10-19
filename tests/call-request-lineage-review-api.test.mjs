import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { handleCallRequestLineageReview } from '../server/call-request-lineage-review-api.js';
registerHooks({ load(url, context, next) {
  if (url.endsWith('.sql')) return { format: 'module',
    source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}`,
    shortCircuit: true };
  return next(url, context);
} });
const { default: worker } = await import('../workers/stage3c-live.js');

const gid = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const ACCOUNT = gid('Account', 2498432);
const CLIENT = gid('Client', 155986226);
const ORIGINAL = gid('Request', 35017089);
const BOOKED = gid('Request', 35017723);
const LATER = gid('Request', 35018000);
const CALL = 'AC' + '1'.padStart(32, '0');
const START = '2026-10-12T19:45:45.000Z';
const phone = '+16142166149';
const original = { id: ORIGINAL, createdAt: '2026-10-12T19:48:03.000Z',
  updatedAt: '2026-10-12T19:48:03.000Z', requestStatus: 'NEW', client: { id: CLIENT },
  assessment: null, quotes: { nodes: [] }, jobs: { nodes: [] } };
const booked = { id: BOOKED, createdAt: '2026-10-12T19:56:58.000Z',
  updatedAt: '2026-10-12T19:56:58.000Z', requestStatus: 'UPCOMING', client: { id: CLIENT },
  assessment: { id: gid('Visit', 99) }, quotes: { nodes: [] }, jobs: { nodes: [] } };

function setup({ pages, account = ACCOUNT, call = CALL } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0017_call_request_lineage.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0023_call_request_lineage_supersessions.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE quo_call_attributions (
    account_id TEXT, quo_call_id TEXT, market TEXT, direction TEXT, phone_number_id TEXT,
    caller_phone TEXT, jobber_request_id TEXT, jobber_client_id TEXT, call_started_at_utc TEXT
  )`);
  sqlite.prepare('INSERT INTO quo_call_attributions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    account, call, 'utah', 'incoming', 'PNqw8amabk', phone, ORIGINAL, CLIENT, START,
  );
  const tracker = { reads: 0, writes: 0, variables: [] };
  const database = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { tracker.writes += 1; const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } }; },
      };
    },
  };
  const env = { ANGI_ROUTER_DB: database, STAGE1_ADMIN_SECRET: 'owner-review-secret' };
  const defaultPages = pages || [
    { nodes: [original], pageInfo: { hasNextPage: true, endCursor: 'next-page' } },
    { nodes: [booked], pageInfo: { hasNextPage: false, endCursor: null } },
  ];
  const deps = {
    async refreshJobberAccessToken() { return { accessToken: 'mock-token' }; },
    async jobberGraphql(_env, token, query, variables) {
      assert.equal(token, 'mock-token');
      tracker.reads += 1;
      tracker.variables.push(variables);
      if (query.includes('CallLineageOriginal')) {
        return { data: { account: { id: ACCOUNT }, request: original } };
      }
      const index = variables.after ? 1 : 0;
      return { data: { account: { id: ACCOUNT }, client: { id: CLIENT, isArchived: false,
        phones: [{ number: phone, normalizedPhoneNumber: phone }], requests: defaultPages[index] } } };
    },
  };
  async function post(action, body, options = {}) {
    const request = new Request(`https://example.test/call-request-lineage/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.secret ?? env.STAGE1_ADMIN_SECRET}`,
        'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const response = await handleCallRequestLineageReview({ request, env, action }, deps);
    return { status: response.status, body: await response.json() };
  }
  return { sqlite, env, tracker, post, deps };
}

const previewBody = { account_id: ACCOUNT, quo_call_id: CALL };
function decision(preview, patch = {}) {
  return { source: preview.source, snapshot_digest: preview.snapshot_digest,
    operational_request_id: BOOKED, decision_id: 'clara-owner-review-1',
    reviewed_by: 'Patrick O\'Loughlin',
    evidence_ref: `Jobber Request 35017723 history, assessment booked Oct 16; Quo call ${CALL}`,
    ambiguity_reviewed: false, ...patch };
}

test('admin preview reads the complete two-page Jobber history and never writes', async () => {
  const f = setup();
  const response = await f.post('preview', previewBody);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.proposal.status, 'proposed');
  assert.deepEqual(response.body.proposal.candidate_request_ids, [BOOKED]);
  assert.equal(response.body.request_count, 2);
  assert.equal(response.body.source.original_request_id, ORIGINAL);
  assert.equal(response.body.source.caller_phone, phone);
  assert.match(response.body.snapshot_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.tracker.variables.map(item => item.after).filter(value => value !== undefined),
    [null, 'next-page', null]);
  assert.equal(f.tracker.writes, 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM call_request_lineage_links').get().n, 0);
});

test('explicit exact decision re-reads Jobber and writes one immutable, audited link', async () => {
  const f = setup();
  const preview = (await f.post('preview', previewBody)).body;
  const readsBefore = f.tracker.reads;
  const response = await f.post('verify', decision(preview));
  assert.equal(response.status, 200);
  assert.equal(response.body.inserted, true);
  assert.ok(f.tracker.reads > readsBefore);
  assert.equal(response.body.link.original_request_id, ORIGINAL);
  assert.equal(response.body.link.operational_request_id, BOOKED);
  const audit = f.sqlite.prepare('SELECT * FROM call_request_lineage_reviews').get();
  assert.equal(audit.decision, 'verified');
  assert.equal(audit.reviewed_by, 'Patrick O\'Loughlin');
  assert.equal(audit.reason, 'explicit_confirmation');
  assert.equal((await f.post('verify', decision(preview))).body.inserted, false);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM call_request_lineage_reviews').get().n, 1);
});

test('no bearer secret, wrong secret, or invalid source cannot read provider data', async () => {
  const f = setup();
  assert.equal((await f.post('preview', previewBody, { secret: 'wrong' })).status, 401);
  f.env.STAGE1_ADMIN_SECRET = '';
  assert.equal((await f.post('preview', previewBody, { secret: '' })).status, 401);
  assert.equal(f.tracker.reads, 0);
  const g = setup({ account: gid('Account', 2498453) });
  const result = await g.post('preview', { account_id: gid('Account', 2498453), quo_call_id: CALL });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'quo_call_account_mismatch');
  assert.equal(g.tracker.reads, 0);
});

test('a dedicated review secret takes precedence without rotating the Stage 1 secret', async () => {
  const f = setup();
  f.env.CALL_LINEAGE_REVIEW_SECRET = 'dedicated-lineage-secret';
  assert.equal((await f.post('preview', previewBody)).status, 401);
  assert.equal(f.tracker.reads, 0);
  assert.equal((await f.post('preview', previewBody, { secret: 'dedicated-lineage-secret' })).status, 200);
});

test('missing or repeated cursor and incomplete Request history fail closed', async () => {
  for (const connection of [
    { nodes: [original], pageInfo: { hasNextPage: true, endCursor: null } },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next-page' } },
    { nodes: [original], pageInfo: null },
  ]) {
    const f = setup({ pages: [connection] });
    const result = await f.post('preview', previewBody);
  assert.equal(result.status, 503, JSON.stringify(result.body));
    assert.equal(result.body.code, 'jobber_request_history_incomplete');
    assert.equal(f.tracker.writes, 0);
  }
});

test('source, target, evidence, and reviewer must match the fresh proposal', async () => {
  const f = setup();
  const preview = (await f.post('preview', previewBody)).body;
  for (const [patch, status, code] of [
    [{ snapshot_digest: '0'.repeat(64) }, 409, 'lineage_snapshot_changed'],
    [{ source: { ...preview.source, client_id: gid('Client', 44) } }, 409, 'lineage_snapshot_changed'],
    [{ operational_request_id: LATER }, 409, 'confirmation_incomplete_or_candidate_unverified'],
    [{ reviewed_by: '' }, 400, 'decision_review_incomplete'],
    [{ evidence_ref: '' }, 400, 'decision_review_incomplete'],
  ]) {
    const result = await f.post('verify', decision(preview, patch));
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
  }
  assert.equal(f.tracker.writes, 0);
});

test('two operational Requests require an explicit ambiguity review', async () => {
  const extra = { ...booked, id: LATER, createdAt: '2026-10-12T20:05:00.000Z' };
  const f = setup({ pages: [
    { nodes: [original], pageInfo: { hasNextPage: true, endCursor: 'next-page' } },
    { nodes: [booked, extra], pageInfo: { hasNextPage: false, endCursor: null } },
  ] });
  const preview = (await f.post('preview', previewBody)).body;
  assert.equal(preview.proposal.status, 'manual_review');
  assert.deepEqual(preview.proposal.candidate_request_ids, [BOOKED, LATER].sort());
  const held = await f.post('verify', decision(preview));
  assert.equal(held.status, 409);
  assert.equal(held.body.code, 'ambiguous_candidates_require_explicit_review');
  assert.equal((await f.post('verify', decision(preview, { ambiguity_reviewed: true }))).status, 200);
});

test('Clara-style move back to the original Request is an append-only supersession', async () => {
  const f = setup();
  const preview = (await f.post('preview', previewBody)).body;
  assert.equal((await f.post('verify', decision(preview))).status, 200);
  const originalWithAssessment = { ...original, assessment: { id: gid('Visit', 100) },
    updatedAt: '2026-10-13T18:00:00.000Z' };
  const originalHolder = { row: originalWithAssessment };
  f.deps.jobberGraphql = async (_env, _token, query, variables) => {
    if (query.includes('CallLineageOriginal')) {
      return { data: { account: { id: ACCOUNT }, request: originalHolder.row } };
    }
    const connection = variables.after
      ? { nodes: [booked], pageInfo: { hasNextPage: false, endCursor: null } }
      : { nodes: [originalHolder.row], pageInfo: { hasNextPage: true, endCursor: 'next-page' } };
    return { data: { account: { id: ACCOUNT }, client: { id: CLIENT, isArchived: false,
      phones: [{ number: phone, normalizedPhoneNumber: phone }], requests: connection } } };
  };
  const fresh = (await f.post('preview', previewBody)).body;
  assert.equal(fresh.original_request_operational, true);
  assert.equal(fresh.active_link.operational_request_id, BOOKED);
  const result = await f.post('supersede', {
    ...decision(fresh, { operational_request_id: ORIGINAL, decision_id: 'clara-owner-review-2', ambiguity_reviewed: true }),
    prior_decision_id: fresh.active_link.decision_id,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.active_link.operational_request_id, ORIGINAL);
  assert.equal(result.body.active_link.revision, 1);
  assert.equal(f.sqlite.prepare('SELECT operational_request_id FROM call_request_lineage_links').get().operational_request_id, BOOKED);
  assert.equal(f.sqlite.prepare('SELECT operational_request_id FROM call_request_lineage_active_links').get().operational_request_id, ORIGINAL);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM call_request_lineage_active_links WHERE operational_request_id=?').get(BOOKED).n, 0);
  assert.deepEqual(f.sqlite.prepare('SELECT reason FROM call_request_lineage_reviews ORDER BY recorded_at').all().map(row => row.reason),
    ['explicit_confirmation', 'explicit_supersession']);
  assert.throws(() => f.sqlite.exec('DELETE FROM call_request_lineage_supersessions'), /lineage_supersession_immutable/);
});

test('a correction to another plausible target requires ambiguity acknowledgement and current decision', async () => {
  const extra = { ...booked, id: LATER, createdAt: '2026-10-12T20:05:00.000Z' };
  const f = setup({ pages: [
    { nodes: [original], pageInfo: { hasNextPage: true, endCursor: 'next-page' } },
    { nodes: [booked, extra], pageInfo: { hasNextPage: false, endCursor: null } },
  ] });
  const preview = (await f.post('preview', previewBody)).body;
  assert.equal((await f.post('verify', decision(preview, { ambiguity_reviewed: true }))).status, 200);
  const noReview = await f.post('supersede', { ...decision(preview, { operational_request_id: LATER,
    decision_id: 'clara-owner-review-2' }), prior_decision_id: 'clara-owner-review-1' });
  assert.equal(noReview.status, 409);
  assert.equal(noReview.body.code, 'ambiguous_candidates_require_explicit_review');
  const stale = await f.post('supersede', { ...decision(preview, { operational_request_id: LATER,
    decision_id: 'clara-owner-review-2', ambiguity_reviewed: true }), prior_decision_id: 'stale' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'lineage_prior_decision_stale');
  const valid = await f.post('supersede', { ...decision(preview, { operational_request_id: LATER,
    decision_id: 'clara-owner-review-2', ambiguity_reviewed: true }), prior_decision_id: 'clara-owner-review-1' });
  assert.equal(valid.status, 200, JSON.stringify(valid.body));
  assert.equal(valid.body.active_link.operational_request_id, LATER);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM call_request_lineage_active_links WHERE operational_request_id=?').get(BOOKED).n, 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM call_request_lineage_active_links WHERE operational_request_id=?').get(LATER).n, 1);
});

test('a correction cannot claim a Request actively owned by another reviewed call', async () => {
  const extra = { ...booked, id: LATER, createdAt: '2026-10-12T20:05:00.000Z' };
  const f = setup({ pages: [
    { nodes: [original], pageInfo: { hasNextPage: true, endCursor: 'next-page' } },
    { nodes: [booked, extra], pageInfo: { hasNextPage: false, endCursor: null } },
  ] });
  const preview = (await f.post('preview', previewBody)).body;
  assert.equal((await f.post('verify', decision(preview, { ambiguity_reviewed: true }))).status, 200);
  f.sqlite.prepare('INSERT INTO call_request_lineage_links VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    ACCOUNT, 'ACother', 'ut', gid('Request', 35019000), LATER, CLIENT, START,
    'another-owner-review', 'owner', 'another call reviewed separately', '2026-10-12T21:00:00.000Z',
  );
  const result = await f.post('supersede', { ...decision(preview, {
    operational_request_id: LATER, decision_id: 'clara-owner-review-2', ambiguity_reviewed: true,
  }), prior_decision_id: 'clara-owner-review-1' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'lineage_target_already_claimed');
  assert.equal(f.sqlite.prepare('SELECT operational_request_id FROM call_request_lineage_active_links WHERE quo_call_id=?').get(CALL).operational_request_id, BOOKED);
});

test('a verified link cannot claim another call’s original Request', async () => {
  const f = setup();
  f.sqlite.prepare('INSERT INTO quo_call_attributions VALUES (?,?,?,?,?,?,?,?,?)').run(
    ACCOUNT, 'ACother', 'utah', 'incoming', 'PNqw8amabk', phone,
    BOOKED, CLIENT, START,
  );
  const preview = (await f.post('preview', previewBody)).body;
  const result = await f.post('verify', decision(preview));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'lineage_target_already_claimed');
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM call_request_lineage_links').get().n, 0);
});

test('provider account and client identity conflicts hold before any decision write', async () => {
  const f = setup();
  f.deps.jobberGraphql = async (_env, _token, query, variables) => {
    if (query.includes('CallLineageOriginal')) {
      return { data: { account: { id: ACCOUNT }, request: { ...original, client: { id: gid('Client', 44) } } } };
    }
    return { data: { account: { id: ACCOUNT }, client: { id: CLIENT, isArchived: false,
      phones: [{ number: phone, normalizedPhoneNumber: phone }],
      requests: { nodes: [original, booked], pageInfo: { hasNextPage: false, endCursor: null } } } } };
  };
  const result = await f.post('preview', previewBody);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'jobber_request_identity_conflict');
  assert.equal(f.tracker.writes, 0);
});

test('Stage3c router protects the preview, verify, and correction paths', async () => {
  const f = setup();
  for (const action of ['preview', 'verify', 'supersede']) {
    const response = await worker.fetch(new Request(`https://example.test/call-request-lineage/${action}`, {
      method: 'POST', headers: { Authorization: 'Bearer wrong-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify(previewBody),
    }), f.env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, code: 'unauthorized' });
  }
  assert.equal(f.tracker.reads, 0);
  assert.equal(f.tracker.writes, 0);
});
