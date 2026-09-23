import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { deriveEvents, numericId, accountMarket, clickIdentifier, validationRequest, validateGoogleOnly } from '../server/stage1-model.js';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){if(url.endsWith('.sql'))return {format:'module',source:'export default '+JSON.stringify(readFileSync(new URL(url),'utf8')),shortCircuit:true};return next(url,context);}});
const {default:worker,persistEvent,processObject}=await import('../workers/stage1-shadow.js');
const id=(t,n)=>btoa(`gid://Jobber/${t}/${n}`);
const lead={lead_id:'test',inquiry_at:'2026-08-01T00:00:00Z',gclid:'g',gbraid:'b',wbraid:'w'};
const quote={id:id('Quote',42),createdAt:'2026-08-02T00:00:00Z',request:{id:id('Request',7)},quoteStatus:'approved',lastTransitioned:{approvedAt:'2026-08-03T00:00:00Z'},amounts:{total:123.45}};
function db(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0009_google_ads_outcome_outbox.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/0010_stage1_shadow.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/0011_stage1_outbox.sql',import.meta.url),'utf8'));return {sqlite,prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}}}};}
test('raw and encoded Jobber IDs, all markets',()=>{assert.equal(numericId('42'),'42');assert.equal(numericId(id('Quote',42)),'42');assert.equal(accountMarket('1919824'),'mo_kc');assert.equal(accountMarket(id('Account',2498432)),'ut');});
test('one identifier, explicit UTC, approval time and approved value',()=>{const [e]=deriveEvents('mo_kc','quote',quote,lead);assert.equal(e.id,'gae-kc-sold-42');assert.deepEqual(clickIdentifier(lead),{gclid:'g'});assert.equal(e.payload.conversionDateTime,'2026-08-03 00:00:00+00:00');assert.equal(e.payload.conversionValue,123.45);assert.equal(e.payload.gbraid,undefined);assert.deepEqual(clickIdentifier({gbraid:'b',wbraid:'w'}),{gbraid:'b'});assert.deepEqual(clickIdentifier({wbraid:'w'}),{wbraid:'w'});});
test('historical booking time unknown, completion known',()=>{const e=deriveEvents('ut','request',{id:id('Request',7),assessment:{startAt:'2026-08-02T00:00:00Z',endAt:'2026-08-02T01:00:00Z',isComplete:true,completedAt:'2026-08-02T02:00:00Z'}},lead);assert.equal(e.length,2);assert.equal(e[0].payload,null);assert.deepEqual(e[0].reasons,['appointment_booking_time_unavailable']);assert.equal(e[1].payload.conversionValue,0);});
test('missing approval, request, click or conflict always held',()=>{for(const [q,l,reason] of [[{...quote,lastTransitioned:{}},lead,'quote_approval_time_unavailable'],[{...quote,request:null},null,'missing_request_link'],[quote,{...lead,gclid:null,gbraid:null,wbraid:null},'missing_click_id'],[quote,{...lead,conflict:1},'conflicting_lead_attribution']]){const [e]=deriveEvents('ut','quote',q,l);assert.equal(e.payload,null);assert.ok(e.reasons.includes(reason));}});
test('quote and job observation share deterministic ID; repeated writes stay one shadow; accepted immutable',async()=>{const d=db();const [e]=deriveEvents('mo_stl','quote',quote,lead);await persistEvent(d,e);await persistEvent(d,e);const [j]=deriveEvents('mo_stl','job',{id:id('Job',5),quote},lead);assert.equal(e.id,j.id);await persistEvent(d,j);assert.equal(d.sqlite.prepare('SELECT count(*) n FROM google_ads_outcome_outbox').get().n,1);assert.equal(d.sqlite.prepare('SELECT upload_state FROM google_ads_outcome_outbox').get().upload_state,'shadow');d.sqlite.exec("UPDATE google_ads_outcome_outbox SET upload_state='accepted'");await persistEvent(d,{...e,valueMicros:999});assert.equal(d.sqlite.prepare('SELECT value_micros FROM google_ads_outcome_outbox').get().value_micros,123450000);});
test('KC outbox allowed, no quote cannot invent approved amount',async()=>{const d=db();const [e]=deriveEvents('mo_kc','job',{id:id('Job',99),createdAt:'2026-09-01T00:00:00Z'},null);assert.equal(e.id,'gae-kc-sold-job-99');assert.ok(e.reasons.includes('missing_approved_quote'));await persistEvent(d,e);});
test('validation is always validateOnly with partialFailure and missing credentials do not call Google',async()=>{const rows=[{event_id:'x',gclid:'g',gbraid:'b',conversion_date_time:'2026-08-01T12:00:00Z',conversion_value:1}];const body=validationRequest(rows);assert.equal(body.validateOnly,true);assert.equal(body.partialFailure,true);assert.equal(body.conversions[0].gbraid,undefined);const missing=await validateGoogleOnly(rows,{},()=>{throw Error('must not fetch')});assert.equal(missing.attempted,false);const calls=[];await validateGoogleOnly(rows,Object.fromEntries(['DEVELOPER_TOKEN','OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REFRESH_TOKEN'].map(k=>['GOOGLE_ADS_'+k,'test'])),async(url,opt)=>{calls.push({url,opt});return Response.json(url.includes('oauth2')?{access_token:'test'}:{});});assert.equal(JSON.parse(calls[1].opt.body).validateOnly,true);});
test('worker rejects tick when upload flag is enabled',async()=>{const r=await worker.fetch(new Request('https://test/tick',{method:'POST',headers:{Authorization:'Bearer test'}}),{STAGE1_ADMIN_SECRET:'test',GOOGLE_ADS_UPLOAD_ENABLED:'true'});assert.equal(r.status,500);assert.equal((await r.json()).error,'stage1_requires_google_upload_disabled');});

test('signed webhook is durable and idempotent; wrong signatures rejected',async()=>{
 const d=db(); const env={ANGI_ROUTER_DB:d,JOBBER_CLIENT_SECRET:'signing-test'};
 const raw=JSON.stringify({data:{webHookEvent:{accountId:id('Account',1919824),topic:'QUOTE_APPROVED',itemId:id('Quote',42),occuredAt:'2026-09-23T12:00:00Z'}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.JOBBER_CLIENT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('base64');
 const request=sig=>new Request('https://test/webhooks/jobber',{method:'POST',headers:{'X-Jobber-Hmac-SHA256':sig},body:raw});
 assert.equal((await worker.fetch(request('bad'),env)).status,401);
 assert.equal((await worker.fetch(request(signature),env)).status,202);
 assert.equal((await worker.fetch(request(signature),env)).status,202);
 assert.equal(d.sqlite.prepare('SELECT count(*) n FROM closed_loop_stage1_webhooks').get().n,1);
 assert.equal(d.sqlite.prepare('SELECT market_key FROM closed_loop_stage1_webhooks').get().market_key,'mo_kc');
});
test('unindexed Google validation errors cannot be reported as successful rows',async()=>{
 const rows=[{event_id:'x',gclid:'g',conversion_date_time:'2026-08-01T12:00:00Z',conversion_value:1}];
 const env=Object.fromEntries(['DEVELOPER_TOKEN','OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REFRESH_TOKEN'].map(k=>['GOOGLE_ADS_'+k,'test']));
 const result=await validateGoogleOnly(rows,env,async url=>Response.json(url.includes('oauth2')?{access_token:'test'}:{partialFailureError:{code:3,message:'unindexed error',details:[]}}));
 assert.equal(result.rows[0].result,'UNINDEXED_VALIDATION_ERROR');
});
test('delayed request-create webhook cannot invent appointment booking time',async()=>{
 const d=db(),rid=id('Request',7),env={ANGI_ROUTER_DB:d};
 d.sqlite.prepare('INSERT INTO closed_loop_stage1_leads(market_key,request_id,lead_id,inquiry_at,gclid,source,updated_at) VALUES(?,?,?,?,?,?,?)').run('ut',rid,'lead','2026-08-01T00:00:00Z','g','test','2026-08-01T00:00:00Z');
 const request={id:rid,createdAt:'2026-08-01T00:00:00Z',updatedAt:'2026-08-02T00:00:00Z',assessment:{startAt:'2026-08-03T00:00:00Z',endAt:'2026-08-03T01:00:00Z'}};
 await processObject(env,'ut','request',request,{topic:'REQUEST_CREATE',occurred_at:request.createdAt});
 assert.equal(d.sqlite.prepare('SELECT payload_json FROM closed_loop_stage1_events').get().payload_json,null);
 const d2=db();d2.sqlite.prepare('INSERT INTO closed_loop_stage1_leads(market_key,request_id,lead_id,inquiry_at,gclid,source,updated_at) VALUES(?,?,?,?,?,?,?)').run('ut',rid,'lead','2026-08-01T00:00:00Z','g','test','2026-08-01T00:00:00Z');
 await processObject({ANGI_ROUTER_DB:d2},'ut','request',{...request,assessment:null});
 await processObject({ANGI_ROUTER_DB:d2},'ut','request',request,{topic:'REQUEST_UPDATE',occurred_at:request.updatedAt});
 assert.equal(JSON.parse(d2.sqlite.prepare('SELECT payload_json FROM closed_loop_stage1_events').get().payload_json).conversionDateTime,'2026-08-02 00:00:00+00:00');
});
