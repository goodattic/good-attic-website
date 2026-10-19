import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildSoldJobCallShadowCandidate, collectSoldJobCallShadow,
  formatSoldJobCallValidationPayload } from '../server/sold-job-call-shadow.js';

const encoded = (type, n) => btoa(`gid://Jobber/${type}/${n}`);
const account = encoded('Account', 2498432);
const client = encoded('Client', 155986226);
const originalRequest = encoded('Request', 35017089);
const operationalRequest = encoded('Request', 35017723);
const quoteId = encoded('Quote', 99001);
const callAt = '2026-10-12T19:45:45Z';
const approvedAt = '2026-10-15T20:00:00Z';
const event = {
  event_id: `call-origin:${account}:ACclara:owner-verified-1:${operationalRequest}:quote_approved:${quoteId}`,
  account_id: account, market_key: 'ut', quo_call_id: 'ACclara',
  original_request_id: originalRequest, operational_request_id: operationalRequest,
  client_id: client, call_started_at_utc: callAt, evidence_kind: 'verified_lineage',
  event_name: 'quote_approved', source_object_type: 'quote', source_object_id: quoteId,
  occurred_at: approvedAt, assessment_id: null, quote_id: quoteId, job_id: null,
  observed_at: '2026-10-15T20:01:00Z', link_decision_id: 'owner-verified-1',
};
const quote = { id: quoteId, request: { id: operationalRequest }, client: { id: client },
  quoteStatus: 'approved', lastTransitioned: { approvedAt }, amounts: { total: 2450.75 } };
const objectRow = { market_key: 'ut', object_type: 'quote', object_id: quoteId,
  object_json: JSON.stringify(quote) };
const quoCall = { account_id: account, market: 'utah', quo_call_id: 'ACclara',
  jobber_request_id: originalRequest, jobber_client_id: client, caller_phone: '+16142166149',
  destination_number: '+13853364442', call_started_at_utc: callAt, direction: 'incoming' };
const googleMatch = { google_resource: 'customers/4800890529/callViews/1234',
  campaign_id: 'ads-123', campaign_name: 'Search | UT | Attic', market_key: 'ut',
  call_started_at_original: '2026-10-12 13:45:40-06:00',
  call_started_at_utc: '2026-10-12T19:45:40Z', caller_area_code: '614',
  match_state: 'matched', diagnostic_code: null, quo_call_id: 'ACclara',
  match_delta_seconds: 5 };
const lineage = { account_id: account, quo_call_id: 'ACclara', market_key: 'ut',
  original_request_id: originalRequest, operational_request_id: operationalRequest,
  client_id: client, call_started_at_utc: callAt, decision_id: 'owner-verified-1', revision: 0 };
const consent = { status: 'granted', evidence_ref: 'reviewed-policy-record-1' };
const now = '2026-10-20T00:00:00Z';

