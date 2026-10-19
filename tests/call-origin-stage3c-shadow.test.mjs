import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import {
  observeCallOriginShadow, resolveCallOrigin, operationalRequestId,
} from '../server/call-origin-stage3c-shadow.js';
registerHooks({ load(url, context, next) {
  if (url.endsWith('.sql')) return { format: 'module', source: 'export default ' + JSON.stringify(readFileSync(new URL(url), 'utf8')), shortCircuit: true };
  return next(url, context);
} });
const { processObject, cachedStage3cObjects, cachedEnvironment } = await import('../workers/stage1-shadow.js');

const id = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const account = id('Account', 2498432);
const otherAccount = id('Account', 2498453);
const client = id('Client', 22);
const otherClient = id('Client', 23);
const first = id('Request', 35017089);
const assessmentRequest = id('Request', 35017723);
const quoteId = id('Quote', 400);
const jobId = id('Job', 500);
const callAt = '2026-10-12T19:48:00Z';
const source = { account_id: account, market: 'utah', quo_call_id: 'ACclara',
  jobber_request_id: first, jobber_client_id: client, call_started_at_utc: callAt,
  direction: 'incoming' };
const assessment = { id: id('Assessment', 600), startAt: '2026-10-14T19:00:00Z',
  endAt: '2026-10-14T20:00:00Z', isComplete: true, completedAt: '2026-10-14T20:01:00Z' };
const request = { id: assessmentRequest, client: { id: client }, assessment };
const quote = { id: quoteId, client: { id: client }, request: { id: assessmentRequest },
  lastTransitioned: { approvedAt: '2026-10-15T20:00:00Z' } };
const job = { id: jobId, createdAt: '2026-10-15T20:10:00Z', client: { id: client },
  request: { id: assessmentRequest }, quote };

