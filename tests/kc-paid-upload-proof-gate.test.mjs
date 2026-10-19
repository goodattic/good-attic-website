import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { kcLegacyArchiveGate, kcWebsiteProofGate, kcStageOutboxLineageGate, submitReady } from '../server/data-manager-live.js';

const ACCOUNT = 'Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==';
const REQUEST = 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvOTAw';
const CLIENT = 'Z2lkOi8vSm9iYmVyL0NsaWVudC85MDA=';
const SUBMISSION = '11111111-1111-4111-8111-111111111111';
const INQUIRY = '2026-10-19T12:00:00Z';
const CONVERSION = '2026-10-19T18:00:00Z';
const CLICK = 'gclid123456';
const OUTCOME = 'gae-kc-sold-900';
const fingerprint = async (key, value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(`${key}:${value}`)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0009_google_ads_outcome_outbox', '0010_stage1_shadow',
    '0011_stage1_outbox', '0012_stage2_observability', '0015_data_manager_live']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  sqlite.exec(`
    CREATE TABLE closed_loop_leads (lead_id TEXT,submission_id TEXT,market_key TEXT,
      jobber_account_id TEXT,jobber_request_id TEXT,jobber_client_id TEXT,
      original_source TEXT,campaign TEXT,inquiry_at TEXT,gclid TEXT,gbraid TEXT,wbraid TEXT,
      consent_state TEXT);
    CREATE TABLE website_google_source_proofs (submission_id TEXT,source_lead_id TEXT,
      market_key TEXT,account_id TEXT,jobber_request_id TEXT,jobber_client_id TEXT,
      source_key TEXT,source_detail TEXT,source_reason TEXT,evidence_json TEXT,state TEXT);
    CREATE TABLE website_form_conversions (submission_id TEXT,transaction_id TEXT,
      market_key TEXT,jobber_account_id TEXT,jobber_request_id TEXT,jobber_client_id TEXT,
      state TEXT,reconciliation_required INTEGER);
    CREATE TABLE acknowledgement_sources (account_id TEXT,request_id TEXT,
      market_key TEXT,client_id TEXT,source_kind TEXT,source_lead_id TEXT,
      source_created_at TEXT);
  `);
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  for (const name of ['stage3c_activated_at', 'stage3c_sheet_imports_paused_at']) {
    sqlite.prepare('INSERT INTO closed_loop_stage1_control (name,value,updated_at) VALUES (?,?,?)')
      .run(name, '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z');
  }
  sqlite.prepare(`INSERT INTO closed_loop_stage1_leads
    (market_key,request_id,lead_id,inquiry_at,gclid,source,conflict,updated_at)
    VALUES ('mo_kc',?,?,?,?, 'website_attribution_archive',0,?)`)
    .run(REQUEST, 'archive-lead-id', INQUIRY, CLICK, INQUIRY);
  const payload = JSON.stringify({
    conversionAction: 'customers/4800890529/conversionActions/7754270382',
    conversionDateTime: '2026-10-19 18:00:00+00:00',
    conversionValue: 1200, currencyCode: 'USD', orderId: OUTCOME, gclid: CLICK,
  });
  sqlite.prepare(`INSERT INTO closed_loop_stage1_events
    (outcome_id,market_key,event_name,request_id,quote_id,conversion_at,
      value_micros,payload_json,hold_reasons_json,updated_at)
    VALUES (?,'mo_kc','sold_job',?,'quote-900',?,1200000000,?,'[]',?)`)
    .run(OUTCOME, REQUEST, CONVERSION, payload, CONVERSION);
  sqlite.prepare(`INSERT INTO google_ads_outcome_outbox
    (outcome_id,event_name,market_key,attribution_path,attribution_status,
      source_lead_id,gclid,jobber_account_id,jobber_request_id,jobber_client_id,jobber_quote_id,
      google_account_id,google_conversion_action,milestone_at,conversion_at,
      value_micros,currency_code,consent_status,upload_state,created_at,updated_at)
    VALUES (?,'sold_job','mo_kc','website','pending','archive-lead-id',?,
      '1919824',?,?,'quote-900','4800890529','7754270382',?,?,1200000000,'USD',
      'granted','shadow',?,?)`)
    .run(OUTCOME, CLICK, REQUEST, CLIENT, CONVERSION, CONVERSION, CONVERSION, CONVERSION);
  const env = { ANGI_ROUTER_DB: db, GOOGLE_ADS_UPLOAD_ENABLED: 'true',
    GOOGLE_ADS_TRANSPORT: 'data_manager_api' };
  return { db, sqlite, env };
}

