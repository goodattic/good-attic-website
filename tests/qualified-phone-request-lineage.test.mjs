import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { phoneHealth } from '../server/qualified-phone-runtime.js';

const ACCOUNT = 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==';
const ORIGINAL = 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzUwMTcwODk=';
const BOOKED = 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzUwMTc3MjM=';
const CORRECTED = 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzUwMjAwMDA=';
const CLIENT = 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xNTU5ODYyMjY=';
const CALL = ('AC' + 'd'.repeat(32));
const RESOURCE = 'customers/4800890529/callViews/123456';
const START = '2026-10-12T19:45:45.615Z';
const NOW = '2026-10-12T20:00:00.000Z';

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const file of [
    '0008_quo_call_attributions',
    '0009_google_ads_outcome_outbox',
    '0016_qualified_phone_calls',
    '0017_call_request_lineage',
    '0023_call_request_lineage_supersessions',
    '0029_qualified_phone_active_lineage',
  ]) db.exec(readFileSync(new URL(`../migrations/${file}.sql`, import.meta.url), 'utf8'));
  db.prepare(`INSERT INTO quo_call_attributions (
    attribution_id, account_id, market, phone_number_id, quo_call_id,
    caller_phone, call_started_at_original, call_started_at_utc,
    destination_number, direction, final_status, jobber_request_id,
    jobber_client_id, source_event_id, created_at, updated_at
  ) VALUES (?, ?, 'utah', 'PNut', ?, '+16145550149', ?, ?,
    '+13853364442', 'incoming', 'completed', ?, ?, 'quo-event', ?, ?)`)
    .run('source', ACCOUNT, CALL, START, START, ORIGINAL, CLIENT, NOW, NOW);
  db.prepare(`INSERT INTO google_ads_outcome_outbox (
    outcome_id, event_name, market_key, attribution_path, quo_call_id,
    google_call_key, caller_phone, call_started_at_original,
    call_started_at_utc, jobber_account_id, jobber_request_id,
    jobber_client_id, google_account_id, google_conversion_action,
    milestone_at, upload_state, created_at, updated_at
  ) VALUES ('qualified-phone:test', 'qualified_lead', 'ut', 'quo_call',
    ?, ?, '+16145550149', ?, ?, '2498432', ?, ?,
    '4800890529', '7742989654', ?, 'accepted', ?, ?)`)
    .run(CALL, RESOURCE, START, START, ORIGINAL, CLIENT, NOW, NOW, NOW);
  db.prepare(`INSERT INTO qualified_phone_calls (
    google_resource, google_call_json, outcome_id, state, created_at, updated_at
  ) VALUES (?, '{}', 'qualified-phone:test', 'uploaded', ?, ?)`)
    .run(RESOURCE, NOW, NOW);
  return db;
}

function current(db) {
  return db.prepare('SELECT * FROM qualified_phone_request_lineage_current').get();
}

function link(db, client = CLIENT) {
  db.prepare(`INSERT INTO call_request_lineage_links (
    account_id, quo_call_id, market_key, original_request_id,
    operational_request_id, client_id, call_started_at_utc, decision_id,
    verified_by, evidence_ref, verified_at
  ) VALUES (?, ?, 'ut', ?, ?, ?, ?, 'clara-reviewed', 'owner',
    'jobber-history', ?)`)
    .run(ACCOUNT, CALL, ORIGINAL, BOOKED, client, START, NOW);
}

