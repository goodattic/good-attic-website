import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLeadWatchSnapshot,phoneLeadWatchCycle,requestServiceScope,WATCH_REQUEST_SCOPE_QUERY} from '../server/phone-lead-watch-runtime.js';
import {evaluateLeadWatch} from '../server/phone-lead-watch-model.js';
const google={google_resource:'customers/4800890529/callViews/readtest',market_key:'mo_stl',start_call_date_time:'2026-10-01T12:00:00Z',caller_area_code:'314',call_duration_seconds:120};
function setup({incomplete=false,repeatContacts=false,callSummary='Caller asked about attic insulation.',formText='Attic insulation'}={}) {
 const tables={
  angi_router_jobber_auth:['utah','stl','kc'].map(account_key=>({account_key,access_token:account_key})),
  phone_lead_watch_sources:[],quo_call_attributions:[],
  quo_call_capture_stage:[{quo_call_id:'ACread',account_id:'2498453',market:'stl',destination_number:'+13149312620',caller_phone:'+13145550101',call_started_at_utc:'2026-10-01T12:00:00.500Z',direction:'incoming'}],
  closed_loop_stage1_objects:[],closed_loop_stage1_leads:[],closed_loop_leads:[],quo_intake_operations:[],closed_loop_lead_dispositions:[],closed_loop_google_uploads:[],google_ads_outcome_outbox:[],qualified_phone_calls:[],
 };
 const database={prepare(sql){assert.match(sql,/^SELECT /);return{bind(){return this;},async all(){const table=sql.match(/FROM (\w+)/)[1];assert.ok(table in tables,table);return{results:tables[table]};}};}};
 const client={id:'100',name:'Test fixture buyer',lastName:'Buyer',isArchived:false,createdAt:'2026-10-01T12:01:00Z',phones:[{number:'3145552222'}],emails:[]};
 const urls=[];
 const fetcher=async(url,options)=>{
  urls.push({url,method:options.method||'GET'});
  if(url==='https://api.getjobber.com/api/graphql') {
   const {query,variables}=JSON.parse(options.body);assert.doesNotMatch(query,/\bmutation\b/);const account=options.headers.Authorization.replace('Bearer ','');
   if(query.includes('clients(first:'))return Response.json({data:{account:{id:{stl:'2498453',utah:'2498432',kc:'1919824'}[account]},clients:{nodes:account==='stl'?[client]:[],pageInfo:{hasNextPage:false}}}});
   if(query===WATCH_REQUEST_SCOPE_QUERY)return Response.json({data:{request:{id:variables.id,title:formText,notes:{nodes:[],pageInfo:{hasNextPage:false}},requestDetails:null}}});
   if(incomplete)return Response.json({errors:[{message:'not exposed'}]});
   const empty={nodes:[],pageInfo:{hasNextPage:false}};
   return Response.json({data:{client:{...client,requests:{nodes:variables.requestsAfter?[]:[{id:'200',createdAt:'2026-10-01T12:02:00Z',requestStatus:'new',assessment:null,quotes:{nodes:[]}}],pageInfo:{hasNextPage:!variables.requestsAfter,endCursor:'request-page-two'}},quotes:empty,jobs:empty}}});
  }
  const u=new URL(url);
  if(u.pathname==='/v1/contacts')return Response.json({data:[{id:'COread',defaultFields:{phoneNumbers:[{value:'+13145550101'},{value:'+13145552222'}]}}],...(repeatContacts?{nextPageToken:'repeat'}:{})});
  if(u.pathname==='/v1/call-summaries/ACread')return Response.json({data:{summary:[callSummary]}});
  if(u.pathname==='/v1/call-transcripts/ACread')return Response.json({data:{dialogue:[]}});
  throw Error('unexpected endpoint');
 };
 return{env:{ANGI_ROUTER_DB:database,QUO_API_KEY:'test-key'},fetcher,urls,tables};
}
test('production reader pages Jobber history, reads stage-only calls and alternate Quo contact phones',async()=>{
 const t=setup();const snap=await loadLeadWatchSnapshot(t.env,{since:'2026-09-01',now:'2026-10-13T21:00:00Z',fetcher:t.fetcher,googleCalls:[google]});
 assert.equal(snap.clients.length,1);assert.equal(snap.clients[0].history_complete,true);assert.equal(snap.objects.length,1);
 assert.equal(evaluateLeadWatch(snap).sources[0].client_ids[0],'100');
 assert.equal(t.urls.filter(x=>x.url.includes('upload')||x.url.includes('ingest')).length,0);
});
test('partial Jobber history and repeated Quo cursor fail closed',async()=>{
 for(const options of [{incomplete:true},{repeatContacts:true}]) {const t=setup(options);await assert.rejects(loadLeadWatchSnapshot(t.env,{since:'2026-09-01',now:'2026-10-13T21:00:00Z',fetcher:t.fetcher,googleCalls:[google]}));}
});
test('pending calls survive the rolling lookback for their final day-14 check',async()=>{
 const t=setup();t.tables.phone_lead_watch_sources=[{evidence_json:JSON.stringify({key:google.google_resource,path:'call',state:'pending',at:google.start_call_date_time,google})}];
 const snap=await loadLeadWatchSnapshot(t.env,{since:'2026-10-02',now:'2026-10-16T12:00:00Z',fetcher:t.fetcher,googleCalls:[]});assert.equal(snap.googleCalls.length,1);
});
test('reader screens scope for calls and deleted/split form requests, persisting codes instead of text',async()=>{
 const marker='sensitive-text-must-not-persist';
 const t=setup({callSummary:'Caller requests spray foam for a shed. '+marker,formText:'Attic fan only. '+marker});
 t.tables.closed_loop_stage1_leads=[{market_key:'mo_stl',request_id:'deleted',inquiry_at:google.start_call_date_time,gclid:'test'}];
 t.tables.closed_loop_leads=[{market_key:'mo_stl',jobber_request_id:'deleted',jobber_client_id:'100',service:'Attic Insulation'}];
 const snap=await loadLeadWatchSnapshot(t.env,{since:'2026-09-01',now:'2026-10-13T21:00:00Z',fetcher:t.fetcher,googleCalls:[google]});
 assert.equal(snap.serviceScopes[google.google_resource].state,'off_scope_only');
 // Explicit in-scope original selection remains sufficient with an add-on.
 assert.equal(snap.serviceScopes['click:mo_stl:deleted'].state,'in_scope');
 assert.doesNotMatch(JSON.stringify(snap),new RegExp(marker));
 const result=evaluateLeadWatch(snap);assert.equal(result.results.some(r=>r.state==='would_send'),false);
});
test('positive scope survives partial optional pages; negative incomplete intake fails closed and labels do not count',()=>{
 const a=requestServiceScope({id:'1',title:'Attic insulation',notes:{nodes:[],pageInfo:{hasNextPage:true}}});assert.equal(a.state,'in_scope');
 assert.throws(()=>requestServiceScope({id:'3',title:'Spray foam',notes:{nodes:[],pageInfo:{hasNextPage:true}}}),/incomplete/);
 const b=requestServiceScope({id:'2',requestDetails:{form:{sections:{nodes:[{items:{nodes:[{label:'Attic Insulation, Spray Foam, Attic Fans'}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}}}});assert.equal(b.state,'unknown');
});
