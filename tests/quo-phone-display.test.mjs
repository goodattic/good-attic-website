import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolveQuoClientFirstName} from '../server/quo-client-name.js';
import {_private as intake} from '../server/jobber-quo-intake.js';
import {handleJobberContactResolve} from '../server/jobber-contact-resolver.js';
import {handleJobberAlertResolve} from '../server/jobber-alert-resolver.js';

const encoded=(kind,id)=>btoa(`gid://Jobber/${kind}/${id}`);
const account=encoded('Account',1919824),clientId=encoded('Client',111),requestId=encoded('Request',222);
const phone='+18165550101',secret='fixture-phone-display-secret';
const source={type:'call',id:'ACcaller',event_id:'EVcaller',from:phone,to:'+18164340308',conversation_id:'CNcaller',occurred_at:'2026-09-09T14:00:00.000Z',status:'completed'};
const client={id:clientId,firstName:phone,lastName:'',companyName:null,isCompany:false,updatedAt:'2026-09-09T14:00:01.000Z',
  phones:[{id:encoded('ClientPhoneNumber',1),number:phone,normalizedPhoneNumber:phone,primary:true,description:'Main',smsAllowed:false}],emails:[]};

function database(t) {
  const raw=new DatabaseSync(':memory:');
  raw.exec(fs.readFileSync(new URL('../migrations/0006_quo_intake_operations.sql',import.meta.url),'utf8'));
  t.after(()=>raw.close());
  const reads=[];
  const db={prepare(sql){
    assert.match(sql,/^\s*SELECT\b/iu,'name proof is read-only');
    return {bind(...args){
      reads.push({sql,args});
      const statement=raw.prepare(sql);
      return {all:async()=>({success:true,results:statement.all(...args)}),first:async()=>statement.get(...args)||null};
    }};
  }};
  function insert(overrides={}) {
    const now=new Date().toISOString();
    const row={operation_id:'phone-display-intake',operation_kind:'intake',account_id:account,market:'kc',phone,phone_number_id:'PNZBZnj8mz',
      intent_sha256:'a'.repeat(64),source_json:JSON.stringify(source),operation_state:'completed',classification:'eligible_new_client',
      client_id:clientId,created_at:now,updated_at:now,...overrides};
    const keys=Object.keys(row);
    raw.prepare(`INSERT INTO quo_intake_operations (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
  }
  return {raw,reads,insert,env:{ANGI_ROUTER_DB:db,CONTACT_SYNC_BROKER_SECRET:secret}};
}

function context(f,path,body){return {env:f.env,request:new Request(`https://site.test/api/jobber/${path}`,{
  method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(body),
})};}
const dependencies=data=>({refreshJobberAccessToken:async()=>({accessToken:'fixture-never-live'}),jobberGraphql:async(_env,_token,query)=>{
  assert.match(query,/^query\b/u);return {data};
}});

test('unknown call names use the actual caller number in all markets while text intake keeps its existing placeholder',()=>{
  for(const number of ['+18015550101','+13145550101','+18165550101']){
    assert.deepEqual(intake.newClientNames({...source,from:number}),{firstName:number});
  }
  assert.deepEqual(intake.newClientNames({...source,type:'message',status:'received',text:'Please call me'}),{firstName:'New lead'});
  assert.deepEqual(intake.newClientNames({...source,contact_id:'CTnamed',first_name:'Jane',last_name:'Carter'}),{firstName:'Jane',lastName:'Carter'});
  assert.deepEqual(intake.newClientNames({...source,contact_id:'CTnamed',last_name:'Carter'}),{lastName:'Carter'});
});

test('exact nameless call creation proof keeps a phone display out of the personal-name feed in all accounts',async t=>{
  for(const id of [2498432,2498453,1919824]){
    const f=database(t),target=encoded('Account',id);f.insert({account_id:target});
    assert.equal(await resolveQuoClientFirstName(f.env,target,client),'');
    assert.equal(client.firstName,phone,'the read helper does not change the Jobber display object');
  }
});

test('a phone-shaped name without exact creation provenance remains a manually entered name',async t=>{
  const cases=[null,{account_id:encoded('Account',2498432)},{client_id:encoded('Client',999)},
    {operation_kind:'note'},{classification:'eligible_unused_client'},{phone:'+18165550199'},
    {source_json:JSON.stringify({...source,type:'message'})},
    {source_json:JSON.stringify({...source,from:'+18165550199'})},
    {source_json:JSON.stringify({...source,from:undefined})},
    {source_json:JSON.stringify({...source,contact_id:'CThuman',first_name:phone})}];
  for(const row of cases){
    const f=database(t);if(row)f.insert(row);
    assert.equal(await resolveQuoClientFirstName(f.env,account,client),phone,JSON.stringify(row));
  }
});

