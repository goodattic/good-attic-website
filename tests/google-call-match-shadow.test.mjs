import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { googleCallEligible } from '../server/google-qualified-phone-collector.js';
import { evaluateGoogleCallMatches, googleCallMatchShadowCycle } from '../server/google-call-match-shadow.js';

const start = '2026-10-12T19:48:00Z';
const google = {
  google_resource: 'customers/4800890529/callViews/111',
  campaign_id: '123', campaign_name: 'Search | UT | Attic', market_key: 'ut',
  start_call_date_time: '2026-10-12 13:48:00-06:00',
  call_duration_seconds: 105, caller_area_code: '423', call_status: 'RECEIVED',
};
const quo = {
  quo_call_id: 'ACclara', market: 'utah', destination_number: '+13853364442',
  caller_phone: '+14233162808', call_started_at_utc: '2026-10-12T19:48:01Z',
  direction: 'incoming',
};

function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0020_google_call_match_shadow.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE quo_call_attributions (
    quo_call_id TEXT, market TEXT, destination_number TEXT, caller_phone TEXT,
    call_started_at_utc TEXT, direction TEXT
  )`);
  sqlite.exec('CREATE TABLE google_ads_outcome_outbox (outcome_id TEXT PRIMARY KEY)');
  return {
    sqlite,
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
}
function addQuo(database, call = quo) {
  database.sqlite.prepare('INSERT INTO quo_call_attributions VALUES(?,?,?,?,?,?)')
    .run(call.quo_call_id, call.market, call.destination_number, call.caller_phone,
      call.call_started_at_utc, call.direction);
}
function env(database) {
  return { ANGI_ROUTER_DB: database, GOOGLE_CALL_MATCH_SHADOW_ENABLED: 'true',
    QUALIFIED_PHONE_UPLOAD_ENABLED: 'true', GOOGLE_ADS_OAUTH_REFRESH_TOKEN: 'refresh-test',
    GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID: 'client-test',
    GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET: 'secret-test' };
}
function transport(callViews) {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'token-test' });
    if (url.includes('googleAds:searchStream')) return Response.json([{ results: callViews.map(callView => ({
      campaign: { id: '123', name: 'Search | UT | Attic' }, callView,
    })) }]);
    throw new Error(`unexpected_external_write:${url}`);
  };
  return { urls, fetcher };
}
const callView = {
  resourceName: google.google_resource, startCallDateTime: '2026-10-12 13:48:00',
  callDurationSeconds: '105', callerAreaCode: '423', callStatus: 'RECEIVED',
};

test('105-second Google call matches Clara Quo call in the shadow ledger without a qualified-lead upload', async () => {
  const database = db();
  addQuo(database);
  const wire = transport([callView]);
  const result = await googleCallMatchShadowCycle(env(database), {
    since: '2026-10-12', scheduledTime: Date.parse(start), fetcher: wire.fetcher,
  });
  assert.equal(googleCallEligible(google), false);
  assert.deepEqual(result, { completed: true, google_calls: 1, matched: 1, held: 0 });
  const row = database.sqlite.prepare('SELECT * FROM google_call_match_shadow').get();
  assert.equal(row.google_resource, google.google_resource);
  assert.equal(row.campaign_id, '123');
  assert.equal(row.campaign_name, 'Search | UT | Attic');
  assert.equal(row.call_started_at_utc, new Date(start).toISOString());
  assert.equal(row.call_duration_seconds, 105);
  assert.equal(row.quo_call_id, 'ACclara');
  assert.equal(row.match_state, 'matched');
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM google_ads_outcome_outbox').get().n, 0);
  assert.equal(wire.urls.filter(url => url.includes('uploadCallConversions')).length, 0);
  assert.equal((await googleCallMatchShadowCycle(env(database), {
    since: '2026-10-12', scheduledTime: Date.parse(start), fetcher: wire.fetcher,
  })).skipped, true);
});

test('multiple same-caller Quo calls or multiple Google calls for one Quo call are held', () => {
  const sameCaller = { ...quo, quo_call_id: 'ACsecond', call_started_at_utc: '2026-10-12T19:48:30Z' };
  const twoQuo = evaluateGoogleCallMatches([google], [quo, sameCaller]);
  assert.equal(twoQuo[0].match_state, 'held');
  assert.equal(twoQuo[0].diagnostic_code, 'multiple_quo_calls_same_caller');
  assert.equal(twoQuo[0].quo_call_id, null);
  const twoGoogle = evaluateGoogleCallMatches([google, {
    ...google, google_resource: 'customers/4800890529/callViews/222',
    start_call_date_time: '2026-10-12 13:48:20-06:00',
  }], [quo]);
  assert.deepEqual(twoGoogle.map(row => row.diagnostic_code),
    ['multiple_google_calls_for_quo_call', 'multiple_google_calls_for_quo_call']);
  assert.ok(twoGoogle.every(row => row.quo_call_id === null));
});

test('missing market, wrong area, and wrong account resource keep durable held reasons', async () => {
  const database = db();
  addQuo(database);
  const calls = [
    { ...google, google_resource: 'customers/4800890529/callViews/market', market_key: null },
    { ...google, google_resource: 'customers/4800890529/callViews/area', caller_area_code: '801' },
    { ...google, google_resource: 'customers/999/callViews/wrong' },
  ];
  const evaluations = evaluateGoogleCallMatches(calls, [quo]);
  assert.deepEqual(evaluations.map(row => row.diagnostic_code),
    ['google_call_missing_match_fields', 'no_matching_quo_call', 'google_resource_invalid']);
  const result = await googleCallMatchShadowCycle(env(database), {
    scheduledTime: Date.parse(start), since: '2026-10-12',
    readToken: async () => 'token', readCalls: async () => calls,
  });
  assert.equal(result.held, 3);
  const stored = database.sqlite.prepare('SELECT diagnostic_code FROM google_call_match_shadow ORDER BY google_resource').all();
  assert.equal(stored.length, 3);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM google_call_match_shadow_checks').get().n, 3);
});

test('a later competing Google resource demotes the prior match and records both diagnostics', async () => {
  const database = db();
  addQuo(database);
  const first = await googleCallMatchShadowCycle(env(database), {
    scheduledTime: Date.parse(start), since: '2026-10-12',
    readToken: async () => 'token', readCalls: async () => [google],
  });
  assert.equal(first.matched, 1);
  const second = await googleCallMatchShadowCycle(env(database), {
    scheduledTime: Date.parse(start) + 3 * 60 * 60 * 1000, since: '2026-10-12',
    readToken: async () => 'token', readCalls: async () => [{ ...google,
      google_resource: 'customers/4800890529/callViews/222',
      start_call_date_time: '2026-10-12 13:48:20-06:00' }],
  });
  assert.equal(second.matched, 0);
  assert.equal(database.sqlite.prepare("SELECT count(*) n FROM google_call_match_shadow WHERE match_state='matched'").get().n, 0);
  assert.equal(database.sqlite.prepare("SELECT count(*) n FROM google_call_match_shadow WHERE diagnostic_code='multiple_google_calls_for_quo_call'").get().n, 2);
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM google_call_match_shadow_checks').get().n, 3);
});

test('flag defaults off without database or network access', async () => {
  assert.deepEqual(await googleCallMatchShadowCycle({}), { disabled: true });
});
