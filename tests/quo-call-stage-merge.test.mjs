import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mergeStagedQuoCall } from '../server/quo-call-stage-merge.js';

const sql = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
const ready = { workerAutoRequestsEnabled:false, pagesAutoRequestsEnabled:false,
  brokerWritesDrained:true, inFlightBrokerWrites:0 };
const AT = '2026-10-03T15:00:00.000Z';
const staged = {
  account_id:'account-ut', quo_call_id:'ACone', market:'utah', phone_number_id:'PNutah',
  caller_phone:'+18015550100', call_started_at_original:'2026-10-02T14:30:19Z',
  call_started_at_utc:'2026-10-02T14:30:19.000Z', destination_number:'+13853364442',
  direction:'incoming', final_status:'completed', duration_seconds:64,
  answered_at:'2026-10-02T14:30:25.000Z', first_time_caller_status:'first-time',
  source_event_id:'EVcanonical', conversation_id:'CNone',
  created_at:'2026-10-02T14:31:00.000Z', updated_at:'2026-10-02T14:32:00.000Z',
};

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(sql('0008_quo_call_attributions'));
  sqlite.exec(sql('0018_quo_call_capture_stage'));
  sqlite.exec(sql('0019_quo_call_attributions_kc'));
  sqlite.exec(readFileSync(new URL('./fixtures/quo-intake-operations.sql', import.meta.url), 'utf8'));
  const db = { prepare(query) { let args=[]; return {
    bind(...values) { args=values; return this; },
    async first() { return sqlite.prepare(query).get(...args) || null; },
    async run() { return { success:true, meta:{ changes:sqlite.prepare(query).run(...args).changes } }; },
  }; } };
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  const putStage = (overrides={}) => insert('quo_call_capture_stage', {...staged,...overrides});
  const broker = (overrides={}) => insert('quo_call_attributions', {
    attribution_id:'quo-call:account-ut:ACone',account_id:staged.account_id,market:staged.market,
    phone_number_id:staged.phone_number_id,quo_call_id:staged.quo_call_id,caller_phone:staged.caller_phone,
    call_started_at_original:'2026-10-02T08:30:19-06:00',call_started_at_utc:staged.call_started_at_utc,
    destination_number:staged.destination_number,direction:'incoming',final_status:'ringing',
    duration_seconds:0,jobber_request_id:'RequestAuto',jobber_client_id:'ClientAuto',
    source_event_id:'EVbroker',conversation_id:'CNone',google_upload_http_status:208,
    google_upload_diagnostic:'preserve',consent_evidence:'preserve',
    created_at:'2026-10-02T14:30:20.000Z',updated_at:'2026-10-02T14:30:20.000Z',...overrides,
  });
  const owner = ({state='completed',requestId='RequestAuto',clientId='ClientAuto',uncertain=0}={}) => {
    const source = {type:'call',id:staged.quo_call_id,from:staged.caller_phone,to:staged.destination_number,
      direction:'incoming',occurred_at:'2026-10-02T14:30:19.000Z',
      occurred_at_original:'2026-10-02T08:30:19-06:00',event_id:'EVbroker',conversation_id:'CNone'};
    insert('quo_intake_operations', {operation_id:'op-one',operation_kind:'intake',account_id:staged.account_id,
      market:staged.market,phone:staged.caller_phone,phone_number_id:staged.phone_number_id,
      intent_sha256:'hash',source_json:JSON.stringify(source),operation_state:state,
      request_id:requestId,client_id:clientId,uncertain,
      created_at:staged.created_at,updated_at:staged.updated_at});
    insert('quo_intake_source_guards', {account_id:staged.account_id,source_type:'call',
      source_id:staged.quo_call_id,operation_id:'op-one',created_at:staged.created_at});
  };
  const merge = (overrides={}) => mergeStagedQuoCall(db,{accountId:staged.account_id,
    quoCallId:staged.quo_call_id,cutover:ready,at:AT,...overrides});
  return {db,sqlite,putStage,broker,owner,merge};
}