function source(overrides = {}) {
  return { shadowEvent: event, objectRow, quoCall, googleMatches: [googleMatch],
    lineageLink: lineage, websiteClickRows: [], consent, now, ...overrides };
}
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE quo_call_attributions (
    account_id TEXT, market TEXT, quo_call_id TEXT, jobber_request_id TEXT,
    jobber_client_id TEXT, caller_phone TEXT, destination_number TEXT,
    call_started_at_utc TEXT, direction TEXT
  )`);
  for (const name of ['0009_google_ads_outcome_outbox', '0010_stage1_shadow',
    '0017_call_request_lineage', '0018_call_origin_stage3c_shadow',
    '0020_google_call_match_shadow', '0021_sold_job_call_shadow',
    '0023_call_request_lineage_supersessions', '0022_call_origin_shadow_replay',
    '0025_sold_job_call_active_lineage']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  return { sqlite, prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } }; },
  }; } };
}
function fill(db, { withLink = true, direct = false } = {}) {
  const { sqlite } = db;
  const observedEvent = direct ? { ...event,
    event_id: `call-origin:${account}:ACclara:direct:${originalRequest}:quote_approved:${quoteId}`,
    operational_request_id: originalRequest, evidence_kind: 'original_request',
    link_decision_id: null } : event;
  const observedQuote = direct ? { ...quote, request: { id: originalRequest } } : quote;
  const eventFields = Object.keys(observedEvent);
  sqlite.prepare(`INSERT INTO call_origin_shadow_events
    (${eventFields.join(',')}) VALUES (${eventFields.map(() => '?').join(',')})`)
    .run(...Object.values(observedEvent));
  sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
    (market_key,object_type,object_id,request_id,client_id,object_json,observed_at)
    VALUES (?,?,?,?,?,?,?)`).run('ut', 'quote', quoteId,
    direct ? originalRequest : operationalRequest, client,
    JSON.stringify(observedQuote), now);
  sqlite.prepare('INSERT INTO quo_call_attributions VALUES (?,?,?,?,?,?,?,?,?)')
    .run(...Object.values(quoCall));
  if (withLink) sqlite.prepare(`INSERT INTO call_request_lineage_links
    (account_id,quo_call_id,market_key,original_request_id,operational_request_id,
     client_id,call_started_at_utc,decision_id,verified_by,evidence_ref,verified_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(account, 'ACclara', 'ut', originalRequest,
    operationalRequest, client, callAt, 'owner-verified-1', 'owner',
    'jobber_history', now);
  sqlite.prepare(`INSERT INTO google_call_match_shadow
    (google_resource,campaign_id,campaign_name,market_key,call_started_at_original,
    call_started_at_utc,caller_area_code,match_state,diagnostic_code,quo_call_id,
    match_delta_seconds,first_seen_at,last_checked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(googleMatch.google_resource,
      googleMatch.campaign_id, googleMatch.campaign_name, 'ut',
      googleMatch.call_started_at_original, googleMatch.call_started_at_utc,
      '614', 'matched', null, 'ACclara', 5, now, now);
}

test('verified call, operational Request and approved quote build validate-only CallConversion without orderId', () => {
  const result = buildSoldJobCallShadowCandidate(source());
  assert.equal(result.ok, true);
  assert.equal(result.candidate.state, 'shadow_ready');
  assert.equal(result.candidate.identity_verified, 1);
  assert.deepEqual(result.reasons, []);
  const payload = JSON.parse(result.candidate.payload_json);
  assert.equal(payload.validateOnly, true);
  assert.equal(payload.partialFailure, true);
  assert.equal(payload.customerId, '4800890529');
  assert.equal(payload.conversions[0].conversionAction,
    'customers/4800890529/conversionActions/7788072382');
  assert.equal(payload.conversions[0].callStartDateTime, '2026-10-12 13:45:40-06:00');
  assert.equal(payload.conversions[0].conversionDateTime, '2026-10-15 14:00:00-06:00');
  assert.equal(payload.conversions[0].conversionValue, 2450.75);
  assert.equal(payload.conversions[0].consent.adUserData, 'GRANTED');
  assert.ok(!Object.hasOwn(payload.conversions[0], 'orderId'));
  assert.ok(!Object.hasOwn(payload.conversions[0], 'gclid'));
  assert.throws(() => formatSoldJobCallValidationPayload({
    ...result.candidate, caller_phone: '+123' }), /unverified/);
});

test('repeat collection keeps one candidate and one append-only evidence row, separate from live outbox', async () => {
  const db = database(); fill(db);
  const options = { database: db, consentByCall: { ACclara: consent }, now };
  assert.deepEqual(await collectSoldJobCallShadow(options), {
    ok: true, mode: 'shadow', upload_enabled: false, observed: 1,
    shadow_ready: 1, held: 0, conflicts: 0 });
  await collectSoldJobCallShadow(options);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_candidates').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_evidence').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM google_ads_outcome_outbox').get().n, 0);
  const saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.google_conversion_action, '7788072382');
  assert.equal(saved.quote_id, quoteId);
  assert.equal(saved.operational_request_id, operationalRequest);
  assert.equal(saved.value_micros, 2450750000);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 1);
});