function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE quo_call_attributions (
    account_id TEXT, market TEXT, quo_call_id TEXT, jobber_request_id TEXT,
    jobber_client_id TEXT, call_started_at_utc TEXT, direction TEXT
  );
  CREATE TABLE closed_loop_stage1_objects (
    market_key TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
    request_id TEXT, client_id TEXT, source_created_at TEXT, source_updated_at TEXT,
    object_json TEXT NOT NULL, first_scheduled_at TEXT, observed_at TEXT NOT NULL,
    PRIMARY KEY(market_key,object_type,object_id)
  )`);
  for (const migration of ['0017_call_request_lineage', '0018_call_origin_stage3c_shadow',
    '0022_call_origin_shadow_replay', '0023_call_request_lineage_supersessions']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
  sqlite.exec('CREATE TABLE closed_loop_stage1_leads (lead_id TEXT PRIMARY KEY)');
  sqlite.prepare('INSERT INTO closed_loop_stage1_leads VALUES(?)').run('website-sentinel');
  const database = {
    sqlite,
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
  };
  return database;
}

function stageDb() {
  const database = db();
  // Stage 3c observation tables are separate from the call-origin shadow table.
  for (const migration of ['0009_google_ads_outcome_outbox', '0010_stage1_shadow', '0011_stage1_outbox',
    '0012_stage2_observability', '0013_owner_link_overrides', '0014_owner_request_review']) {
    if (migration === '0010_stage1_shadow') {
      // The lightweight fixture already has the sentinel website table.
      database.sqlite.exec('DROP TABLE closed_loop_stage1_leads');
    }
    database.sqlite.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
  return database;
}

function insertCall(database, call = source) {
  database.sqlite.prepare('INSERT INTO quo_call_attributions VALUES(?,?,?,?,?,?,?)')
    .run(call.account_id, call.market, call.quo_call_id, call.jobber_request_id,
      call.jobber_client_id, call.call_started_at_utc, call.direction);
}
function insertLink(database, patch = {}) {
  const values = { account_id: account, quo_call_id: 'ACclara', market_key: 'ut',
    original_request_id: first, operational_request_id: assessmentRequest,
    client_id: client, call_started_at_utc: callAt, decision_id: 'review-1',
    verified_by: 'owner', evidence_ref: 'jobber_history', verified_at: '2026-10-12T20:00:00Z', ...patch };
  database.sqlite.prepare('INSERT INTO call_request_lineage_links VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(values));
}
function readRequest(requestId) {
  return { account: { id: account }, request: { id: requestId, client: { id: client } } };
}
function input(database, type, object, patch = {}) {
  return { database, marketKey: 'ut', accountId: account, type, object,
    readRequest: async requestId => readRequest(requestId), ...patch };
}

test('verified Clara lineage produces separate shadow appointment, assessment, quote and job rows', async () => {
  const database = db();
  insertCall(database);
  insertLink(database);
  const booking = '2026-10-12T19:58:00Z';
  const a = await observeCallOriginShadow({ ...input(database, 'request', request), firstScheduledAt: booking });
  assert.equal(a.status, 'resolved');
  assert.equal(a.evidence_kind, 'verified_lineage');
  assert.equal(a.inserted, 2);
  const q = await observeCallOriginShadow(input(database, 'quote', quote));
  const j = await observeCallOriginShadow(input(database, 'job', job));
  assert.equal(q.inserted, 1);
  assert.equal(j.inserted, 1); // quote approval is idempotent; job creation is new.
  const rows = database.sqlite.prepare('SELECT * FROM call_origin_shadow_events ORDER BY occurred_at').all();
  const current = database.sqlite.prepare('SELECT * FROM call_origin_shadow_current_events').all();
  assert.deepEqual(rows.map(row => row.event_name),
    ['appointment_set', 'assessment_completed', 'quote_approved', 'job_created']);
  assert.ok(rows.every(row => row.quo_call_id === 'ACclara' && row.original_request_id === first
    && row.operational_request_id === assessmentRequest && row.client_id === client));
  assert.equal(rows[2].quote_id, quoteId);
  assert.equal(rows[3].job_id, jobId);
  assert.equal(current.length, 4);
  assert.equal((await observeCallOriginShadow({ ...input(database, 'request', request), firstScheduledAt: booking })).status, 'skipped');
  assert.equal(database.sqlite.prepare('SELECT lead_id FROM closed_loop_stage1_leads').get().lead_id, 'website-sentinel');
});

test('the original Request resolves directly without a replacement link', async () => {
  const database = db();
  insertCall(database);
  const original = { ...request, id: first };
  const result = await observeCallOriginShadow({ ...input(database, 'request', original),
    firstScheduledAt: '2026-10-12T20:00:00Z' });
  assert.equal(result.status, 'resolved');
  assert.equal(result.evidence_kind, 'original_request');
  assert.equal(result.original_request_id, first);
  assert.equal(result.operational_request_id, first);
  assert.equal(result.inserted, 2);
});

test('cross-account and Client mismatches, missing relationship and ambiguous call origin fail closed', async () => {
  for (const [patch, reason] of [
    [{ accountId: otherAccount }, 'jobber_account_unverified'],
    [{ object: { ...request, client: { id: otherClient } } }, 'operational_request_account_or_client_conflict'],
    [{ readRequest: async requestId => ({ account: { id: otherAccount }, request: { id: requestId, client: { id: client } } }) }, 'operational_request_account_or_client_conflict'],
    [{ readRequest: async requestId => requestId === first
      ? { account: { id: account }, request: { id: first, client: { id: otherClient } } }
      : readRequest(requestId) }, 'original_request_account_or_client_conflict'],
  ]) {
    const database = db();
    insertCall(database);
    insertLink(database);
    const result = await observeCallOriginShadow({ ...input(database, 'request', request), firstScheduledAt: '2026-10-12T20:00:00Z', ...patch });
    assert.equal(result.status, 'held');
    assert.equal(result.reason, reason);
    assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_events').get().n, 0);
  }
  const database = db();
  insertCall(database);
  insertLink(database);
  assert.equal((await resolveCallOrigin(input(database, 'quote', { ...quote, request: null }))).reason,
    'operational_request_relationship_missing_or_conflicting');
  assert.equal((await resolveCallOrigin(input(database, 'job', { ...job, quote: { ...quote, request: { id: first } } }))).reason,
    'operational_request_relationship_missing_or_conflicting');
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_events').get().n, 0);

  const directDb = db();
  insertCall(directDb);
  insertCall(directDb, { ...source, quo_call_id: 'ACother' });
  const result = await resolveCallOrigin(input(directDb, 'request', { ...request, id: first }));
  assert.equal(result.status, 'held');
  assert.equal(result.reason, 'multiple_call_origins_for_request');
});

test('stale or conflicting verified link is held, not inferred by phone or Client', async () => {
  const database = db();
  insertCall(database);
  insertLink(database, { client_id: otherClient });
  assert.equal((await resolveCallOrigin(input(database, 'request', request))).reason,
    'verified_lineage_identity_conflict');

  const unlinked = db();
  insertCall(unlinked);
  assert.equal((await resolveCallOrigin(input(unlinked, 'request', request))).status, 'not_call_origin');
});

test('incomplete milestone times create no Google-ready result or fabricated shadow event', async () => {
  const database = db();
  insertCall(database);
  insertLink(database);
  const incomplete = { ...request, assessment: { ...assessment, completedAt: null } };
  const result = await observeCallOriginShadow(input(database, 'request', incomplete));
  assert.equal(result.status, 'resolved');
  assert.equal(result.inserted, 0);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_events').get().n, 0);
  assert.equal(operationalRequestId('job', { ...job, request: null }), assessmentRequest);
});

test('opt-in Stage 3c processObject writes call-origin shadow while website observation remains separate', async () => {
  const database = stageDb();
  insertCall(database);
  insertLink(database);
  const object = { ...request, createdAt: '2026-10-12T19:57:00Z', updatedAt: '2026-10-12T20:00:00Z' };
  await processObject({ ANGI_ROUTER_DB: database, CALL_ORIGIN_SHADOW_ENABLED: 'true',
    CALL_ORIGIN_READ_REQUEST: async requestId => readRequest(requestId),
    STAGE2_APPOINTMENT_CUTOFF: '2026-10-01T00:00:00Z' }, 'ut', 'request', object);
  assert.deepEqual(database.sqlite.prepare('SELECT event_name FROM call_origin_shadow_events').all()
    .map(row => row.event_name).sort(), ['appointment_set', 'assessment_completed'].sort());
  const website = database.sqlite.prepare("SELECT attribution_path,quo_call_id,upload_state FROM google_ads_outcome_outbox WHERE event_name='assessment_completed'").get();
  assert.equal(website.attribution_path, 'website');
  assert.equal(website.quo_call_id, null);
  assert.equal(website.upload_state, 'shadow');
});

test('late verified link replays an already scanned operational Request from the Stage 3c cache', async () => {
  const database = stageDb();
  insertCall(database);
  const object = { ...request, createdAt: '2026-10-12T19:57:00Z', updatedAt: '2026-10-12T20:00:00Z' };
  database.sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
    (market_key,object_type,object_id,request_id,client_id,object_json,first_scheduled_at,observed_at)
    VALUES (?,?,?,?,?,?,?,?)`).run('ut','request',assessmentRequest,assessmentRequest,client,
    JSON.stringify(object),'2026-10-12T19:58:00Z','2026-10-12T20:00:00Z');
  let authoritativeReads = 0;
  const env = { ANGI_ROUTER_DB: database, CALL_ORIGIN_SHADOW_ENABLED: 'true',
    CALL_ORIGIN_READ_REQUEST: async requestId => { authoritativeReads++; return readRequest(requestId); },
    STAGE2_APPOINTMENT_CUTOFF: '2026-10-01T00:00:00Z' };
  assert.equal((await cachedStage3cObjects(env)).length, 0);
  insertLink(database);
  const cached = await cachedStage3cObjects(env);
  assert.equal(cached.length, 1);
  await processObject(env, cached[0].market_key, cached[0].object_type, JSON.parse(cached[0].object_json));
  assert.equal(authoritativeReads, 2);
  assert.equal((await cachedStage3cObjects(env)).length, 0);
  await processObject(env, cached[0].market_key, cached[0].object_type, JSON.parse(cached[0].object_json));
  assert.equal(authoritativeReads, 2);
  assert.deepEqual(database.sqlite.prepare('SELECT event_name FROM call_origin_shadow_events ORDER BY occurred_at').all().map(row => row.event_name),
    ['appointment_set','assessment_completed']);

  const updated = { ...object, updatedAt: '2026-10-13T00:00:00Z' };
  database.sqlite.prepare(`UPDATE closed_loop_stage1_objects SET object_json=?,source_updated_at=?
    WHERE market_key='ut' AND object_type='request' AND object_id=?`)
    .run(JSON.stringify(updated), updated.updatedAt, assessmentRequest);
  const changed = await cachedStage3cObjects(env);
  assert.equal(changed.length, 1);
  await processObject(env, changed[0].market_key, changed[0].object_type, JSON.parse(changed[0].object_json));
  assert.equal(authoritativeReads, 4);
  assert.equal((await cachedStage3cObjects(env)).length, 0);
});

