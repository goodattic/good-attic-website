import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {firstScheduledObservation,health} from '../server/stage2-health.js';
import {validationCandidates,dataManagerValidationRequest,validateDataManagerOnly,EXTRA_EVENT_IDS} from '../server/stage2-validation.js';
const row={event_id:'sale',action:'7754270382',timestamp:'2026-08-24 21:56:33+00:00',value:123,gclid:'g',gbraid:'b',wbraid:'w'};
const env={GOOGLE_ADS_UPLOAD_ENABLED:'false',...Object.fromEntries(['OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REFRESH_TOKEN'].map(n=>['GOOGLE_DATA_MANAGER_'+n,'test']))};
test('one identifier, explicit offset, one destination and test-only request',()=>{
 const b=dataManagerValidationRequest(row);assert.equal(b.validateOnly,true);assert.equal(b.events[0].eventSource,'OTHER');assert.deepEqual(b.events[0].adIdentifiers,{gclid:'g'});assert.equal(b.events[0].eventTimestamp,'2026-08-24T21:56:33+00:00');assert.equal(b.destinations[0].operatingAccount.accountId,'4800890529');
 assert.throws(()=>dataManagerValidationRequest({...row,timestamp:'2026-08-24 21:56:33'}),/offset/);
 assert.deepEqual(dataManagerValidationRequest({...row,gclid:null}).events[0].adIdentifiers,{gbraid:'b'});
});
test('six frozen sales and precisely four extras selected; malformed baseline fails closed',()=>{
 const baseline=Array.from({length:6},(_,i)=>({event_id:'sale'+i,conversion_action:'GAE - Sold Job (CRM)',conversion_date_time:row.timestamp,conversion_value:1,gclid:'g'}));
 const candidates=validationCandidates(baseline,[]);assert.equal(candidates.length,10);assert.deepEqual(candidates.slice(6).map(r=>r.event_id),EXTRA_EVENT_IDS);assert.throws(()=>validationCandidates([],[]),/six/);
});
test('flag and missing credentials prevent Google calls',async()=>{
 const fetcher=()=>{throw Error('unexpected network')};
 await assert.rejects(validateDataManagerOnly([row],{...env,GOOGLE_ADS_UPLOAD_ENABLED:'true'},fetcher),/disabled/);
 const r=await validateDataManagerOnly([row],{GOOGLE_ADS_UPLOAD_ENABLED:'false'},fetcher);assert.equal(r.attempted,false);assert.equal(r.rows[0].result,'NOT_SENT_MISSING_CREDENTIALS');
});
test('one HTTP request per event, exact errors retained, later rows still validated',async()=>{
 const calls=[];const raw='{"error":{"code":400,"message":"Exact Google error"}}';
 const r=await validateDataManagerOnly([row,{...row,event_id:'second'}],env,async(url,opt)=>{
  calls.push({url,opt});if(url.includes('oauth2'))return Response.json({access_token:'secret-test'});
  return calls.length===2?new Response(raw,{status:400}):Response.json({});
 });
 assert.equal(calls.length,3);for(const c of calls.slice(1)){const b=JSON.parse(c.opt.body);assert.equal(b.validateOnly,true);assert.equal(b.events.length,1);}
 assert.equal(r.rows[0].google_response_raw,raw);assert.equal(r.rows[1].result,'VALIDATE_ONLY_HTTP_SUCCESS');assert.equal(r.recorded_conversions,0);assert.ok(!JSON.stringify(r).includes('secret-test'));
});
test('new appointment first observation is immutable; historical and invalid dates held',()=>{
 const cutoff='2026-09-23T18:00:00Z',observed='2026-09-23T19:00:00Z';
 const object={assessment:{startAt:'2026-09-25T00:00:00Z',endAt:'2026-09-25T01:00:00Z'}};
 assert.equal(firstScheduledObservation(null,object,false,cutoff,observed),observed);
 assert.equal(firstScheduledObservation({first_scheduled_at:observed},object,false,cutoff,'2026-09-24T00:00:00Z'),observed);
 assert.equal(firstScheduledObservation(null,object,true,cutoff,observed),null);
 assert.equal(firstScheduledObservation(null,{assessment:{startAt:cutoff,endAt:'2026-09-22T00:00:00Z'}},false,cutoff,observed),null);
 assert.equal(firstScheduledObservation(null,{assessment:{startAt:'bad',endAt:'bad'}},false,cutoff,observed),null);
});
function db(){const sqlite=new DatabaseSync(':memory:');for(const f of ['0009_google_ads_outcome_outbox','0010_stage1_shadow','0011_stage1_outbox','0012_stage2_observability'])sqlite.exec(readFileSync(new URL('../migrations/'+f+'.sql',import.meta.url),'utf8'));return {sqlite,prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)||null}}}};}
test('health excludes failed runs and distinguishes manual from scheduled without customer data',async()=>{
 const d=db(),time=new Date().toISOString();d.sqlite.prepare("INSERT INTO closed_loop_stage2_runs VALUES('a','manual',?,?,'success',7,2)").run(time,time);
 d.sqlite.prepare("INSERT INTO closed_loop_stage2_runs VALUES('b','scheduled',?,?,'failed',99,99)").run(time,time);
 const h=await health({ANGI_ROUTER_DB:d,GOOGLE_ADS_UPLOAD_ENABLED:'false'});assert.equal(h.last_successful_run_at,time);assert.equal(h.last_successful_scheduled_run_at,null);assert.equal(h.last_24h.events_processed,7);assert.equal(h.last_24h.webhooks_processed,2);assert.equal(h.google_upload_enabled,false);assert.equal(h.customer_data_exposed,false);
 d.sqlite.exec("UPDATE closed_loop_stage2_runs SET status='success' WHERE run_id='b'");assert.equal((await health({ANGI_ROUTER_DB:d})).last_successful_scheduled_run_at,time);
});
test('rerunning migration does not freeze newly observed appointments',()=>{
 const d=db();d.sqlite.exec("INSERT INTO closed_loop_stage1_objects(market_key,object_type,object_id,object_json,observed_at) VALUES('ut','request','new','{\"assessment\":{\"startAt\":\"2026-10-01\",\"endAt\":\"2026-10-02\"}}','2026-09-23')");
 d.sqlite.exec(readFileSync(new URL('../migrations/0012_stage2_observability.sql',import.meta.url),'utf8'));
 assert.equal(d.sqlite.prepare('SELECT count(*) n FROM closed_loop_stage2_historical_appointments').get().n,0);
});