test('website click on either Request holds the call sale to prevent dual paid paths', async () => {
  const db = database(); fill(db);
  db.sqlite.prepare(`INSERT INTO closed_loop_stage1_leads
    (market_key,request_id,lead_id,inquiry_at,gclid,source,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run('ut', originalRequest, 'website-1', callAt,
      'gclid-1', 'test', now);
  const result = await collectSoldJobCallShadow({ database: db,
    consentByCall: { ACclara: consent }, now });
  assert.equal(result.held, 1);
  const saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.identity_verified, 1);
  assert.equal(saved.payload_json, null);
  assert.ok(JSON.parse(saved.hold_reasons_json).includes('website_click_path_exists_review'));
});

test('missing match or consent holds while preserving reasons; later proof appends evidence', async () => {
  const db = database(); fill(db);
  db.sqlite.exec('DELETE FROM google_call_match_shadow');
  await collectSoldJobCallShadow({ database: db, now });
  let saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.identity_verified, 0);
  assert.ok(JSON.parse(saved.hold_reasons_json).includes('google_call_match_missing'));
  assert.ok(JSON.parse(saved.hold_reasons_json).includes('ad_user_data_consent_unverified'));
  assert.equal(saved.payload_json, null);
  db.sqlite.prepare(`INSERT INTO google_call_match_shadow
    (google_resource,campaign_id,campaign_name,market_key,call_started_at_original,
    call_started_at_utc,caller_area_code,match_state,diagnostic_code,quo_call_id,
    match_delta_seconds,first_seen_at,last_checked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(googleMatch.google_resource,
      googleMatch.campaign_id, googleMatch.campaign_name, 'ut',
      googleMatch.call_started_at_original, googleMatch.call_started_at_utc,
      '614', 'matched', null, 'ACclara', 5, now, now);
  await collectSoldJobCallShadow({ database: db, consentByCall: { ACclara: consent }, now });
  saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.state, 'shadow_ready');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_evidence').get().n, 2);
});

test('lineage, client, campaign, approval and amount conflicts each hold', () => {
  const variants = [
    [{ lineageLink: null }, 'verified_request_lineage_missing_or_conflicting'],
    [{ quoCall: { ...quoCall, jobber_client_id: encoded('Client', 2) } }, 'quo_call_identity_conflict'],
    [{ googleMatches: [{ ...googleMatch, campaign_name: 'Search | MO-STL | Attic' }] },
      'google_call_identity_conflict'],
    [{ objectRow: { ...objectRow, object_json: JSON.stringify({ ...quote, quoteStatus: 'archived' }) } },
      'quote_status_not_approved'],
    [{ objectRow: { ...objectRow, object_json: JSON.stringify({ ...quote, amounts: { total: null } }) } },
      'approved_quote_amount_unavailable'],
  ];
  for (const [patch, reason] of variants) {
    const candidate = buildSoldJobCallShadowCandidate(source(patch)).candidate;
    assert.equal(candidate.state, 'held', reason);
    assert.equal(candidate.payload_json, null, reason);
    assert.ok(JSON.parse(candidate.hold_reasons_json).includes(reason), reason);
  }
});

test('a second call for the same quote cannot overwrite the local candidate identity', async () => {
  const db = database(); fill(db);
  await collectSoldJobCallShadow({ database: db, consentByCall: { ACclara: consent }, now });
  const second = { ...event, event_id: `${event.event_id}:other`, quo_call_id: 'ACother' };
  const eventFields = Object.keys(second);
  db.sqlite.prepare(`INSERT INTO call_origin_shadow_events
    (${eventFields.join(',')}) VALUES (${eventFields.map(() => '?').join(',')})`)
    .run(...Object.values(second));
  const result = await collectSoldJobCallShadow({ database: db,
    consentByCall: { ACclara: consent }, now });
  assert.equal(result.observed, 1); // The unsupported second call is not current lineage.
  assert.equal(result.conflicts, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_candidates').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT quo_call_id FROM sold_job_call_shadow_candidates').get().quo_call_id, 'ACclara');
});

