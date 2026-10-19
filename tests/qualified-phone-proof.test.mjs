import test from 'node:test';
import assert from 'node:assert/strict';
import {jobberLeadProof, twoWayQuoProof, quoConversationProof} from '../server/qualified-phone-proof.js';

const start = '2026-10-05T16:23:59Z';
const caller = '+13145550123';
const line = '+13149312620';
const phoneNumberId = 'PN6LVKAV9A';
const baseCall = {
 id:'ACtwoWay', phoneNumberId, participants:[line,caller], direction:'outgoing', status:'completed',
 createdAt:'2026-10-05T17:23:59Z', answeredAt:'2026-10-05T17:24:01Z', duration:120, aiHandled:null,
};
const baseTranscript = {callId:'ACtwoWay',status:'completed',dialogue:[
 {identifier:caller,userId:null,content:'I need an attic inspection'},
 {identifier:line,userId:'USagent',content:'We can schedule one'},
]};
const client = {id:'client',isArchived:false};
const request = {id:'request',requestStatus:'converted',assessment:null,quotes:{nodes:[]}};

test('Jobber milestone requires an active, non-excluded request',()=>{
 assert.deepEqual(jobberLeadProof({request,client}),{ok:true,milestone:null});
 assert.equal(jobberLeadProof({request:{...request,assessment:{id:'a',startAt:'2026-10-06T17:00:00Z'}},client}).milestone,'assessment_scheduled');
 assert.equal(jobberLeadProof({request:{...request,assessment:{id:'a',isComplete:true,completedAt:'2026-10-07T17:00:00Z'}},client}).milestone,'assessment_completed');
 assert.equal(jobberLeadProof({request:{...request,quotes:{nodes:[{id:'q'}]}},client}).milestone,'quote');
 for(const variant of [
  {request,client:{...client,isArchived:true}},
  {request:{...request,requestStatus:'archived',quotes:{nodes:[{id:'q'}]}},client},
  {request:{...request,requestStatus:'junk',quotes:{nodes:[{id:'q'}]}},client},
  {request:{...request,quotes:{nodes:[{id:'q'}]}},client,disposition:{disposition:'test_excluded'}},
 ]) assert.equal(jobberLeadProof(variant).ok,false);
 assert.deepEqual(jobberLeadProof({request:{...request,quotes:null},client}),{ok:true,milestone:null});
});

test('two-way Quo proof requires answered duration, both people and a seven-day window',()=>{
 const input={call:baseCall,transcript:baseTranscript,callerPhone:caller,phoneNumberId,googleCallAt:start};
 assert.equal(twoWayQuoProof(input),true);
 assert.equal(twoWayQuoProof({...input,call:{...baseCall,duration:59}}),false);
 assert.equal(twoWayQuoProof({...input,call:{...baseCall,answeredAt:null}}),false);
 assert.equal(twoWayQuoProof({...input,call:{...baseCall,answeredAt:'2026-10-12T16:24:00Z'}}),false);
 assert.equal(twoWayQuoProof({...input,call:{...baseCall,aiHandled:true}}),false);
 assert.equal(twoWayQuoProof({...input,call:{...baseCall,createdAt:'2026-10-12T16:24:00Z'}}),false);
 assert.equal(twoWayQuoProof({...input,call:{...baseCall,participants:[line,'+13145550999']}}),false);
 assert.equal(twoWayQuoProof({...input,transcript:{...baseTranscript,dialogue:[baseTranscript.dialogue[0]]}}),false);
 assert.equal(twoWayQuoProof({...input,transcript:{...baseTranscript,dialogue:[baseTranscript.dialogue[1]]}}),false);
 assert.equal(twoWayQuoProof({...input,transcript:{...baseTranscript,dialogue:[baseTranscript.dialogue[0],{...baseTranscript.dialogue[1],userId:null}]}}),false);
});

test('Quo read verifies transcript and handles incomplete or unavailable evidence conservatively',async()=>{
 const seen=[];
 const fetcher=async(url,init)=>{
  seen.push({url,init});
  if(url.includes('/call-transcripts/'))return Response.json({data:baseTranscript});
  return Response.json({data:[baseCall]});
 };
 const opts={apiKey:'test-key',callerPhone:caller,phoneNumberId,googleCallAt:start,fetcher};
 assert.deepEqual(await quoConversationProof(opts),{ok:true,callId:'ACtwoWay'});
 assert.equal(seen[0].init.headers.Authorization,'test-key');
 assert.equal(seen[0].init.redirect,'manual');
 const url=new URL(seen[0].url);
 assert.equal(url.searchParams.get('participants'),caller);
 assert.equal(url.searchParams.get('phoneNumberId'),phoneNumberId);
 assert.deepEqual(await quoConversationProof({...opts,apiKey:null}),{ok:false,reason:'quo_proof_unavailable'});
 const unavailable=await quoConversationProof({...opts,fetcher:async url=>url.includes('/call-transcripts/')?new Response(null,{status:503}):Response.json({data:[baseCall]})});assert.equal(unavailable.reason,'quo_transcript_unavailable');assert.equal(unavailable.reader_failure.http_status,503);
 assert.deepEqual(await quoConversationProof({...opts,fetcher:async()=>Response.json({data:[],nextPageToken:'same'})}),{ok:false,reason:'quo_history_incomplete'});
});
test('Quo call and transcript readers reject redirects, retain safe status, and never leak exceptions',async()=>{
 const opts={apiKey:'fixture',callerPhone:caller,phoneNumberId,googleCallAt:start};
 for(const endpoint of ['calls','transcript'])for(const status of [301,302,303,307,308,401,503]){
  let requests=0;const r=await quoConversationProof({...opts,fetcher:async(url,init)=>{assert.equal(init.redirect,'manual');requests++;return endpoint==='transcript'&&!url.includes('transcripts')?Response.json({data:[baseCall]}):Response.json({}, {status});}});
  assert.equal(r.ok,false);assert.equal(r.reader_failure.http_status,status);assert.equal(r.reader_failure.step,endpoint==='calls'?'quo_calls':'quo_transcript');assert.equal(requests,endpoint==='calls'?1:2);
  if(status<400)assert.equal(r.reader_failure.error_message,'reader_external_redirect_blocked');
 }
 const r=await quoConversationProof({...opts,fetcher:async()=>{throw new TypeError('PRIVATE_CUSTOMER_TEXT');}});assert.equal(r.reader_failure.error_class,'TypeError');assert(!JSON.stringify(r).includes('PRIVATE_CUSTOMER_TEXT'));assert(Number.isFinite(Date.parse(r.reader_failure.completed_at)));
});
