import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolveAcknowledgementEligibility} from '../server/jobber-acknowledgement-resolver.js';
import {getJobberOAuthRoute} from '../functions/api/jobber/oauth/config.js';
import {test} from 'node:test';
import {handleJobberQuoIntakeResolve as resolve,handleJobberQuoIntakeWrite as write,handleJobberQuoIntakeStatus as status,handleJobberQuoIntakeNote as note,handleJobberQuoIntakeResume as resume,_private} from '../server/jobber-quo-intake.js';
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
  db.exec(fs.readFileSync(new URL('../migrations/0007_quo_call_attributions.sql',import.meta.url),'utf8'));
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
    else if(query===_private.QUERIES.client){const c=state.clients.find(x=>x.id===vars.id);data.client=c?{id:c.id,isArchived:!!c.isArchived,phones:[{number:PHONE,normalizedPhoneNumber:PHONE}]}:null;}
    else if(query===_private.QUERIES.requests||query===_private.QUERIES.jobs){const kind=query===_private.QUERIES.requests?'requests':'jobs';data.client={id:vars.id,isArchived:false,[kind]:connection(state[kind].map(id=>({id}))) };}
    else if(query===_private.MUTATIONS.client){state.clients.push({id:CLIENT});data.clientCreate={client:{id:CLIENT,phones:[{number:PHONE,normalizedPhoneNumber:PHONE}]},userErrors:[]};}
    else if(query===_private.MUTATIONS.request){state.requests.push(REQUEST);data.requestCreate={request:{id:REQUEST,client:{id:vars.input.clientId},jobberWebUri:'https://secure.getjobber.com/work_requests/222'},userErrors:[]};}
    else if(query===_private.MUTATIONS.note)data.requestCreateNote={requestNote:{id:NOTE},userErrors:[]};
    else if(query===_private.QUERIES.noteParent)data.request={id:vars.id,client:{id:CLIENT}};
    else if(query===_private.QUERIES.messageNoteParent)data.request={id:vars.id,createdAt:new Date(NOW).toISOString(),requestStatus:'new',assessment:null,client:{id:CLIENT,isArchived:false}};
    else assert.equal(query,_private.QUERIES.account);
    return {data};
  }};
  const identity={account_id:account,market,phone:PHONE,phone_number_id:_private.NUMBERS[market].id};
  const source={type:'call',id:'CAfixture1',event_id:'EVfixture1',occurred_at:'2026-09-08T03:59:00Z',conversation_id:'CNfixture1',from:PHONE,to:_private.NUMBERS[market].number,status:'completed',direction:'incoming',quo_url:'https://app.quo.com/inbox/CNfixture1',duration:42,summary:'Customer asked for an attic assessment.'};
  const body={...identity,operation_id:'fixture-operation',expected_client_id:null,source};
  function ctx(body,extra={}){return {env,...extra,request:new Request('https://goodattic.energy/api/jobber/quo-intake-write',{method:'POST',headers:{Authorization:`Bearer ${SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body)})};}
  const counts=()=>Object.fromEntries(Object.entries(_private.MUTATIONS).map(([k,v])=>[k,calls.filter(c=>c.query===v).length]));
  return {env,db,state,deps,calls,identity,source,body,ctx,counts};
}
async function bodyOf(fn,f,body){const r=await fn(f.ctx(body),f.deps);return {http:r.status,...await r.json()};}
for(const market of Object.keys(ACCOUNTS))test(`${market}: reuses token authority, creates one client with an explicit placeholder, Request and note`,async()=>{
  const f=fixture({market});
  const first=await bodyOf(resolve,f,f.identity);assert.equal(first.classification,'eligible_new_client');
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'completed');assert.equal(result.client_id,CLIENT);assert.equal(result.request_id,REQUEST);assert.equal(result.note_id,NOTE);assert.equal(result.uncertain,false);
  assert.deepEqual(f.counts(),{client:1,request:1,note:1});
  const attribution=f.db.raw.prepare('SELECT * FROM quo_call_attributions').all();
  assert.equal(attribution.length,market==='kc'?0:1);
  if(market!=='kc') {
    assert.equal(attribution[0].quo_call_id,'CAfixture1');
    assert.equal(attribution[0].call_started_at_original,f.source.occurred_at);
    assert.equal(attribution[0].call_started_at_utc,'2026-09-08T03:59:00.000Z');
    assert.equal(attribution[0].jobber_request_id,REQUEST);
    assert.equal(attribution[0].jobber_client_id,CLIENT);
    assert.equal(attribution[0].attribution_status,'pending');
    assert.equal(attribution[0].google_upload_status,'not_submitted');
    assert.equal(attribution[0].consent_status,'unknown');
  }
  const input=f.calls.find(c=>c.query===_private.MUTATIONS.client).vars.input;
  assert.equal(input.firstName,PHONE);assert.equal('lastName' in input,false);assert.equal('smsAllowed' in input.phones[0],false);assert.equal(input.receivesFollowUps,false);
  const noteText=f.calls.find(c=>c.query===_private.MUTATIONS.note).vars.input.message;assert.match(noteText,/Quo call ID: CAfixture1/);assert.match(noteText,/Customer asked/);assert.match(noteText,/Name not yet collected; the temporary intake name is not a confirmed customer name/);assert.match(noteText,/Operation ID: fixture-operation/);
  assert.deepEqual(await bodyOf(write,f,f.body),result);assert.deepEqual(f.counts(),{client:1,request:1,note:1});
  assert.equal((await bodyOf(status,f,{account_id:ACCOUNTS[market],operation_id:f.body.operation_id})).operation_state,'completed');
});
test('distinct Quo call IDs remain separate ledger records and retries only update links',async()=>{
  const f=fixture({market:'utah'}), row={operation_kind:'intake',account_id:f.identity.account_id,market:'utah',phone:f.identity.phone,phone_number_id:f.identity.phone_number_id,request_id:REQUEST,client_id:CLIENT};
  await _private.upsertCallAttribution(f.db,row,{...f.source,id:'CAone'},NOW);
  await _private.upsertCallAttribution(f.db,row,{...f.source,id:'CAtwo'},NOW);
  await _private.upsertCallAttribution(f.db,{...row,request_id:enc('Request',223)},{...f.source,id:'CAone'},NOW);
  const rows=f.db.raw.prepare('SELECT quo_call_id,jobber_request_id FROM quo_call_attributions ORDER BY quo_call_id').all().map(row=>({...row}));
  assert.deepEqual(rows,[{quo_call_id:'CAone',jobber_request_id:enc('Request',223)},{quo_call_id:'CAtwo',jobber_request_id:REQUEST}]);
});
test('call source keeps the original offset timestamp alongside UTC',()=>{
  const f=fixture(), original='2026-09-07T21:59:00-06:00';
  const cleaned=_private.cleanSource({...f.source,occurred_at:original,occurred_at_original:original},f.identity,NOW);
  assert.equal(cleaned.occurred_at_original,original);
  assert.equal(cleaned.occurred_at,'2026-09-08T03:59:00.000Z');
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
test('business validation rejection remains terminal without a second client-create fallback',async()=>{
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
  for(const patch of [{request_id:enc('Request',9)},{parent_operation_id:'missing'},{source:{...input.source,id:'CAdifferent'}},{source:{...input.source,conversation_id:'CNother'}},{source:{...input.source,type:'message'}}])assert.equal((await bodyOf(note,f,{...input,operation_id:'bad-artifact',...patch})).http,409);
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

test('known-client resume preserves original new-client provenance and the explicit placeholder note',async()=>{
 let failOnce=true;
 const f=fixture({override({query,state}){if(query===_private.QUERIES.phones&&state.clients.length&&failOnce){failOnce=false;throw Error('temporary read failure after known successful create');}}});
 const first=await bodyOf(write,f,f.body);assert.equal(first.http,503);
 const checkpoint=f.db.raw.prepare('SELECT operation_state,classification,client_id FROM quo_intake_operations WHERE operation_id=?').get(f.body.operation_id);
 assert.equal(checkpoint.operation_state,'client_created');assert.equal(checkpoint.classification,'eligible_new_client');assert.equal(checkpoint.client_id,CLIENT);
 const resumed=await bodyOf(write,f,f.body);assert.equal(resumed.operation_state,'completed');assert.equal(resumed.classification,'eligible_new_client');
 assert.deepEqual(f.counts(),{client:1,request:1,note:1});assert.match(f.calls.find(c=>c.query===_private.MUTATIONS.note).vars.input.message,/temporary intake name is not a confirmed customer name/);
});
test('canonical Quo names bypass the placeholder; existing unused clients are never renamed',async()=>{
 const named=fixture();const value=await bodyOf(write,named,{...named.body,source:{...named.source,contact_id:'CTknown',first_name:'Susan',last_name:'Customer'}});assert.equal(value.operation_state,'completed');
 assert.equal(named.calls.find(c=>c.query===_private.MUTATIONS.client).vars.input.firstName,'Susan');assert.doesNotMatch(named.calls.find(c=>c.query===_private.MUTATIONS.note).vars.input.message,/temporary intake name/);
 const unused=fixture({clients:[{id:CLIENT}]});unused.body.expected_client_id=CLIENT;const reused=await bodyOf(write,unused,unused.body);assert.equal(reused.operation_state,'completed');assert.equal(reused.classification,'eligible_unused_client');assert.equal(unused.counts().client,0);assert.doesNotMatch(unused.calls.find(c=>c.query===_private.MUTATIONS.note).vars.input.message,/temporary intake name/);
});

test('a later external inquiry does not erase placeholder creation provenance on a resumed known client',async()=>{
 let failOnce=true;
 const f=fixture({override({query,state}){if(query===_private.QUERIES.phones&&state.clients.length&&failOnce){failOnce=false;throw Error('temporary read failure');}}});
 await bodyOf(write,f,f.body);f.state.requests.push(REQUEST);
 const resumed=await bodyOf(write,f,f.body);assert.equal(resumed.operation_state,'suppressed');assert.equal(resumed.classification,'eligible_new_client');assert.equal(resumed.reason,'prior_request_or_job');assert.equal(resumed.client_id,CLIENT);assert.deepEqual(f.counts(),{client:1,request:0,note:0});
});

test('new client missing from both phone indexes uses its confirmed ID and complete fresh history once',async()=>{
 const f=fixture({override({query,state,account,connection}){if(query===_private.QUERIES.phones&&state.clients.length)return {data:{account:{id:account},clientPhones:connection([])}};}});
 const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'completed');assert.deepEqual(f.counts(),{client:1,request:1,note:1});
 const created=f.calls.findIndex(c=>c.query===_private.MUTATIONS.client),after=f.calls.slice(created+1);
 assert.deepEqual(after.filter(c=>c.query===_private.QUERIES.phones).map(c=>c.vars.searchTerm),[PHONE,PHONE.slice(2)]);
 assert.ok(after.some(c=>c.query===_private.QUERIES.client&&c.vars.id===CLIENT));assert.ok(after.some(c=>c.query===_private.QUERIES.requests));assert.ok(after.some(c=>c.query===_private.QUERIES.jobs));
 await bodyOf(write,f,f.body);assert.deepEqual(f.counts(),{client:1,request:1,note:1});
});

test('known-ID index fallback never overrides another matching client, archived client, changed phone or account',async()=>{
 for(const scenario of ['shared','archived','changed_phone','wrong_account','missing']){
  const f=fixture({override({query,state,account,connection}){
   if(!state.clients.length)return;
   if(query===_private.QUERIES.phones)return {data:{account:{id:account},clientPhones:connection(scenario==='shared'?[{number:PHONE,normalizedPhoneNumber:PHONE,client:{id:enc('Client',444),isArchived:false}}]:[])}};
   if(query===_private.QUERIES.client)return {data:{account:{id:scenario==='wrong_account'?ACCOUNTS.kc:account},client:scenario==='missing'?null:{id:CLIENT,isArchived:scenario==='archived',phones:[{number:scenario==='changed_phone'?'+18165550199':PHONE,normalizedPhoneNumber:scenario==='changed_phone'?'+18165550199':PHONE}]}}};
  }});
  const result=await bodyOf(write,f,f.body);assert.ok(result.operation_state==='held'||result.http===503,scenario);assert.deepEqual(f.counts(),{client:1,request:0,note:0},scenario);
 }
});

test('fresh canonical phone read catches an edit during the Request/Job history scan',async()=>{
 const f=fixture({override({query,account,state}){
  if(query===_private.QUERIES.jobs)state.phoneChanged=true;
  if(query===_private.QUERIES.client&&state.phoneChanged)return {data:{account:{id:account},client:{id:CLIENT,isArchived:false,phones:[{number:'+18165550199',normalizedPhoneNumber:'+18165550199'}]}}};
 }});
 const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.reason,'known_client_phone_changed');assert.deepEqual(f.counts(),{client:1,request:0,note:0});
});

async function legacyHeldPartial(options={}) {
 let failOnce=true;
 const f=fixture({...options,override(args){
  if(args.query===_private.QUERIES.phones&&args.state.clients.length&&failOnce){failOnce=false;throw Error('seed a confirmed client-created checkpoint');}
  return options.override?.(args);
 }});
 const first=await bodyOf(write,f,f.body);assert.equal(first.http,503);assert.deepEqual(f.counts(),{client:1,request:0,note:0});
 // Reproduce the old version's terminal post-create hold without fabricating or
 // erasing a Request write. Original source/hash/guards come from real handling.
 f.db.raw.prepare("UPDATE quo_intake_operations SET operation_state='held',reason='inquiry_or_identity_changed_before_request' WHERE operation_id=? AND operation_state='client_created' AND client_id=? AND request_id IS NULL").run(f.body.operation_id,CLIENT);
 f.recovery={...f.identity,operation_id:f.body.operation_id,expected_client_id:CLIENT};return f;
}

test('operator recovery uses the original held client/source/guards and creates one Request despite concurrent repeats',async()=>{
 const f=await legacyHeldPartial();
 const before=f.db.raw.prepare('SELECT source_json,intent_sha256,client_id FROM quo_intake_operations').get();
 const results=await Promise.all([bodyOf(resume,f,f.recovery),bodyOf(resume,f,f.recovery)]);assert.ok(results.some(r=>r.operation_state==='completed'));
 const again=await bodyOf(resume,f,f.recovery);assert.equal(again.operation_state,'completed');assert.equal(again.client_id,CLIENT);assert.equal(again.request_id,REQUEST);assert.deepEqual(f.counts(),{client:1,request:1,note:1});
 assert.deepEqual(f.db.raw.prepare('SELECT source_json,intent_sha256,client_id FROM quo_intake_operations').get(),before);
 assert.equal(f.db.raw.prepare('SELECT operation_id FROM quo_intake_phone_guards').get().operation_id,f.body.operation_id);
 assert.equal(f.db.raw.prepare('SELECT operation_id FROM quo_intake_source_guards').get().operation_id,f.body.operation_id);
});

test('operator recovery rejects wrong identity, overrides, uncertain phases, altered intent and missing guards',async()=>{
 for(const scenario of ['identity','client','source_override','auth','uncertain','request_id','note_id','reason','hash','source_guard','phone_guard','expired','disabled']){
  const f=await legacyHeldPartial();let input={...f.recovery};
  if(scenario==='identity')input.phone='+18165550199';if(scenario==='client')input.expected_client_id=enc('Client',444);if(scenario==='source_override')input.source=f.source;
  if(scenario==='uncertain')f.db.raw.exec('UPDATE quo_intake_operations SET uncertain=1');
  if(scenario==='request_id')f.db.raw.prepare('UPDATE quo_intake_operations SET request_id=?').run(REQUEST);
  if(scenario==='note_id')f.db.raw.prepare('UPDATE quo_intake_operations SET note_id=?').run(NOTE);
  if(scenario==='reason')f.db.raw.exec("UPDATE quo_intake_operations SET reason='jobber_request_outcome_unknown'");
  if(scenario==='hash')f.db.raw.exec("UPDATE quo_intake_operations SET intent_sha256='changed'");
  if(scenario==='source_guard')f.db.raw.exec('DELETE FROM quo_intake_source_guards');if(scenario==='phone_guard')f.db.raw.exec('DELETE FROM quo_intake_phone_guards');
  if(scenario==='expired')f.state.now+=25*60*60*1000;if(scenario==='disabled')f.env.QUO_INTAKE_WRITE_ENABLED='false';
  const context=f.ctx(input);if(scenario==='auth')context.request.headers.set('authorization','Bearer wrong');
  const response=await resume(context,f.deps);assert.ok([400,401,409,503].includes(response.status),scenario);assert.deepEqual(f.counts(),{client:1,request:0,note:0},scenario);
 }
});

test('recovery rechecks current histories, shared phones and current client phone before any Request',async()=>{
 for(const scenario of ['request','job','shared','phone_changed']){
  const f=await legacyHeldPartial({override({query,state,account}){if(scenario==='phone_changed'&&state.seedComplete&&query===_private.QUERIES.client)return {data:{account:{id:account},client:{id:CLIENT,isArchived:false,phones:[{number:'+18165550199',normalizedPhoneNumber:'+18165550199'}]}}};}});
  f.state.seedComplete=true;if(scenario==='request')f.state.requests.push(REQUEST);if(scenario==='job')f.state.jobs.push(enc('Job',444));if(scenario==='shared')f.state.clients.push({id:enc('Client',444)});
  const result=await bodyOf(resume,f,f.recovery);assert.ok(['held','suppressed'].includes(result.operation_state),scenario);assert.deepEqual(f.counts(),{client:1,request:0,note:0},scenario);
 }
});

test('uncertain recovery Request write retains the guard and cannot be resumed a second time',async()=>{
 const f=await legacyHeldPartial({override({query}){if(query===_private.MUTATIONS.request)throw Error('request response lost');}});
 const result=await bodyOf(resume,f,f.recovery);assert.equal(result.operation_state,'held');assert.equal(result.uncertain,true);assert.equal(result.request_id,null);
 assert.equal((await bodyOf(resume,f,f.recovery)).code,'intake_recovery_not_safe');assert.deepEqual(f.counts(),{client:1,request:1,note:0});
});

test('source photos are real attachments on the same durable note and uncertain uploads do not duplicate',async()=>{
 for(const uncertain of [false,true]){
  const f=fixture({override({query}){if(uncertain&&query===_private.MUTATIONS.note)throw Error('note result unknown');}});
  const url='https://share.quo.com/fixture/attic-photo.jpg';f.body.source={...f.source,media:[url,url]};
  const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,uncertain?'held':'completed');assert.equal(result.uncertain,uncertain);
  const sent=f.calls.find(c=>c.query===_private.MUTATIONS.note);assert.deepEqual(sent.vars.input.attachments,[{url}]);assert.match(sent.vars.input.message,/Media:/);assert.equal(sent.vars.requestId,REQUEST);
  await bodyOf(write,f,f.body);assert.deepEqual(f.counts(),{client:1,request:1,note:1});
 }
});

test('long transcript remains intact in the note; oversized text is rejected explicitly',async()=>{
 const f=fixture(),transcript='x'.repeat(48000);f.body.source={...f.source,transcript};const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'completed');assert.ok(f.calls.find(c=>c.query===_private.MUTATIONS.note).vars.input.message.includes(transcript));
 const tooLong=fixture();assert.equal((await bodyOf(write,tooLong,{...tooLong.body,source:{...tooLong.source,transcript:transcript+'x'}})).http,400);assert.deepEqual(tooLong.counts(),{client:0,request:0,note:0});
});

function messageNote(f,overrides={}) {
 return {...f.identity,operation_id:'message-note',parent_operation_id:f.body.operation_id,request_id:REQUEST,
  source:{type:'message',id:'ACmessage-followup',event_id:'EVmessage-followup',occurred_at:new Date(NOW).toISOString(),conversation_id:f.source.conversation_id,from:PHONE,to:_private.NUMBERS[f.identity.market].number,status:'received',text:'Here are the attic photos.',media:['https://share.quo.com/fixture/followup-photo.jpg'],...overrides}};
}
test('fresh message and photo append once to the same original call or text Request with source and phone guards intact',async()=>{
 for(const type of ['call','message']){
  const f=fixture();if(type==='message')f.body.source={...f.source,type:'message',status:'received',text:'Initial inquiry'};
  await bodyOf(write,f,f.body);const input=messageNote(f),result=await bodyOf(note,f,input);
  assert.equal(result.operation_state,'completed');assert.equal(result.request_id,REQUEST);assert.equal(result.client_id,CLIENT);assert.deepEqual(f.counts(),{client:1,request:1,note:2});
  const saved=f.calls.filter(c=>c.query===_private.MUTATIONS.note).at(-1);assert.match(saved.vars.input.message,/Good Attic Quo text update/);assert.deepEqual(saved.vars.input.attachments,[{url:input.source.media[0]}]);
  assert.equal(f.db.raw.prepare('SELECT operation_id FROM quo_intake_source_guards WHERE source_id=?').get(input.source.id).operation_id,input.operation_id);
  assert.equal(f.db.raw.prepare('SELECT operation_id FROM quo_intake_phone_guards').get().operation_id,f.body.operation_id);
  await bodyOf(note,f,input);const duplicate=await bodyOf(note,f,{...input,operation_id:'different-note-event',source:{...input.source,event_id:'EVdifferent-delivery'}});assert.equal(duplicate.operation_state,'suppressed');assert.equal(duplicate.reason,'source_already_claimed');assert.deepEqual(f.counts(),{client:1,request:1,note:2});
 }
});
test('a message already used for the original intake cannot become a second note',async()=>{
 const f=fixture();f.body.source={...f.source,type:'message',status:'received',text:'Original inquiry'};await bodyOf(write,f,f.body);
 const result=await bodyOf(note,f,{...messageNote(f),source:{...f.body.source,event_id:'EVretry-original'}});assert.equal(result.operation_state,'suppressed');assert.equal(result.reason,'source_already_claimed');assert.deepEqual(f.counts(),{client:1,request:1,note:1});
});
test('a photo-only incoming message already read by staff still attaches to the fresh Request',async()=>{
 const f=fixture();await bodyOf(write,f,f.body);const input=messageNote(f,{text:'',status:'read'});
 const result=await bodyOf(note,f,input);assert.equal(result.operation_state,'completed');assert.equal(result.request_id,REQUEST);
 assert.deepEqual(f.calls.filter(c=>c.query===_private.MUTATIONS.note).at(-1).vars.input.attachments,[{url:input.source.media[0]}]);assert.deepEqual(f.counts(),{client:1,request:1,note:2});
});
test('message-note source guards serialize concurrent alternate operation IDs without duplicating an MMS',async()=>{
 const f=fixture();await bodyOf(write,f,f.body);const input=messageNote(f);
 const results=await Promise.all([bodyOf(note,f,input),bodyOf(note,f,{...input,operation_id:'message-racing-note',source:{...input.source,event_id:'EVanother'}})]);
 assert.equal(results.filter(r=>r.operation_state==='completed').length,1);assert.equal(results.filter(r=>r.operation_state==='suppressed').length,1);assert.deepEqual(f.counts(),{client:1,request:1,note:2});
});
test('message notes require the exact parent identity and a fixed 24-hour window from the original intake',async()=>{
 for(const scenario of ['before','after','processing_after','conversation','market','request','phone','outbound','no_content','parent_note']){
  const f=fixture();await bodyOf(write,f,f.body);let input=messageNote(f),time=Date.parse(f.source.occurred_at);
  if(scenario==='before')input.source.occurred_at=new Date(time-1).toISOString();
  if(scenario==='after'){f.state.now=time+_private.MESSAGE_NOTE_WINDOW_MS+1;input.source.occurred_at=new Date(f.state.now).toISOString();}
  if(scenario==='processing_after')f.state.now=time+_private.MESSAGE_NOTE_WINDOW_MS+1;
  if(scenario==='conversation')input.source.conversation_id='CNother';if(scenario==='market')input={...input,account_id:ACCOUNTS.kc,market:'kc',phone_number_id:_private.NUMBERS.kc.id,source:{...input.source,to:_private.NUMBERS.kc.number}};
  if(scenario==='request')input.request_id=enc('Request',999);if(scenario==='phone')input.source.from='+18165550199';if(scenario==='outbound')input.source.status='sent';
  if(scenario==='no_content'){input.source.text=' ';input.source.media=[];}if(scenario==='parent_note')f.db.raw.exec("UPDATE quo_intake_operations SET operation_kind='note'");
  const result=await bodyOf(note,f,input);assert.ok([400,409].includes(result.http),scenario);assert.deepEqual(f.counts(),{client:1,request:1,note:1},scenario);
 }
 const boundary=fixture();await bodyOf(write,boundary,boundary.body);boundary.state.now=Date.parse(boundary.source.occurred_at)+_private.MESSAGE_NOTE_WINDOW_MS;
 assert.equal((await bodyOf(note,boundary,messageNote(boundary,{occurred_at:new Date(boundary.state.now).toISOString()}))).operation_state,'completed');
});
test('message notes require complete fresh history containing only the owned Request and no Jobs, plus unchanged active client phone',async()=>{
 for(const scenario of ['extra_request','job','shared','archived','phone','history_missing','history_later_page','wrong_account']){
  const f=fixture({override({query,state,vars,account,connection}){
   if(!state.followup)return;
   if(scenario==='phone'&&query===_private.QUERIES.client)return {data:{account:{id:account},client:{id:CLIENT,isArchived:false,phones:[{number:'+18165550199',normalizedPhoneNumber:'+18165550199'}]}}};
   if(scenario==='history_missing'&&query===_private.QUERIES.jobs)return {data:{account:{id:account},client:{id:CLIENT,isArchived:false}}};
   if(scenario==='history_later_page'&&query===_private.QUERIES.requests)return {data:{account:{id:account},client:{id:CLIENT,isArchived:false,requests:vars.after?connection([{id:enc('Request',999)}]):{nodes:[{id:REQUEST}],pageInfo:{hasNextPage:true,endCursor:'later'}}}}};
   if(query===_private.QUERIES.messageNoteParent&&(scenario==='archived'||scenario==='wrong_account'))return {data:{account:{id:scenario==='wrong_account'?ACCOUNTS.kc:account},request:{id:REQUEST,createdAt:new Date(NOW).toISOString(),requestStatus:'new',assessment:null,client:{id:CLIENT,isArchived:scenario==='archived'}}}};
  }});await bodyOf(write,f,f.body);f.state.followup=true;
  if(scenario==='extra_request')f.state.requests.push(enc('Request',999));if(scenario==='job')f.state.jobs.push(enc('Job',999));if(scenario==='shared')f.state.clients.push({id:enc('Client',999)});
  const result=await bodyOf(note,f,messageNote(f));
  if(['extra_request','job','history_later_page'].includes(scenario)){assert.equal(result.operation_state,'suppressed',scenario);assert.equal(result.reason,'existing_customer_or_request_progressed');}
  else assert.ok(result.operation_state==='held'||result.http===503,scenario);
  assert.deepEqual(f.counts(),{client:1,request:1,note:1},scenario);
 }
});
test('message notes stop when the Request progresses, gets an assessment, changes client or disappears during the final recheck',async()=>{
 for(const scenario of ['scheduled','assessment','client_changed','missing','unknown_assessment']){
  const f=fixture({override({query,account}){if(query===_private.QUERIES.messageNoteParent)return {data:{account:{id:account},request:scenario==='missing'?null:{id:REQUEST,createdAt:new Date(NOW).toISOString(),requestStatus:scenario==='scheduled'?'assessment_completed':'new',...(scenario!=='unknown_assessment'?{assessment:scenario==='assessment'?{id:enc('Assessment',999)}:null}:{}),client:{id:scenario==='client_changed'?enc('Client',999):CLIENT,isArchived:false}}}};}});
  await bodyOf(write,f,f.body);const input=messageNote(f),result=await bodyOf(note,f,input);
  if(['scheduled','assessment'].includes(scenario)){assert.equal(result.operation_state,'suppressed',scenario);assert.equal(result.reason,'existing_customer_or_request_progressed');assert.equal(f.db.raw.prepare('SELECT operation_id FROM quo_intake_source_guards WHERE source_id=?').get(input.source.id).operation_id,input.operation_id);}
  else {assert.equal(result.operation_state,'held',scenario);assert.equal(result.reason,'intake_message_request_not_new');}
  assert.deepEqual(f.counts(),{client:1,request:1,note:1});
 }
});
test('uncertain message photo note never replays under the same or another event ID',async()=>{
 const f=fixture({override({query,state}){if(state.followup&&query===_private.MUTATIONS.note)throw Error('lost photo note response');}});await bodyOf(write,f,f.body);f.state.followup=true;const input=messageNote(f);
 const result=await bodyOf(note,f,input);assert.equal(result.operation_state,'held');assert.equal(result.uncertain,true);
 await bodyOf(note,f,input);assert.equal((await bodyOf(note,f,{...input,operation_id:'another-message-note',source:{...input.source,event_id:'EVanother-message'}})).operation_state,'suppressed');assert.deepEqual(f.counts(),{client:1,request:1,note:2});
});
test('message notes cannot bypass held parent outcomes, original guard ownership or messaging control commands',async()=>{
 for(const scenario of ['held_parent','uncertain_parent','source_guard','phone_guard','STOP','HELP','START']){
  const f=fixture();await bodyOf(write,f,f.body);const input=messageNote(f);
  if(scenario==='held_parent')f.db.raw.exec("UPDATE quo_intake_operations SET operation_state='held'");if(scenario==='uncertain_parent')f.db.raw.exec('UPDATE quo_intake_operations SET uncertain=1');
  if(scenario==='source_guard')f.db.raw.exec("UPDATE quo_intake_source_guards SET operation_id='other-owner'");if(scenario==='phone_guard')f.db.raw.exec("UPDATE quo_intake_phone_guards SET operation_id='other-owner'");
  if(['STOP','HELP','START'].includes(scenario))input.source.text=scenario;
  const result=await bodyOf(note,f,input);assert.equal(result.http,409,scenario);assert.deepEqual(f.counts(),{client:1,request:1,note:1},scenario);
 }
});

const permissionResponse=(account,kind='Job')=>({data:{account:{id:account},client:null},errors:[{message:`An object of type ${kind} was hidden due to permissions`,path:['client',kind==='Job'?'jobs':'requests','nodes',0]}]});
test('permission-denied histories are permanent holds with directly verified client context, never empty-history eligibility',async()=>{
 for(const kind of ['requests','jobs']) {
  const f=fixture({clients:[{id:CLIENT}],requests:[REQUEST],override({query,account}){
   if(query===_private.QUERIES[kind])return permissionResponse(account,kind==='jobs'?'Job':'Request');
  }});
  const result=await bodyOf(resolve,f,f.identity);
  assert.equal(result.http,200);assert.equal(result.classification,'held_incomplete_history');assert.equal(result.reason,'jobber_permission_denied');
  assert.equal(result.retryable,false);assert.equal(result.history_complete,false);assert.equal(result.client_id,CLIENT);
  assert.deepEqual(result.request_ids,kind==='jobs'?[REQUEST]:[]);assert.deepEqual(result.job_ids,[]);
  assert.ok(f.calls.some(c=>c.query===_private.QUERIES.client));assert.deepEqual(f.counts(),{client:0,request:0,note:0});
  assert.doesNotMatch(JSON.stringify(result),/hidden due to permissions/);
 }
});
test('permission error does not preserve unverified client context or override account and current-phone conflicts',async()=>{
 for(const scenario of ['phone_lookup','direct_unavailable','phone_changed','wrong_account']) {
  const f=fixture({clients:[{id:CLIENT}],requests:[REQUEST],override({query,account}){
   if(scenario==='phone_lookup'&&query===_private.QUERIES.phones)return permissionResponse(account,'Client');
   if(query===_private.QUERIES.jobs)return permissionResponse(scenario==='wrong_account'?ACCOUNTS.kc:account);
   if(query===_private.QUERIES.client&&scenario==='direct_unavailable')throw Error('temporary direct read failure');
   if(query===_private.QUERIES.client&&scenario==='phone_changed')return {data:{account:{id:account},client:{id:CLIENT,isArchived:false,phones:[{number:'+18165550999',normalizedPhoneNumber:'+18165550999'}]}}};
  }});
  const result=await bodyOf(resolve,f,f.identity);
  assert.equal(result.reason,scenario==='wrong_account'?'jobber_account_mismatch':scenario==='phone_changed'?'known_client_phone_changed':'jobber_permission_denied',scenario);
  assert.equal(result.retryable,false);assert.equal(result.client_id,null);assert.deepEqual(result.request_ids,[]);assert.equal(result.history_complete,false);
 }
});
test('only complete validated history pages survive a later permission denial',async()=>{
 const f=fixture({clients:[{id:CLIENT}],requests:[REQUEST],override({query,vars,account}){
  if(query===_private.QUERIES.jobs)return vars.after?permissionResponse(account):{data:{account:{id:account},client:{id:CLIENT,isArchived:false,jobs:{nodes:[{id:enc('Job',444)}],pageInfo:{hasNextPage:true,endCursor:'later'}}}}};
 }});
 const result=await bodyOf(resolve,f,f.identity);assert.equal(result.reason,'jobber_permission_denied');assert.equal(result.client_id,CLIENT);assert.deepEqual(result.request_ids,[REQUEST]);assert.deepEqual(result.job_ids,[]);assert.equal(result.history_complete,false);
});
test('generic GraphQL and transport errors still retry and cannot masquerade as verified history',async()=>{
 for(const message of ['temporary Jobber outage','permissions service temporarily unavailable']) {
  const f=fixture({clients:[{id:CLIENT}],override({query}){if(query===_private.QUERIES.jobs)return {errors:[{message}]};}});
  const result=await bodyOf(resolve,f,f.identity);assert.equal(result.reason,'jobber_read_failed');assert.equal(result.retryable,true);assert.equal(result.client_id,null);assert.equal(result.history_complete,false);
 }
});
test('permission denied before a write becomes a durable terminal hold, including preflight account reads',async()=>{
 for(const deniedQuery of ['account','jobs']) {
  const f=fixture({clients:[{id:CLIENT}],requests:[REQUEST],override({query,account}){if(query===_private.QUERIES[deniedQuery])return permissionResponse(account);}});
  f.body.expected_client_id=CLIENT;
  const result=await bodyOf(write,f,f.body);assert.equal(result.http,200);assert.equal(result.operation_state,'held');assert.equal(result.reason,'jobber_permission_denied');assert.equal(result.retryable,false);assert.equal(result.uncertain,false);
  assert.equal(result.client_id,deniedQuery==='jobs'?CLIENT:null);assert.equal(result.request_id,null);assert.deepEqual(f.counts(),{client:0,request:0,note:0});
  const reads=f.calls.length;assert.deepEqual(await bodyOf(write,f,f.body),result);assert.equal(f.calls.length,reads);
 }
});
test('permission lost after a confirmed client create preserves that client and never creates a Request or auto-retries',async()=>{
 const f=fixture({override({query,state,account}){if(state.clients.length&&query===_private.QUERIES.jobs)return permissionResponse(account);}});
 const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.reason,'jobber_permission_denied');assert.equal(result.client_id,CLIENT);assert.equal(result.classification,'eligible_new_client');assert.equal(result.retryable,false);assert.equal(result.uncertain,false);assert.equal(result.request_id,null);
 await bodyOf(write,f,f.body);assert.equal((await bodyOf(resume,f,{...f.identity,operation_id:f.body.operation_id,expected_client_id:CLIENT})).code,'intake_recovery_not_safe');assert.deepEqual(f.counts(),{client:1,request:0,note:0});
});
test('operator recovery encountering denied history preserves the partial record and ends without a new write',async()=>{
 const f=await legacyHeldPartial({override({query,state,account}){if(state.recoveryAudit&&query===_private.QUERIES.jobs)return permissionResponse(account);}});
 f.state.recoveryAudit=true;
 const before=f.db.raw.prepare('SELECT source_json,intent_sha256,client_id FROM quo_intake_operations').get();
 const result=await bodyOf(resume,f,f.recovery);assert.equal(result.operation_state,'held');assert.equal(result.reason,'jobber_permission_denied');assert.equal(result.retryable,false);assert.equal(result.uncertain,false);assert.equal(result.client_id,CLIENT);assert.equal(result.request_id,null);
 assert.deepEqual(f.db.raw.prepare('SELECT source_json,intent_sha256,client_id FROM quo_intake_operations').get(),before);
 assert.equal((await bodyOf(resume,f,f.recovery)).code,'intake_recovery_not_safe');assert.deepEqual(f.counts(),{client:1,request:0,note:0});
});
test('follow-on photo note with denied history holds once without attaching or altering its original Request',async()=>{
 const f=fixture({override({query,state,account}){if(state.followup&&query===_private.QUERIES.jobs)return permissionResponse(account);}});
 await bodyOf(write,f,f.body);f.state.followup=true;const input=messageNote(f);
 const result=await bodyOf(note,f,input);assert.equal(result.operation_state,'held');assert.equal(result.reason,'jobber_permission_denied');assert.equal(result.retryable,false);assert.equal(result.uncertain,false);assert.equal(result.client_id,CLIENT);assert.equal(result.request_id,REQUEST);
 assert.deepEqual(await bodyOf(note,f,input),result);assert.deepEqual(f.counts(),{client:1,request:1,note:1});assert.equal((await bodyOf(status,f,{account_id:f.identity.account_id,operation_id:f.body.operation_id})).operation_state,'completed');
});
test('permission-looking mutation errors retain uncertain outcome protection rather than permanent read classification',async()=>{
 const f=fixture({override({query}){if(query===_private.MUTATIONS.request)return {errors:[{message:'An object of type Request was hidden due to permissions'}]};}});
 const result=await bodyOf(write,f,f.body);assert.equal(result.operation_state,'held');assert.equal(result.reason,'jobber_write_outcome_unknown');assert.equal(result.uncertain,true);assert.equal(result.client_id,CLIENT);
 await bodyOf(write,f,f.body);assert.deepEqual(f.counts(),{client:1,request:1,note:0});
});