test('a second approved quote for one call holds the sale until source precedence is reviewed', async () => {
  const db = database(); fill(db);
  const secondQuoteId = encoded('Quote', 99002);
  const secondApproval = '2026-10-16T20:00:00Z';
  const secondEvent = { ...event, event_id: `${event.event_id}:revision`,
    quote_id: secondQuoteId, source_object_id: secondQuoteId,
    occurred_at: secondApproval };
  const eventFields = Object.keys(secondEvent);
  db.sqlite.prepare(`INSERT INTO call_origin_shadow_events
    (${eventFields.join(',')}) VALUES (${eventFields.map(() => '?').join(',')})`)
    .run(...Object.values(secondEvent));
  const secondQuote = { ...quote, id: secondQuoteId,
    lastTransitioned: { approvedAt: secondApproval } };
  db.sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
    (market_key,object_type,object_id,request_id,client_id,object_json,observed_at)
    VALUES (?,?,?,?,?,?,?)`).run('ut', 'quote', secondQuoteId,
      operationalRequest, client, JSON.stringify(secondQuote), now);
  const result = await collectSoldJobCallShadow({ database: db,
    consentByCall: { ACclara: consent }, now });
  assert.equal(result.shadow_ready, 0);
  assert.equal(result.held, 2);
  assert.equal(result.conflicts, 0);
  const saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').all();
  assert.equal(saved.length, 2);
  assert.ok(saved.every(row => row.state === 'held' && JSON.parse(row.hold_reasons_json)
    .includes('multiple_approved_quotes_for_call_review')));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 0);
});

test('supersession immediately holds the old candidate, then a verified correction back to the original Request can rebuild it', async () => {
  const db = database(); fill(db);
  const options = { database: db, consentByCall: { ACclara: consent }, now };
  await collectSoldJobCallShadow(options);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 1);
  db.sqlite.prepare(`INSERT INTO call_request_lineage_supersessions
    (decision_id,account_id,quo_call_id,revision,prior_decision_id,
     operational_request_id,verified_by,evidence_ref,verified_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('owner-correction-1', account, 'ACclara', 1,
      'owner-verified-1', originalRequest, 'owner', 'jobber_history_correction', now);
  let saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.state, 'held');
  assert.equal(saved.payload_json, null);
  assert.deepEqual(JSON.parse(saved.hold_reasons_json), ['lineage_superseded']);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_evidence').get().n, 2);
  assert.equal((await collectSoldJobCallShadow(options)).observed, 0);

  const correctedEvent = { ...event,
    event_id: `call-origin:${account}:ACclara:owner-correction-1:${originalRequest}:quote_approved:${quoteId}`,
    operational_request_id: originalRequest, link_decision_id: 'owner-correction-1' };
  const eventFields = Object.keys(correctedEvent);
  db.sqlite.prepare(`INSERT INTO call_origin_shadow_events
    (${eventFields.join(',')}) VALUES (${eventFields.map(() => '?').join(',')})`)
    .run(...Object.values(correctedEvent));
  const correctedQuote = { ...quote, request: { id: originalRequest } };
  db.sqlite.prepare(`UPDATE closed_loop_stage1_objects SET request_id = ?, object_json = ?
    WHERE market_key = 'ut' AND object_type = 'quote' AND object_id = ?`)
    .run(originalRequest, JSON.stringify(correctedQuote), quoteId);
  const rebuilt = await collectSoldJobCallShadow(options);
  assert.equal(rebuilt.observed, 1);
  assert.equal(rebuilt.shadow_ready, 1);
  saved = db.sqlite.prepare('SELECT * FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.source_event_id, correctedEvent.event_id);
  assert.equal(saved.operational_request_id, originalRequest);
  assert.equal(saved.state, 'shadow_ready');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_evidence').get().n, 3);
  assert.throws(() => db.sqlite.exec('DELETE FROM sold_job_call_shadow_evidence'), /immutable/);
});

test('stale decision ID cannot claim a corrected original Request even when all account and Client fields agree', () => {
  const correctedEvent = { ...event, operational_request_id: originalRequest,
    link_decision_id: 'outdated-decision' };
  const correctedQuote = { ...quote, request: { id: originalRequest } };
  const result = buildSoldJobCallShadowCandidate(source({
    shadowEvent: correctedEvent,
    objectRow: { ...objectRow, object_json: JSON.stringify(correctedQuote) },
    lineageLink: { ...lineage, operational_request_id: originalRequest,
      decision_id: 'owner-correction-1', revision: 1 },
  }));
  assert.equal(result.candidate.state, 'held');
  assert.ok(result.reasons.includes('verified_request_lineage_missing_or_conflicting'));
});

test('a corrected Request with a different approved Quote gets a new current candidate while the old one stays held', async () => {
  const db = database(); fill(db);
  const options = { database: db, consentByCall: { ACclara: consent }, now };
  await collectSoldJobCallShadow(options);
  db.sqlite.prepare(`INSERT INTO call_request_lineage_supersessions
    (decision_id,account_id,quo_call_id,revision,prior_decision_id,
     operational_request_id,verified_by,evidence_ref,verified_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('owner-correction-2', account, 'ACclara', 1,
      'owner-verified-1', originalRequest, 'owner', 'jobber_history_correction', now);
  const newQuoteId = encoded('Quote', 99003);
  const newApproval = '2026-10-16T20:00:00Z';
  const correctedEvent = { ...event,
    event_id: `call-origin:${account}:ACclara:owner-correction-2:${originalRequest}:quote_approved:${newQuoteId}`,
    operational_request_id: originalRequest, link_decision_id: 'owner-correction-2',
    source_object_id: newQuoteId, quote_id: newQuoteId, occurred_at: newApproval };
  const eventFields = Object.keys(correctedEvent);
  db.sqlite.prepare(`INSERT INTO call_origin_shadow_events
    (${eventFields.join(',')}) VALUES (${eventFields.map(() => '?').join(',')})`)
    .run(...Object.values(correctedEvent));
  const correctedQuote = { ...quote, id: newQuoteId, request: { id: originalRequest },
    lastTransitioned: { approvedAt: newApproval }, amounts: { total: 3100 } };
  db.sqlite.prepare(`INSERT INTO closed_loop_stage1_objects
    (market_key,object_type,object_id,request_id,client_id,object_json,observed_at)
    VALUES (?,?,?,?,?,?,?)`).run('ut', 'quote', newQuoteId,
      originalRequest, client, JSON.stringify(correctedQuote), now);
  const result = await collectSoldJobCallShadow(options);
  assert.equal(result.shadow_ready, 1);
  const rows = db.sqlite.prepare('SELECT quote_id,state FROM sold_job_call_shadow_candidates ORDER BY quote_id').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.state).sort(), ['held', 'shadow_ready']);
  assert.equal(db.sqlite.prepare('SELECT quote_id FROM sold_job_call_shadow_current_ready').get().quote_id, newQuoteId);
});

test('the first verified Request move immediately retires an existing direct-Request candidate', async () => {
  const db = database(); fill(db, { withLink: false, direct: true });
  const options = { database: db, consentByCall: { ACclara: consent }, now };
  assert.equal((await collectSoldJobCallShadow(options)).shadow_ready, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 1);
  db.sqlite.prepare(`INSERT INTO call_request_lineage_links
    (account_id,quo_call_id,market_key,original_request_id,operational_request_id,
     client_id,call_started_at_utc,decision_id,verified_by,evidence_ref,verified_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(account, 'ACclara', 'ut', originalRequest,
    operationalRequest, client, callAt, 'owner-verified-1', 'owner',
    'jobber_history', now);
  const saved = db.sqlite.prepare('SELECT state,payload_json,hold_reasons_json FROM sold_job_call_shadow_candidates').get();
  assert.equal(saved.state, 'held');
  assert.equal(saved.payload_json, null);
  assert.deepEqual(JSON.parse(saved.hold_reasons_json), ['lineage_superseded']);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 0);
});

test('the current-ready view closes immediately when a Google call match is demoted or a website click arrives', async () => {
  const db = database(); fill(db);
  await collectSoldJobCallShadow({ database: db, consentByCall: { ACclara: consent }, now });
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 1);
  db.sqlite.prepare(`UPDATE google_call_match_shadow SET match_state = 'held',
    diagnostic_code = 'multiple_google_calls_for_quo_call', quo_call_id = NULL,
    match_delta_seconds = NULL WHERE google_resource = ?`).run(googleMatch.google_resource);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 0);
  db.sqlite.prepare(`UPDATE google_call_match_shadow SET match_state = 'matched',
    diagnostic_code = NULL, quo_call_id = 'ACclara', match_delta_seconds = 5
    WHERE google_resource = ?`).run(googleMatch.google_resource);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 1);
  db.sqlite.prepare(`INSERT INTO closed_loop_stage1_leads
    (market_key,request_id,lead_id,inquiry_at,gclid,source,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run('ut', operationalRequest, 'late-web-click', callAt,
    'late-gclid', 'test', now);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sold_job_call_shadow_current_ready').get().n, 0);
});