test('qualified call joins the original Request until a reviewed link exists', () => {
  const db = fixture();
  const before = current(db);
  assert.equal(before.resolution_status, 'original_request');
  assert.equal(before.original_request_id, ORIGINAL);
  assert.equal(before.operational_request_id, ORIGINAL);
  assert.equal(before.lineage_decision_id, null);
  link(db);
  const after = current(db);
  assert.equal(after.resolution_status, 'verified_lineage');
  assert.equal(after.original_request_id, ORIGINAL);
  assert.equal(after.operational_request_id, BOOKED);
  assert.equal(after.lineage_decision_id, 'clara-reviewed');
  assert.equal(after.lineage_revision, 0);
  assert.equal(after.quo_call_id, CALL);
  assert.equal(after.google_resource, RESOURCE);
  assert.equal(after.phone_state, 'uploaded');
  assert.deepEqual({ ...db.prepare(`SELECT jobber_request_id, quo_call_id, google_call_key,
    upload_state FROM google_ads_outcome_outbox`).get() }, {
    jobber_request_id: ORIGINAL, quo_call_id: CALL,
    google_call_key: RESOURCE, upload_state: 'accepted',
  });
});

test('append-only supersession changes only the current operational Request', () => {
  const db = fixture();
  link(db);
  db.prepare(`INSERT INTO call_request_lineage_supersessions (
    decision_id, account_id, quo_call_id, revision, prior_decision_id,
    operational_request_id, verified_by, evidence_ref, verified_at
  ) VALUES ('clara-corrected', ?, ?, 1, 'clara-reviewed', ?,
    'owner', 'jobber-history-2', ?)`)
    .run(ACCOUNT, CALL, CORRECTED, NOW);
  const row = current(db);
  assert.equal(row.resolution_status, 'verified_lineage');
  assert.equal(row.original_request_id, ORIGINAL);
  assert.equal(row.operational_request_id, CORRECTED);
  assert.equal(row.lineage_decision_id, 'clara-corrected');
  assert.equal(row.lineage_revision, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM call_request_lineage_reviews').get().n, 2);
});

test('source and lineage identity conflicts hold without a Request pointer', () => {
  const wrongSource = fixture();
  wrongSource.prepare(`UPDATE google_ads_outcome_outbox
    SET jobber_client_id = 'different-client'`).run();
  link(wrongSource);
  assert.equal(current(wrongSource).resolution_status, 'held_source_conflict');
  assert.equal(current(wrongSource).operational_request_id, null);

  const wrongAccount = fixture();
  wrongAccount.prepare(`UPDATE google_ads_outcome_outbox
    SET jobber_account_id = '2498453'`).run();
  link(wrongAccount);
  assert.equal(current(wrongAccount).resolution_status, 'held_source_conflict');
  assert.equal(current(wrongAccount).operational_request_id, null);

  const wrongLink = fixture();
  link(wrongLink, 'different-client');
  assert.equal(current(wrongLink).resolution_status, 'held_lineage_conflict');
  assert.equal(current(wrongLink).operational_request_id, null);

  const contested = fixture();
  link(contested);
  contested.prepare(`INSERT INTO quo_call_attributions (
    attribution_id, account_id, market, phone_number_id, quo_call_id,
    caller_phone, call_started_at_original, call_started_at_utc,
    destination_number, direction, final_status, jobber_request_id,
    jobber_client_id, source_event_id, created_at, updated_at
  ) VALUES ('other', ?, 'utah', 'PNut', 'ACother', '+18015550100', ?, ?,
    '+13853364442', 'incoming', 'completed', ?, ?, 'other-event', ?, ?)`)
    .run(ACCOUNT, START, START, BOOKED, CLIENT, NOW, NOW);
  assert.equal(current(contested).resolution_status, 'held_lineage_conflict');
  assert.equal(current(contested).operational_request_id, null);
});

test('phone health reports reviewed Request linkage without touching uploads', async () => {
  const db = fixture();
  link(db);
  const database = { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
    };
  } };
  const health = await phoneHealth({ ANGI_ROUTER_DB: database,
    QUALIFIED_PHONE_UPLOAD_ENABLED: 'true' });
  assert.equal(health.uploaded, 1);
  assert.deepEqual(health.request_lineage, {
    status: 'available', original_request: 0, verified_lineage: 1,
    held_source_conflict: 0, held_lineage_conflict: 0,
  });
  assert.equal(db.prepare('SELECT upload_state FROM google_ads_outcome_outbox').get().upload_state, 'accepted');
});