test('cached replay reads Jobber with the authoritative token database', async () => {
  const database = stageDb();
  insertCall(database);
  insertLink(database);
  database.sqlite.exec(`CREATE TABLE angi_router_jobber_auth (
    account_key TEXT PRIMARY KEY, access_token TEXT, access_expires_at INTEGER,
    refresh_token TEXT, refresh_revision INTEGER, refresh_status TEXT,
    refresh_lease_token TEXT, refresh_lease_expires_at INTEGER, last_error_code TEXT
  )`);
  database.sqlite.prepare(`INSERT INTO angi_router_jobber_auth
    (account_key,access_token,access_expires_at,refresh_status)
    VALUES (?,?,?,'ready')`).run('utah', 'fresh-token', Date.now() + 3600000);
  const object = { ...request, createdAt: '2026-10-12T19:57:00Z', updatedAt: '2026-10-12T20:00:00Z' };
  database.sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
    (market_key,object_type,object_id,request_id,client_id,object_json,first_scheduled_at,observed_at)
    VALUES (?,?,?,?,?,?,?,?)`).run('ut','request',assessmentRequest,assessmentRequest,client,
    JSON.stringify(object),'2026-10-12T19:58:00Z','2026-10-12T20:00:00Z');
  const previousFetch = globalThis.fetch;
  const jobberReads = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.getjobber.com/api/graphql');
    assert.equal(options.headers.Authorization, 'Bearer fresh-token');
    const requestId = JSON.parse(options.body).variables.id;
    jobberReads.push(requestId);
    return Response.json({ data: readRequest(requestId) });
  };
  try {
    const env = { ANGI_ROUTER_DB: database, CALL_ORIGIN_SHADOW_ENABLED: 'true',
      STAGE2_APPOINTMENT_CUTOFF: '2026-10-01T00:00:00Z' };
    const cache = await cachedEnvironment(env);
    assert.notEqual(cache.env.ANGI_ROUTER_DB, database);
    assert.equal(cache.env.CALL_ORIGIN_JOBBER_ENV.ANGI_ROUTER_DB, database);
    await processObject(cache.env, 'ut', 'request', object);
    await cache.flush();
    assert.deepEqual(jobberReads, [assessmentRequest, first]);
    assert.deepEqual(database.sqlite.prepare(`SELECT event_name FROM call_origin_shadow_current_events
      ORDER BY event_name`).all().map(row => row.event_name),
      ['appointment_set', 'assessment_completed']);
    assert.equal(database.sqlite.prepare('SELECT check_status FROM call_origin_shadow_object_checks').get().check_status,
      'resolved');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a corrected active link immediately retires prior-target shadow rows and replays the new Request', async () => {
  const database = stageDb();
  insertCall(database);
  insertLink(database);
  const booking = '2026-10-12T19:58:00Z';
  const prior = { ...request, updatedAt: '2026-10-12T20:00:00Z' };
  assert.equal((await observeCallOriginShadow({ ...input(database, 'request', prior), firstScheduledAt: booking })).inserted, 2);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_current_events').get().n, 2);

  const nextRequestId = id('Request', 35018888);
  database.sqlite.prepare('INSERT INTO call_request_lineage_supersessions VALUES(?,?,?,?,?,?,?,?,?)')
    .run('review-2', account, 'ACclara', 1, 'review-1', nextRequestId,
      'owner', 'jobber_history_correction', '2026-10-13T00:00:00Z');
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_events').get().n, 2);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_current_events').get().n, 0);
  assert.equal((await resolveCallOrigin(input(database, 'request', prior))).status, 'not_call_origin');
  const next = { ...request, id: nextRequestId, updatedAt: '2026-10-13T00:01:00Z' };
  const result = await observeCallOriginShadow({ ...input(database, 'request', next), firstScheduledAt: booking });
  assert.equal(result.status, 'resolved');
  assert.equal(result.link_decision_id, 'review-2');
  assert.equal(result.inserted, 2);
  assert.deepEqual(database.sqlite.prepare('SELECT DISTINCT operational_request_id FROM call_origin_shadow_current_events').all()
    .map(row => row.operational_request_id), [nextRequestId]);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_events').get().n, 4);

  database.sqlite.prepare('INSERT INTO call_request_lineage_supersessions VALUES(?,?,?,?,?,?,?,?,?)')
    .run('review-3', account, 'ACclara', 2, 'review-2', first,
      'owner', 'jobber_history_correction_back', '2026-10-13T00:02:00Z');
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM call_origin_shadow_current_events').get().n, 0);
  const original = { ...request, id: first, updatedAt: '2026-10-13T00:03:00Z' };
  const back = await observeCallOriginShadow({ ...input(database, 'request', original), firstScheduledAt: booking });
  assert.equal(back.status, 'resolved');
  assert.equal(back.link_decision_id, 'review-3');
  assert.equal(back.inserted, 2);
  assert.deepEqual(database.sqlite.prepare('SELECT DISTINCT operational_request_id FROM call_origin_shadow_current_events').all()
    .map(row => row.operational_request_id), [first]);
});

test('cached call-origin replay processes at most 25 changed objects per tick', async () => {
  const database = stageDb();
  for (let n = 0; n < 30; n++) {
    const requestId = id('Request', 36000000 + n);
    insertCall(database, { ...source, quo_call_id: `ACbatch${n}`, jobber_request_id: requestId });
    const object = { id: requestId, client: { id: client },
      createdAt: '2026-10-12T19:57:00Z', updatedAt: '2026-10-12T20:00:00Z' };
    database.sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
      (market_key,object_type,object_id,request_id,client_id,object_json,observed_at)
      VALUES (?,?,?,?,?,?,?)`).run('ut','request',requestId,requestId,client,
      JSON.stringify(object),'2026-10-12T20:00:00Z');
  }
  const env = { ANGI_ROUTER_DB: database, CALL_ORIGIN_SHADOW_ENABLED: 'true',
    CALL_ORIGIN_READ_REQUEST: async requestId => readRequest(requestId),
    STAGE2_APPOINTMENT_CUTOFF: '2026-10-01T00:00:00Z' };
  const firstBatch = await cachedStage3cObjects(env);
  assert.equal(firstBatch.length, 25);
  for (const row of firstBatch) {
    await processObject(env, row.market_key, row.object_type, JSON.parse(row.object_json));
  }
  assert.equal((await cachedStage3cObjects(env)).length, 5);
});