test('legacy placeholders remain unknown only with their original proof, and human names always take precedence',async t=>{
  const f=database(t);f.insert();
  assert.equal(await resolveQuoClientFirstName(f.env,account,{...client,firstName:'New lead'}),'');
  for(const person of [{...client,firstName:'Jane',lastName:'Carter'},{...client,firstName:'New lead',lastName:'Smith'},
    {...client,firstName:'+18165550199'},{...client,firstName:'(816) 555-0101'}]){
    assert.equal(await resolveQuoClientFirstName(f.env,account,person),person.firstName);
  }
  const noProof=database(t);
  assert.equal(await resolveQuoClientFirstName(noProof.env,account,{...client,firstName:'New lead'}),'New lead');
  const legacyText=database(t);legacyText.insert({source_json:JSON.stringify({...source,type:'message'})});
  assert.equal(await resolveQuoClientFirstName(legacyText.env,account,{...client,firstName:'New lead'}),'');
});

test('the CLIENT_CREATE race waits for the matching unresolved call create rather than treating its phone label as a human name',async t=>{
  const f=database(t);f.insert({client_id:null,operation_state:'client_creating',lease_token:'fixture-lease',lease_expires_at:Date.now()+120000});
  await assert.rejects(resolveQuoClientFirstName(f.env,account,client));
  f.raw.prepare("UPDATE quo_intake_operations SET client_id=?,operation_state='client_created' WHERE operation_id=?").run(clientId,'phone-display-intake');
  assert.equal(await resolveQuoClientFirstName(f.env,account,client),'');
});

test('unrelated in-flight creates cannot suspend a manual numeric name in another account or for another caller',async t=>{
  for(const row of [{account_id:encoded('Account',2498432)},{phone:'+18165550199',source_json:JSON.stringify({...source,from:'+18165550199'})},
    {source_json:JSON.stringify({...source,type:'message'})},{classification:'eligible_unused_client'},
    {source_json:JSON.stringify({...source,from:undefined})},{source_json:JSON.stringify({...source,first_name:'Jane'})},{operation_state:'client_created'}]){
    const f=database(t);f.insert({client_id:null,operation_state:'client_creating',...row});
    assert.equal(await resolveQuoClientFirstName(f.env,account,client),phone);
  }
});

test('unavailable or corrupted name proof never leaks the generated phone label as a personal name',async t=>{
  const broken={ANGI_ROUTER_DB:{prepare(){throw Error('fixture database unavailable');}}};
  await assert.rejects(resolveQuoClientFirstName(broken,account,client));
  const malformed=database(t);malformed.insert({source_json:'{invalid-json'});
  await assert.rejects(resolveQuoClientFirstName(malformed.env,account,client));
});

test('contact updates retain the phone but omit its temporary name, then expose a staff-entered human name',async t=>{
  const f=database(t);f.insert();
  const body={account_id:account,topic:'CLIENT_CREATE',item_id:clientId};
  const read=async value=>{
    const response=await handleJobberContactResolve(context(f,'contact-resolve',body),dependencies({account:{id:account},client:value}));
    assert.equal(response.status,200);return (await response.json()).client;
  };
  const unnamed=await read(client);assert.equal(unnamed.firstName,'');assert.equal(unnamed.lastName,'');assert.deepEqual(unnamed.phones,client.phones);
  const surname=await read({...client,lastName:'Carter'});assert.equal(surname.firstName,'');assert.equal(surname.lastName,'Carter','a partial human name is retained without importing the phone as a first name');
  const named=await read({...client,firstName:'Jane',lastName:'Carter'});assert.equal(named.firstName,'Jane');assert.equal(named.lastName,'Carter');assert.equal(named.id,unnamed.id);
});

test('contact resolution returns a retryable read failure during unresolved creation and succeeds after its client ID is checkpointed',async t=>{
  const f=database(t);f.insert({client_id:null,operation_state:'client_creating'});
  const read=()=>handleJobberContactResolve(context(f,'contact-resolve',{account_id:account,topic:'CLIENT_CREATE',item_id:clientId}),dependencies({account:{id:account},client}));
  assert.equal((await read()).status,503);
  f.raw.prepare("UPDATE quo_intake_operations SET client_id=?,operation_state='client_created'").run(clientId);
  const completed=await read();assert.equal(completed.status,200);assert.equal((await completed.json()).client.firstName,'');
});

test('internal alerts preserve the Jobber phone display label and real request-specific display names',async t=>{
  const f=database(t);f.insert();
  const base={id:requestId,createdAt:'2026-09-09T14:00:01.000Z',title:'Quo call inquiry',jobberWebUri:'https://secure.getjobber.com/work_requests/222',
    source:'api',phone,email:null,contactName:phone,client:{...client,name:phone,phone,email:null,leadSource:'Quo'},property:null};
  const read=async record=>{
    const response=await handleJobberAlertResolve(context(f,'alert-resolve',{account_id:account,request_id:requestId}),dependencies({account:{id:account},request:record}));
    assert.equal(response.status,200);return (await response.json()).request;
  };
  const unknown=await read(base);assert.equal(unknown.contactName,phone);assert.equal(unknown.phone,phone);
  assert.equal((await read({...base,contactName:'Jane Carter'})).contactName,'Jane Carter');
  assert.equal((await read({...base,contactName:null,client:{...base.client,firstName:'Jane',lastName:'Carter',name:'Jane Carter'}})).contactName,'Jane Carter');
});
