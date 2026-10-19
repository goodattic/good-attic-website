import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {phoneLeadWatchCycle,requestedPhoneLeadWatchCycle,loadLeadWatchSnapshot,phoneLeadWatchHealth} from '../server/phone-lead-watch-runtime.js';
import {watchFailure} from '../server/phone-lead-watch-diagnostics.js';

function database(failTable) {
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../migrations/0030_phone_lead_watch.sql',import.meta.url),'utf8'));
 const writes=[];
 return {sqlite,writes,prepare(sql){let args=[];return {bind(...a){args=a;return this;},async run(){
  assert.match(sql,/phone_lead_watch_(runs|sources|results)/);writes.push(sql);
  if(failTable&&sql.startsWith('INSERT INTO '+failTable))throw Error('Too many subrequests.');
  return {meta:sqlite.prepare(sql).run(...args)};
 },async all(){return{results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;}};}};
}
const schedule=Date.parse('2026-10-14T18:00:44Z'),end=Date.parse('2026-10-14T18:01:12Z');
const snapshot={googleCalls:[],quoCalls:[],clients:[],leads:[],objects:[],now:new Date(schedule).toISOString()};
test('failure stores safe step/class/status/API and real completion time; public health stays aggregate-only',async()=>{
 const db=database(),env={ANGI_ROUTER_DB:db,PHONE_LEAD_WATCH_ENABLED:'true'};
 const result=await phoneLeadWatchCycle(env,{scheduledTime:schedule,clock:()=>end,loadSnapshot:async()=>{
  throw watchFailure(new TypeError('watch_quo_read_failed'),{step:'snapshot.quo_contacts',api:'quo',http_status:429});
 }});
 assert.deepEqual(result.failure,{step:'snapshot.quo_contacts',error_class:'TypeError',error_message:'watch_quo_read_failed',api:'quo',table:null,http_status:429});
 const stored=db.sqlite.prepare('SELECT * FROM phone_lead_watch_runs').get();
 assert.equal(stored.completed_at,'2026-10-14T18:01:12.000Z');assert.notEqual(stored.started_at,stored.completed_at);
 assert.deepEqual(JSON.parse(stored.summary_json).failure,result.failure);
 assert.equal((await phoneLeadWatchHealth(env)).last_run_status,'failed');
 assert.doesNotMatch(JSON.stringify(await phoneLeadWatchHealth(env)),/error_message|quo_contacts/);
});
test('unknown error text and cause cannot leak customer content, secrets, payment fields or URLs',()=>{
 const error=new Error('PRIVATE_CUSTOMER PRIVATE_PHONE PRIVATE_PAN expiry PRIVATE_EXPIRY cvc PRIVATE_CVC');
 error.cause=Error('PRIVATE_TOKEN https://example.com/PRIVATE_CLICK');error.name='PRIVATE_NAME';
 const d=watchFailure(error,{step:'PRIVATE_CUSTOMER',api:'PRIVATE_TOKEN',table:'PRIVATE_PHONE',http_status:'PRIVATE'}).watchDiagnostic;
 assert.doesNotMatch(JSON.stringify(d),/PRIVATE|https|expiry|cvc/);assert.equal(d.error_class,'Error');
});
test('database read failure keeps table even among concurrent reads',async()=>{
 const env={ANGI_ROUTER_DB:{prepare(){return{bind(){return this;},all(){throw Error('Too many subrequests.');}};}}};
 await assert.rejects(loadLeadWatchSnapshot(env,{googleCalls:[]}),e=>e.watchDiagnostic.table==='angi_router_jobber_auth'&&e.watchDiagnostic.api==='d1'&&e.watchDiagnostic.step==='snapshot.database');
});
test('live Google read failures retain OAuth versus search and HTTP status without the response body',async()=>{
 const env={GOOGLE_ADS_OAUTH_REFRESH_TOKEN:'fixture',ANGI_ROUTER_DB:{prepare(){return{bind(){return this;},async all(){return{results:[]};}};}}};
 for(const phase of ['token','calls']) {
  const db=database();env.ANGI_ROUTER_DB={...env.ANGI_ROUTER_DB};
  const fetcher=async url=>url.includes('oauth2')&&phase==='calls'?Response.json({access_token:'fixture'}):Response.json({error:'PRIVATE_BODY'},{status:403});
  await assert.rejects(loadLeadWatchSnapshot(env,{since:'2026-10-01',now:new Date(schedule).toISOString(),fetcher}),e=>{
   assert.equal(e.watchDiagnostic.step,'snapshot.google_'+phase);assert.equal(e.watchDiagnostic.http_status,403);
   assert.doesNotMatch(JSON.stringify(e.watchDiagnostic),/PRIVATE/);return true;
  });
 }
});
test('network timeout retains failing API and error class',async()=>{
 const env={GOOGLE_ADS_OAUTH_REFRESH_TOKEN:'fixture',ANGI_ROUTER_DB:{prepare(){return{bind(){return this;},async all(){return{results:[]};}};}}};
 await assert.rejects(loadLeadWatchSnapshot(env,{fetcher:async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');}}),e=>e.watchDiagnostic.api==='google_oauth'&&e.watchDiagnostic.error_class==='TimeoutError');
});
test('evaluation failure is recorded and no results or upload state are written',async()=>{
 const db=database();const r=await phoneLeadWatchCycle({ANGI_ROUTER_DB:db,PHONE_LEAD_WATCH_ENABLED:'true'},{scheduledTime:schedule,clock:()=>end,loadSnapshot:async()=>({...snapshot,googleCalls:{invalid:true}})});
 assert.equal(r.failure.step,'evaluate');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM phone_lead_watch_results').get().n,0);
});
test('source persistence failure records exact watch table; no uploader writes',async()=>{
 const db=database('phone_lead_watch_sources');
 const r=await phoneLeadWatchCycle({ANGI_ROUTER_DB:db,PHONE_LEAD_WATCH_ENABLED:'true'},{scheduledTime:schedule,clock:()=>end,loadSnapshot:async()=>({...snapshot,googleCalls:[{google_resource:'fixture',market_key:'ut',start_call_date_time:'2026-10-14T17:00:00Z'}]})});
 assert.equal(r.failure.table,'phone_lead_watch_sources');assert.equal(r.failure.error_message,'Too many subrequests.');
 assert.ok(db.writes.every(sql=>/phone_lead_watch_/.test(sql)));
});
test('requested watch run claims once atomically, does not retry failure, and leaves normal schedule intact',async()=>{
 const db=database(),env={ANGI_ROUTER_DB:db,PHONE_LEAD_WATCH_ENABLED:'true'};let reads=0;
 const key='watch-manual:11111111-1111-4111-8111-111111111111';
 db.sqlite.prepare("INSERT INTO phone_lead_watch_runs(run_key,started_at,status,diagnostic_code) VALUES(?,?,'running','watch_run_requested')").run(key,new Date(schedule).toISOString());
 const opts={scheduledTime:schedule,clock:()=>end,loadSnapshot:async()=>{reads++;throw Error('watch_contacts_incomplete');}};
 await Promise.all([requestedPhoneLeadWatchCycle(env,opts),requestedPhoneLeadWatchCycle(env,opts)]);
 assert.equal(reads,1);assert.equal((await requestedPhoneLeadWatchCycle(env,opts)).skipped,true);
 await phoneLeadWatchCycle(env,{...opts,loadSnapshot:async()=>{reads++;return snapshot;}});
 assert.equal(reads,2);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM phone_lead_watch_runs').get().n,2);
 assert.equal((await requestedPhoneLeadWatchCycle({...env,PHONE_LEAD_WATCH_ENABLED:'false'},opts)).disabled,true);
});
