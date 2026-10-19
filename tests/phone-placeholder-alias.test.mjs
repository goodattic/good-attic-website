import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePhonePlaceholderAlias,PHONE_ALIAS_FLAG} from '../server/phone-placeholder-alias.js';
import {evaluateLeadWatch} from '../server/phone-lead-watch-model.js';
import {serviceScopeFromText} from '../server/lead-service-scope.js';
import {readQualifiedPhoneAlias,aliasOperationalRequest} from '../server/qualified-phone-placeholder-alias.js';
import {readAliasIdentity,readAliasCandidates} from '../server/phone-placeholder-alias-reader.js';
import {fixture} from './fixtures/phone-placeholder-alias.mjs';
const watch=f=>evaluateLeadWatch({...f,googleCalls:[f.call],quoCalls:[f.quo],serviceScopes:{[f.call.google_resource]:serviceScopeFromText('Attic insulation')}});
test('live alias flag defaults off without network or database access',async()=>{assert.deepEqual(await readQualifiedPhoneAlias({},{}),{ok:true,disabled:true});assert.equal(PHONE_ALIAS_FLAG,'QUALIFIED_PHONE_PLACEHOLDER_ALIAS_ENABLED');});
test('active and archived automatic shells resolve to the same named client without altering source IDs',()=>{
 const f=fixture(),a=resolvePhonePlaceholderAlias(f);assert.equal(a.status,'resolved');
 f.clients[0].isArchived=true;f.objects[0].object.requestStatus='archived';
 assert.deepEqual(resolvePhonePlaceholderAlias(f),a);assert.equal(a.original_client_id,'100');assert.equal(a.original_request_id,'200');assert.equal(a.operational_client_id,'101');
 const r=watch(f);assert.deepEqual(r.sources[0].client_ids,['101']);assert.deepEqual(r.sources[0].candidate_client_ids,['100','101']);assert.equal(r.sources[0].quo.jobber_request_id,'200');
 assert.equal(r.results.find(x=>x.type==='sold_job').result_id,'gae-slc-sold-400');assert.equal(r.results.find(x=>x.type==='sold_job').state,'would_send');
 assert.equal(r.results.find(x=>x.type==='qualified_lead').request_id,'201');assert.equal(f.quo.jobber_client_id,'100');
});
test('two named clients, alternate-only matches and unproven placeholders stay ambiguous',()=>{
 const changes=[f=>f.clients[0].name='Another Buyer',f=>f.clients[1].phones=[{number:'+18015550202'}],f=>f.intakeOperations=[],f=>f.intakeOperations[0].classification='eligible_unused_client',f=>f.intakeOperations[0].source_has_name=1,f=>f.intakeOperations[0].uncertain=1,f=>f.intakeOperations[0].quo_call_id='ACother',f=>f.intakeOperations.push({...f.intakeOperations[0],operation_id:'second'}),f=>f.clients[1].market_key='mo_stl'];
 for(const change of changes){const f=fixture();change(f);assert.equal(resolvePhonePlaceholderAlias(f).status,'held');assert.equal(watch(f).results.some(r=>r.state==='would_send'),false);}
});
test('identity conflicts, incomplete reads and independent placeholder work are held',()=>{
 const changes=[f=>f.clients[0].emails=[{address:'someoneelse@example.test'}],f=>f.clients[0].alias_address_fingerprints=['different'],f=>f.clients[0].phones.push({number:'+18015550303'}),f=>f.clients[0].history_complete=false,f=>f.clients[1].alias_identity_complete=false,f=>f.objects[0].object.assessment={id:'independent'},f=>f.objects.push({...f.objects[2],client_id:'100'}),f=>f.clients[0].alias_invoice_dates=['2026-10-02T12:00:00Z'],f=>f.historicalRequests.push({market_key:'ut',client_id:'100',request_id:'other',created_at:'2026-10-02T12:00:00Z'}),f=>f.dispositions.push({market_key:'ut',request_id:'200',disposition:'test_excluded'})];
 for(const change of changes){const f=fixture();change(f);assert.equal(resolvePhonePlaceholderAlias(f).status,'held');}
});
test('earlier history on either client, deleted intake or invoice still prevents credit',()=>{
 const old='2026-09-30T12:00:00Z';
 for(const change of [f=>f.clients[1].createdAt=old,f=>{f.clients[0].createdAt=old;f.intakeOperations[0].created_at=old;f.intakeOperations[0].source_at=old;},f=>f.objects[0].object.createdAt=old,f=>f.objects[2].object.createdAt=old,f=>f.historicalRequests.push({market_key:'ut',phone:f.quo.caller_phone,created_at:old,request_id:'deleted'}),f=>f.clients[1].alias_invoice_dates=[old]]){
  const f=fixture();change(f);assert.equal(resolvePhonePlaceholderAlias(f).status,'held');assert.equal(watch(f).results.some(r=>r.state==='would_send'),false);
 }
 const unknown=fixture();unknown.objects[1].object.createdAt=null;assert.equal(resolvePhonePlaceholderAlias(unknown).reason,'alias_history_incomplete');
});
test('deleted automatic request can retain provenance but a deleted client cannot be silently inferred',()=>{
 const f=fixture();f.objects[0].current_present=false;assert.equal(resolvePhonePlaceholderAlias(f).status,'resolved');
 f.clients.shift();assert.equal(resolvePhonePlaceholderAlias(f).status,'held');
});
test('scope, qualification, timing and accepted/refused identities survive aliasing',()=>{
 const f=fixture();f.ledger=[{event_id:'gae-slc-sold-400',status:'accepted'}];assert.equal(watch(f).results.find(r=>r.type==='sold_job').state,'already_accepted');
 f.ledger=[{event_id:'gae-slc-sold-400',status:'rejected',error_category:'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY'}];assert.equal(watch(f).results.find(r=>r.type==='sold_job').state,'permanently_failed');
 f.ledger=[];f.clients[1].isArchived=true;assert.equal(watch(f).results.find(r=>r.type==='qualified_lead').state,'held');f.clients[1].isArchived=false;
 f.objects[1].object.assessment=null;assert.equal(watch(f).results.find(r=>r.type==='qualified_lead').state,'held');
 f.qualifications={[f.call.google_resource]:{ok:true,callId:'ACcallback'}};assert.equal(watch(f).results.find(r=>r.type==='qualified_lead').state,'would_send');
 const off=evaluateLeadWatch({...f,googleCalls:[f.call],quoCalls:[f.quo],serviceScopes:{[f.call.google_resource]:serviceScopeFromText('spray foam shed')}});assert.equal(off.results.some(r=>r.state==='would_send'),false);
 f.objects[2].object.lastTransitioned.approvedAt=f.call.start_call_date_time;assert.equal(watch(f).results.find(r=>r.type==='sold_job').state,'held');
});
test('live operational selection never uses an archived named request or guesses between milestones',()=>{
 const f=fixture(),resolution=resolvePhonePlaceholderAlias(f);
 assert.equal(aliasOperationalRequest({...f,resolution}).request.id,'201');
 f.objects[1].object.requestStatus='archived';assert.equal(aliasOperationalRequest({...f,resolution}).reason,'alias_operational_request_unavailable');
 f.objects[1].object.requestStatus='new';f.objects.push({...f.objects[1],object_id:'202',object:{...f.objects[1].object,id:'202'}});assert.equal(aliasOperationalRequest({...f,resolution}).reason,'alias_multiple_operational_requests');
});
test('alias identity reader hashes addresses, pages history and rejects incomplete or cross-account replies',async()=>{
 let calls=0;
 const gql=async()=>{calls++;return {account:{id:'2498432'},client:{id:'100',billingAddress:{street1:'1 Example Road',city:'Town'},clientProperties:{nodes:[],pageInfo:{hasNextPage:false}},invoices:{nodes:calls===1?[{id:'i1',createdAt:'2026-10-02T12:00:00Z'}]:[],pageInfo:{hasNextPage:calls===1,endCursor:'next'}}}};};
 const r=await readAliasIdentity({gql,marketKey:'ut',accountId:'2498432',clientId:'100'});assert.equal(calls,2);assert.equal(r.alias_address_fingerprints.length,1);assert(!JSON.stringify(r).includes('Example'));assert.equal(r.alias_invoice_dates.length,1);
 await assert.rejects(readAliasIdentity({gql:async()=>({account:{id:'other'}}),marketKey:'ut',accountId:'2498432',clientId:'100'}));
 await assert.rejects(readAliasCandidates({gql:async()=>({account:{id:'2498432'},clients:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}),marketKey:'ut',accountId:'2498432',callerPhone:'+18015550101'}),/repeated_cursor/);
});