test('merge refuses all writes until both auto-Request flags are off and broker writes drain', async () => {
  const db = { prepare() { throw Error('database must not be touched'); } };
  for (const cutover of [null,{...ready,workerAutoRequestsEnabled:true},
    {...ready,pagesAutoRequestsEnabled:true},{...ready,brokerWritesDrained:false},
    {...ready,inFlightBrokerWrites:1}]) {
    assert.equal((await mergeStagedQuoCall(db,{accountId:'a',quoCallId:'c',cutover})).reason,'cutover_not_ready');
  }
  const f=fixture();f.putStage();f.owner({state:'pending',requestId:null,clientId:null});
  assert.equal((await f.merge()).reason,'cutover_not_ready');
  assert.equal(f.sqlite.prepare('SELECT merged_at,hold_reason FROM quo_call_capture_stage').get().merged_at,null);
  f.sqlite.close();
});

test('merge preserves broker identity, Jobber links, Google and consent evidence across replay', async () => {
  const f=fixture();f.putStage();f.broker();
  assert.deepEqual(await f.merge(),{ok:true,merged:true});
  const live=f.sqlite.prepare('SELECT * FROM quo_call_attributions').get();
  assert.equal(live.final_status,'completed');
  assert.equal(live.duration_seconds,64);
  assert.equal(live.answered_at,staged.answered_at);
  assert.equal(live.source_event_id,'EVbroker');
  assert.equal(live.call_started_at_original,'2026-10-02T08:30:19-06:00');
  assert.equal(live.jobber_request_id,'RequestAuto');
  assert.equal(live.jobber_client_id,'ClientAuto');
  assert.equal(live.google_upload_status,'not_submitted');
  assert.equal(live.google_upload_http_status,208);
  assert.equal(live.google_upload_diagnostic,'preserve');
  assert.equal(live.consent_status,'unknown');
  assert.equal(live.consent_evidence,'preserve');
  assert.equal(f.sqlite.prepare('SELECT merged_at FROM quo_call_capture_stage').get().merged_at,AT);
  assert.deepEqual(await f.merge(),{ok:true,alreadyMerged:true});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM quo_call_attributions').get().n,1);
  f.sqlite.close();
});

test('stage-only call inserts once; a completed broker operation supplies its Request link', async () => {
  const f=fixture();f.putStage();f.owner();
  assert.deepEqual(await f.merge(),{ok:true,merged:true});
  const live=f.sqlite.prepare('SELECT * FROM quo_call_attributions').get();
  assert.equal(live.jobber_request_id,'RequestAuto');
  assert.equal(live.jobber_client_id,'ClientAuto');
  assert.equal(live.source_event_id,'EVbroker');
  assert.equal(live.call_started_at_original,'2026-10-02T08:30:19-06:00');
  assert.equal(live.final_status,'completed');
  assert.deepEqual(await f.merge(),{ok:true,alreadyMerged:true});
  f.sqlite.close();
});

test('stage-only call without broker ownership inserts with no Jobber links', async () => {
  const f=fixture();f.putStage({quo_call_id:'ACone',market:'kc',phone_number_id:'PNkc',destination_number:'+18164340308'});
  assert.deepEqual(await f.merge(),{ok:true,merged:true});
  const live=f.sqlite.prepare('SELECT * FROM quo_call_attributions').get();
  assert.equal(live.market,'kc');
  assert.equal(live.jobber_request_id,null);
  assert.equal(live.jobber_client_id,null);
  assert.equal(live.source_event_id,'EVcanonical');
  f.sqlite.close();
});

test('identity conflict and unresolved broker operation hold stage without overwriting ledger', async () => {
  const conflict=fixture();conflict.putStage();conflict.broker({caller_phone:'+18015550999'});
  assert.deepEqual(await conflict.merge(),{ok:false,held:true,reason:'ledger_identity_conflict'});
  assert.equal(conflict.sqlite.prepare('SELECT final_status FROM quo_call_attributions').get().final_status,'ringing');
  assert.equal(conflict.sqlite.prepare('SELECT hold_reason FROM quo_call_capture_stage').get().hold_reason,'ledger_identity_conflict');
  conflict.sqlite.close();

  const unresolved=fixture();unresolved.putStage();unresolved.owner({state:'held',requestId:null,clientId:null,uncertain:1});
  assert.deepEqual(await unresolved.merge(),{ok:false,held:true,reason:'auto_request_unresolved'});
  assert.equal(unresolved.sqlite.prepare('SELECT COUNT(*) AS n FROM quo_call_attributions').get().n,0);
  unresolved.sqlite.close();
});