function addProof(sqlite, { reason = 'gclid', click = CLICK, campaign = 'kc-fall', consent = 'granted' } = {}) {
  const sourceLead = `website:${SUBMISSION}`;
  const prefix = reason.startsWith('paid_touch_') ? 'paid_touch'
    : reason.startsWith('first_touch_') ? 'first_touch' : '';
  const signal = prefix ? reason.slice(prefix.length + 1) : reason;
  const evidence = JSON.stringify({
    schema_version: 1, source_key: 'google', source_detail: 'google_ads',
    source_reason: reason,
    verified_signals: signal === 'google_paid_utm'
      ? { utm_source: 'google', utm_medium: 'cpc' } : { [signal]: click },
    attribution: {
      [prefix ? `${prefix}_landing_page` : 'ad_landing_page']:
        `https://goodattic.energy/kansas-city/?utm_campaign=${campaign}`,
      [prefix ? `${prefix}_captured_at` : 'attribution_captured_at']:
        '2026-10-19T11:59:00Z',
    },
  });
  sqlite.prepare(`INSERT INTO closed_loop_leads VALUES
    (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)`)
    .run(`jobber-request:${REQUEST}`, SUBMISSION, 'mo_kc', ACCOUNT,
      REQUEST, CLIENT, 'Google Ads', campaign, INQUIRY, click, consent);
  sqlite.prepare(`INSERT INTO website_google_source_proofs VALUES
    (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(SUBMISSION, sourceLead, 'mo_kc', ACCOUNT, REQUEST, CLIENT,
      'google', 'google_ads', reason, evidence, 'completed');
  sqlite.prepare(`INSERT INTO website_form_conversions VALUES
    (?,?,?,?,?,?,?,?)`)
    .run(SUBMISSION, SUBMISSION, 'mo_kc', ACCOUNT, REQUEST, CLIENT, 'completed', 0);
  sqlite.prepare(`INSERT INTO acknowledgement_sources VALUES
    (?,?,?,?,?,?,?)`)
    .run(ACCOUNT, REQUEST, 'mo_kc', CLIENT, 'website', sourceLead, INQUIRY);
}

function candidate(sqlite) {
  return sqlite.prepare(`SELECT o.*,e.payload_json,e.hold_reasons_json,
      e.market_key AS stage_market_key,e.event_name AS stage_event_name,
      e.request_id AS stage_request_id,e.quote_id AS stage_quote_id,
      e.job_id AS stage_job_id,e.conversion_at AS stage_conversion_at,
      e.value_micros AS stage_value_micros
    FROM google_ads_outcome_outbox o JOIN closed_loop_stage1_events e USING(outcome_id)`).get();
}

test('new KC archive-race row cannot upload without exact paid website proof', async () => {
  const { db, sqlite, env } = fixture();
  assert.deepEqual(await kcWebsiteProofGate(db, candidate(sqlite)),
    { ok: false, reason: 'kc_paid_source_chain_unconfirmed' });
  let requests = 0;
  const result = await submitReady(env, 'token', async () => { requests++; return Response.json({ requestId: 'r' }); });
  assert.equal(result.sent, 0);
  assert.equal(requests, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM closed_loop_google_uploads').get().n, 0);
});

test('one proven paid KC form can upload only its exact Request and click', async () => {
  const { db, sqlite, env } = fixture();
  addProof(sqlite, { reason: 'paid_touch_gclid' });
  assert.deepEqual(await kcWebsiteProofGate(db, candidate(sqlite)), { ok: true });
  let requests = 0;
  const result = await submitReady(env, 'token', async (_url, options) => {
    requests++;
    const event = JSON.parse(options.body).events[0];
    assert.equal(event.transactionId, OUTCOME);
    assert.deepEqual(event.adIdentifiers, { gclid: CLICK });
    return Response.json({ requestId: 'request-1' });
  });
  assert.equal(result.sent, 1);
  assert.equal(requests, 1);
  assert.equal(sqlite.prepare('SELECT status FROM closed_loop_google_uploads').get().status, 'processing');
});

test('reconciled KC proof with unknown consent cannot auto-upload', async () => {
  for (const [outboxConsent, sourceConsent, expected] of [
    ['unknown', 'unknown', 'kc_consent_not_granted'],
    ['denied', 'granted', 'kc_consent_not_granted'],
    ['granted', 'unknown', 'kc_source_consent_not_granted'],
  ]) {
    const { db, sqlite, env } = fixture();
    addProof(sqlite, { consent: sourceConsent });
    sqlite.prepare('UPDATE google_ads_outcome_outbox SET consent_status=?').run(outboxConsent);
    assert.equal((await kcWebsiteProofGate(db, candidate(sqlite))).reason, expected);
    const result = await submitReady(env, 'token', () => { throw Error('should not upload'); });
    assert.equal(result.sent, 0);
    assert.equal(result.skipped[0].error, expected);
  }
});

test('mismatched Request, Client, source proof, and click fail closed', async () => {
  for (const [sql, reason] of [
    ["UPDATE website_google_source_proofs SET jobber_request_id='other'", 'kc_paid_source_chain_unconfirmed'],
    ["UPDATE website_form_conversions SET jobber_client_id='other'", 'kc_paid_source_chain_unconfirmed'],
    ["DELETE FROM acknowledgement_sources", 'kc_paid_source_chain_unconfirmed'],
    ["UPDATE google_ads_outcome_outbox SET gclid='spoofed-click'", 'kc_click_lineage_mismatch'],
    ["UPDATE closed_loop_leads SET campaign='spoofed-utm'", 'kc_campaign_proof_mismatch'],
    ["UPDATE website_google_source_proofs SET source_reason='google_paid_utm'", 'kc_click_proof_missing'],
  ]) {
    const { db, sqlite } = fixture();
    addProof(sqlite);
    sqlite.exec(sql);
    assert.equal((await kcWebsiteProofGate(db, candidate(sqlite))).reason, reason, sql);
  }
});

test('first-touch paid click proof remains eligible without inventing a campaign', async () => {
  const { db, sqlite } = fixture();
  addProof(sqlite, { reason: 'first_touch_gclid', campaign: '' });
  assert.deepEqual(await kcWebsiteProofGate(db, candidate(sqlite)), { ok: true });
});

test('late Stage 1 lead conflicts hold both proven and archive KC candidates', async () => {
  for (const inquiry of [INQUIRY, '2026-10-04T16:09:42.937Z']) {
    const { db, sqlite, env } = fixture();
    addProof(sqlite);
    sqlite.prepare('UPDATE closed_loop_stage1_leads SET conflict=1,inquiry_at=?').run(inquiry);
    assert.deepEqual(await kcWebsiteProofGate(db, candidate(sqlite)),
      { ok: false, reason: 'kc_stage1_lead_conflict' });
    const result = await submitReady(env, 'token', () => { throw Error('should not upload'); });
    assert.equal(result.sent, 0);
    assert.equal(result.skipped[0].error, 'kc_stage1_lead_conflict');
  }
});

test('UT/STL and verified call path preserve existing proof-gate behavior', async () => {
  const { db, sqlite } = fixture();
  const row = candidate(sqlite);
  assert.deepEqual(await kcWebsiteProofGate(db, { ...row, market_key: 'ut' }), { ok: true });
  assert.deepEqual(await kcWebsiteProofGate(db, { ...row, attribution_path: 'quo_call' }), { ok: true });
});

test('backdated KC archive import cannot upload without its exact historical Request pin', async () => {
  const { db, sqlite, env } = fixture();
  sqlite.prepare('UPDATE closed_loop_stage1_leads SET inquiry_at=?').run('2026-10-04T16:09:42.937Z');
  assert.deepEqual(await kcWebsiteProofGate(db, candidate(sqlite)),
    { ok: false, reason: 'kc_legacy_archive_not_pinned' });
  const result = await submitReady(env, 'token', () => { throw Error('should not upload'); });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped[0].error, 'kc_legacy_archive_not_pinned');
});

test('pinned legacy click accepts only its original Client, time, and click fingerprint', async () => {
  const { db, sqlite } = fixture();
  const braId = 'gbraid123456';
  sqlite.prepare('UPDATE closed_loop_stage1_leads SET gbraid=?').run(braId);
  const allowlist = { [REQUEST]: { inquiry: INQUIRY, client: CLIENT,
    gclid: await fingerprint('gclid', CLICK), gbraid: await fingerprint('gbraid', braId) } };
  const lead = sqlite.prepare('SELECT source,inquiry_at,gclid,gbraid,wbraid FROM closed_loop_stage1_leads').get();
  assert.deepEqual(await kcLegacyArchiveGate(db, candidate(sqlite), lead, allowlist), { ok: true, legacy: true });
  sqlite.exec("UPDATE google_ads_outcome_outbox SET gclid='swapped-click'");
  assert.equal((await kcLegacyArchiveGate(db, candidate(sqlite), lead, allowlist)).reason,
    'kc_legacy_click_changed');
  sqlite.prepare('UPDATE google_ads_outcome_outbox SET gclid=?').run(CLICK);
  sqlite.prepare("UPDATE closed_loop_stage1_leads SET gbraid='swapped-gbraid'").run();
  assert.equal((await kcLegacyArchiveGate(db, candidate(sqlite),
    sqlite.prepare('SELECT source,inquiry_at,gclid,gbraid,wbraid FROM closed_loop_stage1_leads').get(),
    allowlist)).reason, 'kc_legacy_click_changed');
});

test('a reused Request with old archive inquiry is held for manual reconciliation', async () => {
  const { db, sqlite } = fixture();
  addProof(sqlite);
  const priorInquiry = '2026-10-04T16:09:42.937Z';
  sqlite.prepare('UPDATE closed_loop_stage1_leads SET inquiry_at=?').run(priorInquiry);
  assert.equal((await kcWebsiteProofGate(db, candidate(sqlite))).reason,
    'kc_legacy_archive_not_pinned');
  const allowlist = { [REQUEST]: { inquiry: priorInquiry, client: CLIENT,
    gclid: await fingerprint('gclid', CLICK) } };
  const stageLead = sqlite.prepare('SELECT source,inquiry_at,gclid,gbraid,wbraid FROM closed_loop_stage1_leads').get();
  assert.equal((await kcLegacyArchiveGate(db, candidate(sqlite), stageLead, allowlist)).reason,
    'kc_legacy_request_reused');
});

test('KC website Stage 1 event and outbox must share exact object lineage before upload', async () => {
  for (const sql of [
    "UPDATE google_ads_outcome_outbox SET jobber_request_id='request-B'",
    "UPDATE google_ads_outcome_outbox SET jobber_quote_id='quote-B'",
    "UPDATE google_ads_outcome_outbox SET jobber_job_id='job-B'",
    "UPDATE google_ads_outcome_outbox SET conversion_at='2026-10-19T18:01:00Z'",
    "UPDATE google_ads_outcome_outbox SET event_name='assessment_completed'",
    "UPDATE closed_loop_stage1_events SET market_key='ut'",
    "UPDATE google_ads_outcome_outbox SET market_key='ut'",
  ]) {
    const { db, sqlite, env } = fixture();
    addProof(sqlite);
    sqlite.exec(sql);
    assert.equal(kcStageOutboxLineageGate(candidate(sqlite)).reason,
      'stage1_outbox_lineage_mismatch', sql);
    const result = await submitReady(env, 'token', () => { throw Error('should not upload'); });
    assert.equal(result.sent, 0, sql);
    assert.equal(result.skipped[0].error, 'stage1_outbox_lineage_mismatch', sql);
  }
});

test('KC Stage 1 website payload cannot bypass proof by relabeling as a call', async () => {
  const { sqlite, env } = fixture();
  addProof(sqlite);
  sqlite.exec("UPDATE google_ads_outcome_outbox SET attribution_path='quo_call'");
  assert.equal(kcStageOutboxLineageGate(candidate(sqlite)).reason,
    'kc_stage1_attribution_path_mismatch');
  const result = await submitReady(env, 'token', () => { throw Error('should not upload'); });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped[0].error, 'kc_stage1_attribution_path_mismatch');
});

test('KC website payload time and dollar value must match both ledgers', async () => {
  for (const [sql, expected] of [
    ["UPDATE google_ads_outcome_outbox SET value_micros=1300000000", 'stage1_outbox_value_mismatch'],
    ["UPDATE closed_loop_stage1_events SET value_micros=1300000000", 'stage1_outbox_value_mismatch'],
    ["UPDATE closed_loop_stage1_events SET conversion_at='2026-10-19T18:01:00Z'; UPDATE google_ads_outcome_outbox SET conversion_at='2026-10-19T18:01:00Z'", 'stage1_payload_lineage_mismatch'],
    ["UPDATE closed_loop_stage1_events SET payload_json=replace(payload_json,'\"conversionValue\":1200','\"conversionValue\":1300')", 'stage1_payload_lineage_mismatch'],
    ["UPDATE closed_loop_stage1_events SET payload_json=replace(payload_json,'2026-10-19 18:00:00+00:00','2026-10-19 18:01:00+00:00')", 'stage1_payload_lineage_mismatch'],
  ]) {
    const { sqlite, env } = fixture();
    addProof(sqlite);
    sqlite.exec(sql);
    assert.equal(kcStageOutboxLineageGate(candidate(sqlite)).reason, expected, sql);
    const result = await submitReady(env, 'token', () => { throw Error('should not upload'); });
    assert.equal(result.sent, 0, sql);
    assert.equal(result.skipped[0].error, expected, sql);
  }
});

test('KC payload normalization accepts fractional source seconds and micros-rounded dollars', () => {
  const { sqlite } = fixture();
  const fractional = '2026-10-19T18:00:00.381Z';
  sqlite.prepare('UPDATE closed_loop_stage1_events SET conversion_at=?,value_micros=?')
    .run(fractional, 1200125432);
  sqlite.prepare('UPDATE google_ads_outcome_outbox SET conversion_at=?,value_micros=?')
    .run(fractional, 1200125432);
  const payload = JSON.parse(sqlite.prepare('SELECT payload_json FROM closed_loop_stage1_events').get().payload_json);
  payload.conversionValue = 1200.125432;
  sqlite.prepare('UPDATE closed_loop_stage1_events SET payload_json=?').run(JSON.stringify(payload));
  assert.deepEqual(kcStageOutboxLineageGate(candidate(sqlite)), { ok: true });
});

test('active UT/STL and independent call path retain existing upload behavior', () => {
  const { sqlite } = fixture();
  sqlite.exec("UPDATE google_ads_outcome_outbox SET jobber_job_id='later-job'");
  const row = candidate(sqlite);
  assert.deepEqual(kcStageOutboxLineageGate({ ...row, market_key: 'ut', stage_market_key: 'ut' }), { ok: true });
  assert.deepEqual(kcStageOutboxLineageGate({ ...row, market_key: 'mo_stl', stage_market_key: 'mo_stl' }), { ok: true });
  assert.deepEqual(kcStageOutboxLineageGate({ ...row, market_key: 'ut',
    stage_market_key: 'ut', attribution_path: 'quo_call' }), { ok: true });
});
