import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveQuoClientFirstName} from '../server/quo-client-name.js';
const enc=(kind,id)=>btoa(`gid://Jobber/${kind}/${id}`);
const account=enc('Account',2498432),client={id:enc('Client',111),firstName:'New lead',lastName:''};
const proof=(patch={})=>({account_id:account,client_id:client.id,operation_kind:'intake',classification:'eligible_new_client',source_json:JSON.stringify({type:'call',id:'CAfixture'}),...patch});
function env(rows,calls=[]) {
 return {ANGI_ROUTER_DB:{prepare(sql) {
  calls.push(sql);
  return {bind(...args) {
   assert.deepEqual(args,[account,client.id]);
   return {all:async()=>({success:true,results:rows})};
  }};
 }}};
}

test('only an exact integration-created nameless-client proof makes the current generic placeholder unknown',async()=>{
 assert.equal(await resolveQuoClientFirstName(env([proof()]),account,client),'');
 for(const row of [proof({account_id:enc('Account',2498453)}),proof({client_id:enc('Client',222)}),proof({classification:'eligible_unused_client'}),proof({operation_kind:'note'}),proof({source_json:JSON.stringify({type:'call',contact_id:'CTreal',first_name:'New lead'})})])assert.equal(await resolveQuoClientFirstName(env([row]),account,client),'New lead');
 assert.equal(await resolveQuoClientFirstName(env([]),account,client),'New lead');
});
test('real name edits immediately take precedence and do not require another database read',async()=>{
 for(const person of [{...client,firstName:'Susan'},{...client,lastName:'Smith'}]){
  const calls=[];assert.equal(await resolveQuoClientFirstName(env([proof()],calls),account,person),person.firstName);assert.equal(calls.length,0);
 }
});
test('an unavailable creation-proof read cannot promote the system placeholder to a personal name',async()=>{
 const broken={ANGI_ROUTER_DB:{prepare(){throw Error('database unavailable');}}};
 await assert.rejects(resolveQuoClientFirstName(broken,account,client));
});
