import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {evaluateLeadWatch,mergeQuoEvidence,exclusionFromText,permanentConsentFailure,WATCH_LOOKBACK_MS} from '../server/phone-lead-watch-model.js';
import {serviceScopeFromText,combineServiceScopes} from '../server/phone-lead-watch-scope.js';
import {WATCH_KNOWN_REFUSALS} from '../server/phone-lead-watch-refusals.js';
import {phoneLeadWatchCycle,readOnlyTransport} from '../server/phone-lead-watch-runtime.js';
const at='2026-10-01T12:00:00Z';
function fixture(){return {
 now:'2026-10-13T20:00:00Z',
 googleCalls:[{google_resource:'customers/4800890529/callViews/test',market_key:'mo_stl',start_call_date_time:at,caller_area_code:'314',call_duration_seconds:200,call_status:'RECEIVED'}],
 quoCalls:[{quo_call_id:'ACtest',market:'stl',account_id:'2498453',destination_number:'+13149312620',phone_number_id:'PNline',caller_phone:'+13145550101',call_started_at_utc:'2026-10-01T12:00:00.600Z',direction:'incoming'}],
 clients:[{id:'100',market_key:'mo_stl',name:'Example Buyer',lastName:'Buyer',createdAt:'2026-10-01T12:01:00Z',isArchived:false,phones:[{number:'3145559999'},{number:'3145550101'}],emails:[{address:'example@example.test'}],history_complete:true}],
 objects:[{market_key:'mo_stl',object_type:'request',object_id:'200',client_id:'100',first_scheduled_at:'2026-10-01T12:04:00Z',object:{id:'200',createdAt:'2026-10-01T12:02:00Z',requestStatus:'converted',client:{id:'100'},assessment:{id:'300',startAt:'2026-10-02T12:00:00Z',endAt:'2026-10-02T13:00:00Z',isComplete:true,completedAt:'2026-10-02T13:00:00Z'},quotes:{nodes:[{id:'400'}]}}},
 {market_key:'mo_stl',object_type:'quote',object_id:'400',client_id:'100',object:{id:'400',createdAt:'2026-10-02T13:01:00Z',client:{id:'100'},request:{id:'201'},quoteStatus:'converted',amounts:{total:1000},lastTransitioned:{approvedAt:'2026-10-04T13:00:00Z'}}}],
 serviceScopes:{'customers/4800890529/callViews/test':serviceScopeFromText('Caller requests attic insulation')},
 ledger:[],phoneLedger:[],contacts:[],leads:[]
};}
const sale = r=>r.results.find(e=>e.type==='sold_job');
test('matches any client phone and results on another request; phone assessment has no destination',()=>{
 const r=evaluateLeadWatch(fixture());assert.equal(r.sources[0].delta_seconds,.6);assert.equal(sale(r).state,'would_send');
 assert.equal(sale(r).preview.conversionAction,'customers/4800890529/conversionActions/7788072382');
 assert.equal(r.results.find(e=>e.type==='assessment_completed').state,'no_destination');
});
test('uses alternate Quo contact number, but never chooses among multiple clients or markets',()=>{
 const f=fixture();f.clients[0].phones=[{number:'3145552222'}];f.contacts=[{phones:['+13145550101','+13145552222']}];
 assert.equal(sale(evaluateLeadWatch(f)).state,'would_send');f.clients.push({...f.clients[0],id:'101'});
 assert.ok(evaluateLeadWatch(f).sources[0].reasons.includes('multiple_jobber_clients'));
 f.clients.pop();f.quoCalls[0].destination_number='+13853364442';assert.ok(evaluateLeadWatch(f).sources[0].reasons.includes('market_line_mismatch'));
});
test('a clientless call stays pending for the full 14 days and resolves if staff add the client on day 13',()=>{
 const f=fixture();const clients=f.clients;f.clients=[];f.now=new Date(Date.parse(at)+WATCH_LOOKBACK_MS-1).toISOString();
 assert.equal(evaluateLeadWatch(f).sources[0].state,'pending');f.now=new Date(Date.parse(at)+WATCH_LOOKBACK_MS).toISOString();
 assert.equal(evaluateLeadWatch(f).sources[0].state,'manual_review');f.clients=clients;f.clients[0].createdAt='2026-10-13T12:00:00Z';
 f.objects=[];assert.equal(evaluateLeadWatch(f).sources[0].state,'matched');
});
test('5-second window rejects nearby unrelated calls; multiple exact calls are ambiguous',()=>{
 const f=fixture();f.quoCalls[0].call_started_at_utc='2026-10-01T12:00:05.001Z';assert.equal(evaluateLeadWatch(f).sources[0].quo,null);
 f.quoCalls[0].call_started_at_utc=at;f.quoCalls.push({...f.quoCalls[0],quo_call_id:'ACother'});
 assert.ok(evaluateLeadWatch(f).sources[0].reasons.includes('ambiguous_quo_call'));
});
test('a client first created after the 14-day retry window needs review',()=>{
 const f=fixture();f.now='2026-10-17T12:00:00Z';f.clients[0].createdAt='2026-10-16T12:00:00Z';f.objects=[];
 assert.ok(evaluateLeadWatch(f).sources[0].reasons.includes('client_added_after_retry_window'));
});
test('capture duplicates merge, but contradictory phone evidence cannot become a match',()=>{
 const q=fixture().quoCalls[0];assert.equal(mergeQuoEvidence([q],[q]).length,1);
 const f=fixture();f.quoCalls=mergeQuoEvidence([q],[{...q,caller_phone:'+13145550102'}]);assert.ok(evaluateLeadWatch(f).sources[0].reasons.includes('quo_evidence_conflict'));
});
test('earlier client or deleted request excludes a prospect even when the sale is later',()=>{
 const f=fixture();f.clients[0].createdAt='2026-09-30T12:00:00Z';assert.equal(sale(evaluateLeadWatch(f)).state,'held');
 f.clients[0].createdAt='2026-10-01T12:01:00Z';f.historicalRequests=[{market_key:'mo_stl',phone:'+13145550101',created_at:'2026-09-30T12:00:00Z'}];
 assert.ok(evaluateLeadWatch(f).sources[0].reasons.includes('historical_request_predates_ad'));
});
test('deleted click request follows exact email to current client and split assessment',()=>{
 const f=fixture();f.googleCalls=[];f.leads=[{market_key:'mo_stl',request_id:'deleted',emails:['EXAMPLE@EXAMPLE.TEST'],service:'Attic Insulation',inquiry_at:at,gclid:'gclid-test'}];
 const r=evaluateLeadWatch(f);assert.equal(r.results.find(e=>e.type==='assessment_completed').state,'would_send');
 assert.equal(sale(r).preview.gclid,'gclid-test');assert.equal(sale(r).preview.orderId,'gae-stl-sold-400');
});
test('form/Jobber timestamp precision handles same-second creation; genuinely older client is review',()=>{
 const f=fixture();f.googleCalls=[];f.clients[0].createdAt=at;f.leads=[{market_key:'mo_stl',request_id:'deleted',client_id:'100',service:'Attic Insulation',inquiry_at:'2026-10-01T12:00:00.012Z',gclid:'g'}];
 assert.equal(evaluateLeadWatch(f).sources[0].state,'matched');f.clients[0].createdAt='2026-10-01T11:59:59Z';
 assert.equal(evaluateLeadWatch(f).sources[0].state,'manual_review');
});
test('accepted sale is fenced across call/click and job/quote representations',()=>{
 const f=fixture();f.leads=[{market_key:'mo_stl',request_id:'200',client_id:'100',service:'Attic Insulation',inquiry_at:at,gclid:'g'}];
 f.objects.push({...f.objects[1],object_type:'job',object_id:'500',object:{id:'500',createdAt:'2026-10-04T14:00:00Z',client:{id:'100'},quote:f.objects[1].object}});
 let r=evaluateLeadWatch(f);assert.equal(r.results.filter(x=>x.type==='sold_job'&&x.state==='would_send').length,1);
 f.ledger=[{event_id:'gae-stl-sold-400',status:'accepted'}];r=evaluateLeadWatch(f);assert.equal(r.results.filter(x=>x.type==='sold_job'&&x.state==='would_send').length,0);
});
test('Apple ATT rejection is permanently failed on repeated evaluations, with no retry path',()=>{
 const f=fixture();f.ledger=[{event_id:'gae-stl-sold-400',status:'rejected',error_category:'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY'}];
 assert.equal(permanentConsentFailure(f.ledger[0]),true);for(let i=0;i<3;i++)assert.equal(sale(evaluateLeadWatch(f)).state,'permanently_failed');
});
test('excluded returning customer, wrong number, vendor and test never produce a sendable result',()=>{
 for(const kind of ['returning_customer','wrong_number','vendor','test']) {const f=fixture();f.exclusions=[{market_key:'mo_stl',phone:'+13145550101',kind}];assert.equal(evaluateLeadWatch(f).results.some(x=>x.state==='would_send'),false);}
 assert.equal(exclusionFromText('Is this Orkin?'),'wrong_number');assert.equal(exclusionFromText('Called to inquire about previous service.'),'returning_customer');
});
test('result must be after source and unknown dates/amounts are held',()=>{
 const f=fixture();f.objects[1].object.lastTransitioned.approvedAt=at;assert.equal(sale(evaluateLeadWatch(f)).state,'held');
 f.objects[1].object.lastTransitioned.approvedAt=null;assert.equal(sale(evaluateLeadWatch(f)).state,'held');
});
test('converted sale uses approval, conversion, then linked job creation without changing quote identity',()=>{
 const f=fixture(),q=f.objects[1].object;
 f.objects.push({market_key:'mo_stl',object_type:'job',object_id:'500',client_id:'100',object:{id:'500',createdAt:'2026-10-05T12:00:00Z',client:{id:'100'},quote:q}});
 q.lastTransitioned.convertedAt='2026-10-04T14:00:00Z';
 let r=sale(evaluateLeadWatch(f));assert.equal(r.time_basis,'approvedAt');assert.equal(r.at,'2026-10-04T13:00:00Z');
 q.lastTransitioned.approvedAt=null;r=sale(evaluateLeadWatch(f));assert.equal(r.time_basis,'convertedAt');assert.equal(r.at,'2026-10-04T14:00:00Z');
 q.lastTransitioned.convertedAt=null;r=sale(evaluateLeadWatch(f));assert.equal(r.time_basis,'job.createdAt');assert.equal(r.at,'2026-10-05T12:00:00Z');
 assert.equal(r.result_id,'gae-stl-sold-400');assert.equal(evaluateLeadWatch(f).results.filter(r=>r.type==='sold_job'&&r.state==='would_send').length,1);
 f.ledger=[{event_id:'gae-stl-sold-400',status:'accepted'}];assert.equal(sale(evaluateLeadWatch(f)).state,'already_accepted');
});
test('fallback never manufactures a post-ad time or uses creation of an unconverted quote',()=>{
 for(const field of ['approvedAt','convertedAt']) {
  const f=fixture(),q=f.objects[1].object;q.lastTransitioned={approvedAt:null,convertedAt:null,[field]:at};
  f.objects.push({market_key:'mo_stl',object_type:'job',object_id:'500',client_id:'100',object:{id:'500',createdAt:'2026-10-05T12:00:00Z',quote:q}});
  const r=sale(evaluateLeadWatch(f));assert.equal(r.state,'held');assert.ok(r.reasons.includes('result_not_after_ad'));
 }
 const f=fixture();f.objects[1].object.lastTransitioned={approvedAt:null,convertedAt:null};f.objects[1].object.quoteStatus='approved';
 assert.equal(sale(evaluateLeadWatch(f)).state,'held');
});
test('all five off-scope-only services block every call and form result',()=>{
 for(const text of ['I need spray foam insulation in my attic','Please quote an attic fan','Ventilation only','Mold removal only','Need blown-in insulation for my walls']) {
  const scope=serviceScopeFromText(text,'test-request');
  for(const path of ['call','click']) {
   const f=fixture();f.googleCalls[0].call_duration_seconds=20;
   if(path==='click'){f.googleCalls=[];f.leads=[{market_key:'mo_stl',request_id:'200',client_id:'100',inquiry_at:at,gclid:'g'}];}
   f.serviceScopes={[path==='call'?'customers/4800890529/callViews/test':'click:mo_stl:200']:scope};
   assert.equal(evaluateLeadWatch(f).results.some(r=>r.state==='would_send'),false,text+':'+path);
  }
 }
});
test('scope comes from inquiry or any same-market quote/job, and add-ons never veto attic work',()=>{
 const f=fixture(),key='customers/4800890529/callViews/test';
 f.serviceScopes[key]=serviceScopeFromText('Spray foam shed');
 f.objects[1].service_scope=serviceScopeFromText('Complete attic restoration with attic fan', 'quote:400',{record:true});
 assert.equal(sale(evaluateLeadWatch(f)).state,'would_send');assert.equal(evaluateLeadWatch(f).sources[0].service_scope.state,'in_scope');
 f.objects[1].market_key='ut';assert.equal(evaluateLeadWatch(f).sources[0].state,'excluded');
 f.objects[1].market_key='mo_stl';f.objects[1].client_id='someone-else';assert.equal(evaluateLeadWatch(f).sources[0].state,'excluded');
 f.objects[1].client_id='100';f.objects[1].service_scope=serviceScopeFromText('Basement walls only',null,{record:true});
 assert.equal(sale(evaluateLeadWatch(f)).state,'held');
 f.serviceScopes[key]=serviceScopeFromText('');f.objects[1].service_scope=serviceScopeFromText('',null,{record:true});
 assert.equal(sale(evaluateLeadWatch(f)).state,'would_send');assert.equal(evaluateLeadWatch(f).sources[0].service_scope.state,'not_excluded');
});
test('only complete absence of usable inquiry and work records creates an unknown-scope review',()=>{
 const f=fixture();f.objects=[];f.serviceScopes={};assert.equal(evaluateLeadWatch(f).sources[0].state,'manual_review');
 f.serviceScopes['customers/4800890529/callViews/test']=serviceScopeFromText('I need an estimate');
 assert.equal(evaluateLeadWatch(f).sources[0].state,'matched');
});
test('positive work scope survives deletion, stays market/client bound and is deduplicated across cycles',()=>{
 const f=fixture();f.serviceScopes['customers/4800890529/callViews/test']=serviceScopeFromText('Spray foam');
 f.objects[1].service_scope=serviceScopeFromText('Attic insulation and fan',null,{record:true});
 const first=evaluateLeadWatch(f);f.retainedWorkScopes=first.sources[0].work_scope_evidence;f.objects=[];
 let again=evaluateLeadWatch(f);assert.equal(again.sources[0].service_scope.state,'in_scope');
 f.retainedWorkScopes.push(...again.sources[0].work_scope_evidence);again=evaluateLeadWatch(f);assert.equal(again.sources[0].work_scope_evidence.length,1);
 f.retainedWorkScopes.forEach(x=>x.market_key='ut');assert.equal(evaluateLeadWatch(f).sources[0].state,'excluded');
});
test('Watts reviewed Oct 13 ATT refusal persists without a remote rejection ledger and across both identifier paths',()=>{
 assert.equal(WATCH_KNOWN_REFUSALS[0].event_id,'gae-slc-sold-67153691');
 const f=fixture();f.googleCalls=[];f.clients[0].market_key='ut';f.objects.forEach(o=>o.market_key='ut');
 f.objects[1].object.id='67153691';f.objects[1].object_id='67153691';
 f.leads=[{market_key:'ut',request_id:'200',client_id:'100',inquiry_at:at,gclid:'g',service:'Attic Insulation'}];
 for(let n=0;n<3;n++){const r=sale(evaluateLeadWatch(f));assert.equal(r.state,'permanently_failed');assert.equal(r.preview,null);assert.equal(r.refusal.retry,false);}
});
test('historical snapshot alone cannot create a new upload when the object no longer appears in current complete history',()=>{
 const f=fixture();f.objects[1].current_present=false;assert.equal(sale(evaluateLeadWatch(f)).state,'held');
 f.objects.push({market_key:'mo_stl',object_type:'job',object_id:'500',client_id:'100',current_present:true,
  object:{id:'500',createdAt:'2026-10-04T14:00:00Z',client:{id:'100'},quote:f.objects[1].object}});
 assert.equal(sale(evaluateLeadWatch(f)).state,'would_send');
});
test('qualified rule still requires short/missed Google call and active request plus milestone or two-way proof',()=>{
 const f=fixture();assert.equal(evaluateLeadWatch(f).results.some(x=>x.type==='qualified_lead'),false);
 f.googleCalls[0].call_duration_seconds=20;assert.equal(evaluateLeadWatch(f).results.find(x=>x.type==='qualified_lead').state,'would_send');
 f.objects[0].object.assessment=null;f.objects[0].object.quotes={nodes:[]};assert.equal(evaluateLeadWatch(f).results.find(x=>x.type==='qualified_lead').state,'held');
 f.qualifications={[f.googleCalls[0].google_resource]:{ok:true,callId:'ACtwoWay'}};assert.equal(evaluateLeadWatch(f).results.find(x=>x.type==='qualified_lead').state,'would_send');
 f.objects[0].object.requestStatus='archived';assert.equal(evaluateLeadWatch(f).results.find(x=>x.type==='qualified_lead').state,'held');
});
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0030_phone_lead_watch.sql',import.meta.url),'utf8'));sqlite.exec('CREATE TABLE google_ads_outcome_outbox(id TEXT); CREATE TABLE closed_loop_google_uploads(id TEXT)');return{sqlite,prepare(sql){let args=[];return{bind(...a){args=a;return this;},async run(){return{meta:sqlite.prepare(sql).run(...args)};},async all(){return{results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;}};}};}
test('watch runtime records locally once per 3 hours and never touches uploader ledgers or network',async()=>{
 const db=database(),env={ANGI_ROUTER_DB:db,PHONE_LEAD_WATCH_ENABLED:'true'};let reads=0;const opts={scheduledTime:Date.parse('2026-10-13T21:00:00Z'),loadSnapshot:async()=>{reads++;return fixture();},fetcher:()=>{throw Error('network forbidden');}};
 assert.equal((await phoneLeadWatchCycle(env,opts)).would_send,1);assert.equal((await phoneLeadWatchCycle(env,opts)).skipped,true);assert.equal(reads,1);
 assert.equal((await phoneLeadWatchCycle(env,{...opts,scheduledTime:opts.scheduledTime+10800000})).would_send,1);assert.equal(reads,2);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM google_ads_outcome_outbox').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM closed_loop_google_uploads').get().n,0);
});
test('all external upload/write endpoints are blocked even with validateOnly',async()=>{
 let calls=0;const wire=readOnlyTransport(async()=>{calls++;return Response.json({});});
 for(const url of ['https://googleads.googleapis.com/v24/customers/4800890529:uploadCallConversions','https://datamanager.googleapis.com/v1/events:ingest','https://api.quo.com/v1/messages'])await assert.rejects(wire(url,{method:'POST',body:'{"validateOnly":true}'}),/write_blocked/);
 await assert.rejects(wire('https://api.getjobber.com/api/graphql',{method:'POST',body:JSON.stringify({query:'mutation {clientCreate {id}}'})}),/write_blocked/);assert.equal(calls,0);
 assert.deepEqual(await phoneLeadWatchCycle({}),{disabled:true});
});
