import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolveAcknowledgementEligibility} from '../server/jobber-acknowledgement-resolver.js';
import {getJobberOAuthRoute} from '../functions/api/jobber/oauth/config.js';
import {test} from 'node:test';
import {handleJobberQuoIntakeResolve as resolve,handleJobberQuoIntakeWrite as write,handleJobberQuoIntakeStatus as status,handleJobberQuoIntakeNote as note,_private} from '../server/jobber-quo-intake.js';
const enc=(kind,id)=>btoa(`gid://Jobber/${kind}/${id}`);
const SECRET='fixture-secret';
const PHONE='+18165550105';
const NOW=Date.parse('2026-09-08T04:00:00Z');
const CLIENT=enc('Client',111),REQUEST=enc('Request',222),NOTE=enc('RequestNote',333);
const ACCOUNTS={utah:enc('Account',2498432),stl:enc('Account',2498453),kc:enc('Account',1919824)};
function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../migrations/0006_quo_intake_operations.sql',import.meta.url),'utf8'));
  db.exec(fs.readFileSync(new URL('../migrations/0005_acknowledgement_sources.sql',import.meta.url),'utf8'));
  return {raw:db,prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {success:true,results:db.prepare(sql).all(...args)};}};}};}};
}
function fixture(options={}) {
  const market=options.market||'utah',account=ACCOUNTS[market],db=database();
  const env={ANGI_ROUTER_DB:db,CONTACT_SYNC_BROKER_SECRET:SECRET,QUO_INTAKE_WRITE_ENABLED:'true',QUO_INTAKE_LIVE_SINCE:'2026-09-08T03:00:00Z'};
  const calls=[];
  const state={clients:options.clients||[],requests:options.requests||[],jobs:options.jobs||[],now:NOW};
  const connection=(nodes)=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
  const deps={now:()=>state.now,async refreshJobberAccessToken(e,route){assert.equal(route.expectedAccountId,account);assert.equal(route.sourceKey,'website');return {accessToken:'fixture-never-exposed'};},async jobberGraphql(e,token,query,vars){
    calls.push({query,vars});
    if(options.override){const result=await options.override({query,vars,state,calls,connection,account});if(result!==undefined)return result;}
    const data={account:{id:account}};
    if(query===_private.QUERIES.phones)data.clientPhones=connection(state.clients.map(c=>({id:enc('ClientPhoneNumber',1),number:PHONE,normalizedPhoneNumber:PHONE,client:{id:c.id,isArchived:!!c.isArchived},contact:c.contact||null})));
    else if(query===_private.QUERIES.requests||query===_private.QUERIES.jobs){const kind=query===_private.QUERIES.requests?'requests':'jobs';data.client={id:vars.id,isArchived:false,[kind]:connection(state[kind].map(id=>({id}))) };}
    else if(query===_private.MUTATIONS.client){state.clients.push({id:CLIENT});data.clientCreate={client:{id:CLIENT,phones:[{number:PHONE,normalizedPhoneNumber:PHONE}]},userErrors:[]};}
    else if(query===_private.MUTATIONS.request){state.requests.push(REQUEST);data.requestCreate={request:{id:REQUEST,client:{id:vars.input.clientId},jobberWebUri:'https://secure.getjobber.com/work_requests/222'},userErrors:[]};}
    else if(query===_private.MUTATIONS.note)data.requestCreateNote={requestNote:{id:NOTE},userErrors:[]};
    else if(query===_private.QUERIES.noteParent)data.request={id:vars.id,client:{id:CLIENT}};
    else assert.equal(query,_private.QUERIES.account);
    return {data};
  }};
  const identity={account_id:account,market,phone:PHONE,phone_number_id:_private.NUMBERS[market].id};
  const source={type:'call',id:'CAfixture1',event_id:'EVfixture1',occurred_at:'2026-09-08T03:59:00Z',conversation_id:'CNfixture1',from:PHONE,to:_private.NUMBERS[market].number,status:'completed',quo_url:'https://app.quo.com/inbox/CNfixture1',duration:42,summary:'Customer asked for an attic assessment.'};
  const body={...identity,operation_id:'fixture-operation',expected_client_id:null,source};
  function ctx(body,extra={}){return {env,...extra,request:new Request('https://goodattic.energy/api/jobber/quo-intake-write',{method:'POST',headers:{Authorization:`Bearer ${SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body)})};}
  const counts=()=>Object.fromEntries(Object.entries(_private.MUTATIONS).map(([k,v])=>[k,calls.filter(c=>c.query===v).length]));
  return {env,db,state,deps,calls,identity,source,body,ctx,counts};
}
async function bodyOf(fn,f,body){const r=await fn(f.ctx(body),f.deps);return {http:r.status,...await r.json()};}
for(const market of Object.keys(ACCOUNTS))test(`${market}: reuses token authority, creates exactly one phone-only client, Request and note`,async()=>{
  const f=fixture({market});
  const first=await bodyOf(resolve,f,f.identity);assert.equal(first.classification,'eligible_new_client');
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'completed');assert.equal(result.client_id,CLIENT);assert.equal(result.request_id,REQUEST);assert.equal(result.note_id,NOTE);assert.equal(result.uncertain,false);
  assert.deepEqual(f.counts(),{client:1,request:1,note:1});
  const input=f.calls.find(c=>c.query===_private.MUTATIONS.client).vars.input;
  assert.equal('firstName' in input,false);assert.equal('lastName' in input,false);assert.equal('smsAllowed' in input.phones[0],false);assert.equal(input.receivesFollowUps,false);
  const noteText=f.calls.find(c=>c.query===_private.MUTATIONS.note).vars.input.message;assert.match(noteText,/Quo call ID: CAfixture1/);assert.match(noteText,/Customer asked/);assert.match(noteText,/Operation ID: fixture-operation/);
  assert.deepEqual(await bodyOf(write,f,f.body),result);assert.deepEqual(f.counts(),{client:1,request:1,note:1});
  assert.equal((await bodyOf(status,f,{account_id:ACCOUNTS[market],operation_id:f.body.operation_id})).operation_state,'completed');
});
test('existing contact without any Requests or Jobs is eligible and reused',async()=>{
  const f=fixture({clients:[{id:CLIENT}]});const classified=await bodyOf(resolve,f,f.identity);
  assert.equal(classified.classification,'eligible_unused_client');assert.equal(classified.client_id,CLIENT);
  f.body.expected_client_id=CLIENT;const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'completed');assert.deepEqual(f.counts(),{client:0,request:1,note:1});
});
test('prior Request, old Job, archived contact and shared phone all prevent writes',async()=>{
  for(const [options,classification] of [[{clients:[{id:CLIENT}],requests:[REQUEST]},'suppressed_existing_customer'],[{clients:[{id:CLIENT}],jobs:[enc('Job',1)]},'suppressed_existing_customer'],[{clients:[{id:CLIENT,isArchived:true}]},'held_archived_client'],[{clients:[{id:CLIENT},{id:enc('Client',9),contact:{id:'contact'}}]},'held_shared_phone']]){
    const f=fixture(options);assert.equal((await bodyOf(resolve,f,f.identity)).classification,classification);
    const result=await bodyOf(write,f,f.body);assert.ok(['held','suppressed'].includes(result.operation_state));assert.deepEqual(f.counts(),{client:0,request:0,note:0});
  }
});
test('complete phone and both history paginations are required; prior history on later page suppresses',async()=>{
  const f=fixture({clients:[{id:CLIENT}],override({query,vars,connection,account}){
    if(query===_private.QUERIES.requests)return {data:{account:{id:account},client:{id:CLIENT,isArchived:false,requests:vars.after?connection([{id:REQUEST}]):{nodes:[{id:enc('Request',221)}],pageInfo:{hasNextPage:true,endCursor:'next'}}}}};
  }});
  const result=await bodyOf(resolve,f,f.identity);assert.equal(result.classification,'suppressed_existing_customer');assert.deepEqual(result.request_ids,[enc('Request',221),REQUEST]);assert.equal(result.history_complete,true);
});
test('missing page metadata, repeated cursor, wrong-account and malformed phone identity fail closed',async()=>{
  for(const override of [
    ({query,account})=>query===_private.QUERIES.phones?{data:{account:{id:account},clientPhones:{nodes:[]}}}:undefined,
    ({query,account})=>query===_private.QUERIES.phones?{data:{account:{id:account},clientPhones:{nodes:[{number:PHONE,normalizedPhoneNumber:PHONE,client:{id:CLIENT,isArchived:false}}],pageInfo:{hasNextPage:true,endCursor:'same'}}}}:undefined,
    ({query,connection})=>query===_private.QUERIES.phones?{data:{account:{id:ACCOUNTS.kc},clientPhones:connection([])}}:undefined,
    ({query,account,connection})=>query===_private.QUERIES.phones?{data:{account:{id:account},clientPhones:connection([{number:PHONE,normalizedPhoneNumber:'+18015550101',client:{id:CLIENT,isArchived:false}}])}}:undefined,
  ]){const f=fixture({override});const result=await bodyOf(resolve,f,f.identity);assert.equal(result.classification,'held_incomplete_history');assert.equal(result.history_complete,false);assert.deepEqual(f.counts(),{client:0,request:0,note:0});}
});
test('identity, authentication, unknown fields, no cutover and disabled writes never mutate',async()=>{
  const f=fixture();for(const patch of [{market:'stl'},{phone_number_id:_private.NUMBERS.kc.id},{phone:'8165550105'},{account_id:ACCOUNTS.kc},{query:'mutation injected'}])assert.equal((await bodyOf(write,f,{...f.body,...patch})).http,400);
  for(const source of [{...f.source,from:f.source.to},{...f.source,to:'+18015550101'},{...f.source,quo_url:'https://evil.example/quo'},{...f.source,media:['file:///local']}])assert.equal((await bodyOf(write,f,{...f.body,source})).http,400);
  const ctx=f.ctx(f.body);ctx.request.headers.set('Authorization','Bearer wrong');assert.equal((await write(ctx,f.deps)).status,401);
  f.env.QUO_INTAKE_WRITE_ENABLED='false';assert.equal((await bodyOf(write,f,f.body)).code,'quo_intake_writes_disabled');f.env.QUO_INTAKE_WRITE_ENABLED='true';f.env.QUO_INTAKE_LIVE_SINCE='';assert.equal((await bodyOf(write,f,f.body)).code,'quo_intake_before_cutover');
  assert.deepEqual(f.counts(),{client:0,request:0,note:0});
});
test('native inquiry appearing after client create holds partial client and does not create another Request',async()=>{
  const f=fixture({override({query,state}){if(query===_private.MUTATIONS.client)state.requests.push(REQUEST);}});
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.client_id,CLIENT);assert.equal(result.request_id,null);assert.equal(result.reason,'inquiry_or_identity_changed_before_request');assert.deepEqual(f.counts(),{client:1,request:0,note:0});
});
test('phone-only business validation rejection is terminal, contains no fabricated name fallback',async()=>{
  const f=fixture({override({query}){if(query===_private.MUTATIONS.client)return {data:{clientCreate:{client:null,userErrors:[{message:'Last name is required',path:['lastName']}]}}};}});
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.reason,'clientCreate_rejected');assert.equal(result.uncertain,false);await bodyOf(write,f,f.body);assert.deepEqual(f.counts(),{client:1,request:0,note:0});
});
for(const phase of ['client','request','note'])test(`${phase} unknown write result never replays, preserves earlier IDs, and blocks another phone operation`,async()=>{
  const f=fixture({override({query}){if(query===_private.MUTATIONS[phase])throw Error('timeout with secret raw provider payload');}});
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.uncertain,true);assert.equal(result.client_id,phase==='client'?null:CLIENT);assert.equal(result.request_id,phase==='note'?REQUEST:null);assert.doesNotMatch(JSON.stringify(result),/secret raw/);
  await bodyOf(write,f,f.body);const other=await bodyOf(write,f,{...f.body,operation_id:'another-operation',source:{...f.source,id:'CAother',event_id:'EVother'}});assert.equal(other.operation_state,'suppressed');assert.equal(other.reason,'phone_already_claimed');assert.equal(f.counts()[phase],1);
});
test('known Request ID remains recorded even when returned URL/client is invalid',async()=>{
  const f=fixture({override({query}){if(query===_private.MUTATIONS.request)return {data:{requestCreate:{request:{id:REQUEST,client:{id:enc('Client',9)},jobberWebUri:'https://secure.getjobber.com/work_requests/222'},userErrors:[]}}};}});
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.request_id,REQUEST);assert.equal(result.client_id,CLIENT);assert.equal(result.reason,'created_request_client_mismatch');assert.deepEqual(f.counts(),{client:1,request:1,note:0});
});
test('same operation with changed payload conflicts and simultaneous retries cannot duplicate',async()=>{
  const f=fixture();const results=await Promise.all([bodyOf(write,f,f.body),bodyOf(write,f,f.body)]);assert.ok(results.some(r=>r.operation_state==='completed'));assert.deepEqual(f.counts(),{client:1,request:1,note:1});
  assert.equal((await bodyOf(write,f,{...f.body,source:{...f.source,text:'changed'}})).http,409);
});
test('durable pending write marker after crash is held uncertain and never retried',async()=>{
  const f=fixture();await bodyOf(write,f,f.body);f.db.raw.prepare("UPDATE quo_intake_operations SET operation_state='request_creating',request_id=NULL,note_id=NULL,lease_token=NULL,lease_expires_at=NULL WHERE operation_id=?").run(f.body.operation_id);
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.uncertain,true);assert.equal(result.reason,'previous_jobber_write_outcome_unknown');assert.deepEqual(f.counts(),{client:1,request:1,note:1});
});
test('late call artifacts add one note to the exact parent Request; never create a client or Request',async()=>{
  const f=fixture();await bodyOf(write,f,f.body);
  const input={...f.identity,operation_id:'artifact-operation',parent_operation_id:f.body.operation_id,request_id:REQUEST,source:{...f.source,event_id:'EVtranscript',transcript:'A delayed transcript.'}};
  const result=await bodyOf(note,f,input);assert.equal(result.operation_state,'completed');assert.equal(result.request_id,REQUEST);assert.deepEqual(f.counts(),{client:1,request:1,note:2});await bodyOf(note,f,input);assert.deepEqual(f.counts(),{client:1,request:1,note:2});
  for(const patch of [{request_id:enc('Request',9)},{parent_operation_id:'missing'},{source:{...input.source,id:'CAdifferent'}},{source:{...input.source,conversation_id:'CNother'}},{source:{...input.source,type:'message'}}])assert.equal((await bodyOf(note,f,{...input,operation_id:'bad-artifact',...patch})).http,patch.source?.type==='message'?400:409);
});
test('read-only status refuses unknown account and missing operations',async()=>{
  const f=fixture();assert.equal((await bodyOf(status,f,{account_id:ACCOUNTS.utah,operation_id:'missing'})).http,404);await bodyOf(write,f,f.body);assert.equal((await bodyOf(status,f,{account_id:ACCOUNTS.stl,operation_id:f.body.operation_id})).http,409);
});

test('canonical Quo contact names are optional, require a contact ID, and preserve no-name behavior',async()=>{
  const f=fixture();const invalid={...f.body,source:{...f.source,first_name:'Test'}};assert.equal((await bodyOf(write,f,invalid)).http,400);
  const result=await bodyOf(write,f,{...f.body,source:{...f.source,contact_id:'CTfixture',first_name:'Test',last_name:'Person',quo_url:'https://my.quo.com/inbox/CNfixture1'}});assert.equal(result.operation_state,'completed');
  const input=f.calls.find(c=>c.query===_private.MUTATIONS.client).vars.input;assert.equal(input.firstName,'Test');assert.equal(input.lastName,'Person');
});
test('same canonical source in another operation is suppressed independently of phone guard',async()=>{
  const f=fixture();await bodyOf(write,f,f.body);const result=await bodyOf(write,f,{...f.body,operation_id:'same-source-other-operation'});assert.equal(result.reason,'source_already_claimed');assert.deepEqual(f.counts(),{client:1,request:1,note:1});
});
test('delayed note cannot attach to a Request reassigned to another client',async()=>{
  const f=fixture({override({query,account}){if(query===_private.QUERIES.noteParent)return {data:{account:{id:account},request:{id:REQUEST,client:{id:enc('Client',999)}}}};}});await bodyOf(write,f,f.body);
  const result=await bodyOf(note,f,{...f.identity,operation_id:'reassigned-note',parent_operation_id:f.body.operation_id,request_id:REQUEST,source:{...f.source,event_id:'EVlater'}});assert.equal(result.operation_state,'held');assert.equal(result.reason,'intake_note_request_identity_changed');assert.deepEqual(f.counts(),{client:1,request:1,note:1});
});

test('actual durable broker Request proof suppresses acknowledgement even when the app displays Website Leads',async()=>{
  for(const market of Object.keys(ACCOUNTS)) {
    const f=fixture({market});const written=await bodyOf(write,f,f.body);assert.equal(written.operation_state,'completed');
    const record={id:REQUEST,createdAt:new Date(NOW).toISOString(),source:'Good Attic Website Leads',phone:PHONE,client:{id:CLIENT,firstName:'',phones:[{number:PHONE,normalizedPhoneNumber:PHONE,primary:true,smsAllowed:false}]}};
    const route=getJobberOAuthRoute({utah:'ut',stl:'mo_stl',kc:'mo_kc'}[market]);
    const result=await resolveAcknowledgementEligibility(f.env,route,record,NOW+5000);assert.equal(result.eligibility,'suppressed');assert.equal(result.reason,'verified_quo_phone_intake');assert.equal(result.retryable,false);
  }
});
