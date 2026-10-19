import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {phoneCycle,submitPhone} from '../server/qualified-phone-runtime.js';
import {PHONE_ALIAS_FLAG,PLACEHOLDER_ALIAS_POLICY} from '../server/phone-placeholder-alias.js';
import {fixture} from './fixtures/phone-placeholder-alias.mjs';
const account='Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==';
function setup(options={}) {
 const f=fixture(),sql=new DatabaseSync(':memory:');
 for(const migration of ['0009_google_ads_outcome_outbox','0011_stage1_outbox','0016_qualified_phone_calls','0031_qualified_phone_scope','0032_qualified_phone_placeholder_alias'])sql.exec(readFileSync(new URL('../migrations/'+migration+'.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0006_quo_intake_operations.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE quo_call_attributions(quo_call_id TEXT, caller_phone TEXT, destination_number TEXT, phone_number_id TEXT, call_started_at_utc TEXT, direction TEXT, jobber_request_id TEXT, jobber_client_id TEXT); CREATE TABLE angi_router_jobber_auth(account_key TEXT,access_token TEXT,access_expires_at INTEGER,refresh_token TEXT,refresh_revision INTEGER,refresh_status TEXT,refresh_lease_token TEXT,refresh_lease_expires_at INTEGER,last_error_code TEXT); CREATE TABLE closed_loop_lead_dispositions(market_key TEXT,request_id TEXT,disposition TEXT); CREATE TABLE closed_loop_stage1_objects(market_key TEXT,object_type TEXT,object_id TEXT,client_id TEXT,object_json TEXT)');
 sql.prepare('INSERT INTO angi_router_jobber_auth(account_key,access_token,access_expires_at,refresh_status) VALUES(?,?,?,?)').run('utah','local-test',9999999999999,'ready');
 sql.prepare('INSERT INTO quo_call_attributions VALUES(?,?,?,?,?,?,?,?)').run(f.quo.quo_call_id,f.quo.caller_phone,f.quo.destination_number,f.quo.phone_number_id,f.quo.call_started_at_utc,'incoming','200','100');
 const i=f.intakeOperations[0],source={type:'call',id:i.quo_call_id,occurred_at:i.source_at,from:i.source_phone,to:i.destination_number,direction:'incoming'};
 sql.prepare('INSERT INTO quo_intake_operations(operation_id,operation_kind,account_id,market,phone,phone_number_id,intent_sha256,source_json,operation_state,classification,client_id,request_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(i.operation_id,'intake',i.account_id,i.market,i.phone,i.phone_number_id,'test',JSON.stringify(source),'completed',i.classification,'100','200',i.created_at,i.updated_at);
 const db={sqlite:sql,async batch(statements){return Promise.all(statements.map(s=>s.run()));},prepare(query){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:sql.prepare(query).all(...args)};},async first(){return sql.prepare(query).get(...args)||null;},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}};}};
 const env={ANGI_ROUTER_DB:db,QUALIFIED_PHONE_UPLOAD_ENABLED:'true',QUALIFIED_PHONE_PLACEHOLDER_ALIAS_ENABLED:'true',QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED:'true',PHONE_LEAD_WATCH_ENABLED:'false',QUO_API_KEY:'local-test',GOOGLE_ADS_OAUTH_REFRESH_TOKEN:'local-test',GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID:'local-test',GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET:'local-test'};
 if(options.archived){f.clients[0].isArchived=true;f.objects[0].object.requestStatus='archived';}
 if(options.noMilestone)f.objects[1].object.assessment=null;
 if(options.twoNamed)f.clients[0].name='Second Person';
 if(options.conflict)f.clients[0].emails=[{address:'different@example.test'}];
 if(options.earlier)f.clients[1].createdAt='2026-09-30T12:00:00Z';
 if(options.noIntake)sql.exec('DELETE FROM quo_intake_operations');
 if(options.aliasOff)env[PHONE_ALIAS_FLAG]='false';
 if(options.scopeOff)env.QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED='false';
 const requests=[],bodies=[];
 const fetcher=async(url,init)=>{
  requests.push({url,query:url.includes('getjobber.com')?JSON.parse(init.body).query:null});
  if(url.includes('oauth2'))return Response.json({access_token:'local-test'});
  if(url.includes('searchStream'))return Response.json([{results:[{campaign:{id:'123',name:'Search | UT | Attic'},callView:{resourceName:f.call.google_resource,startCallDateTime:'2026-10-01 06:00:00',callerAreaCode:'801',callDurationSeconds:'20',callStatus:'RECEIVED'}}]}]);
  if(url.includes('getjobber.com')){
   const {query,variables}=JSON.parse(init.body);assert.match(query,/^query/);assert(!query.includes('mutation'));
   if(query.includes('query Alias')) {
    assert.equal(init.redirect,'manual');
    if(options.aliasResponse)return options.aliasResponse();
   }
   const c=f.clients.find(c=>c.id===variables.id),conn=nodes=>({nodes,pageInfo:{hasNextPage:false}});
   if(query.includes('AliasClients'))return Response.json({data:{account:{id:account},clients:conn(f.clients)}});
   if(query.includes('AliasIdentity'))return Response.json({data:{account:{id:account},client:{id:c.id,billingAddress:null,clientProperties:conn([]),invoices:conn([])}}});
   if(query.includes('AliasHistory'))return Response.json({data:{account:{id:account},client:{...c,requests:conn(f.objects.filter(o=>o.object_type==='request'&&o.client_id===c.id).map(o=>o.object)),quotes:conn(options.work&&c.id==='101'?[{id:'400',createdAt:'2026-10-02T12:00:00Z'}]:[]),jobs:conn([])}}});
   if(query.includes('WorkCatalog'))return Response.json({data:{account:{id:account},client:{id:'101',quotes:conn(options.work?[{id:'400',createdAt:'2026-10-02T12:00:00Z'}]:[]),jobs:conn([])}}});
   if(query.includes('WorkScope'))return Response.json({data:{account:{id:account},quote:{id:'400',client:{id:'101'},title:'Attic restoration',lineItems:conn([{id:'i1',name:'Attic insulation',quantity:1}])}}});
   assert(query.includes('PhoneProof'));const row=f.objects.find(o=>o.object_type==='request'&&o.object_id===variables.id),client=f.clients.find(c=>c.id===row.client_id);
   return Response.json({data:{account:{id:account},request:{...row.object,title:options.offScope?'Spray foam shed':'Attic insulation',client:{...client,jobs:conn([])}}}});
  }
  if(url.includes('/v1/calls'))return Response.json({data:[{id:'ACcallback',createdAt:'2026-10-01T12:10:00Z',answeredAt:'2026-10-01T12:10:03Z',phoneNumberId:'PNalias',participants:[f.quo.caller_phone,f.quo.destination_number],direction:'outgoing',status:'completed',duration:options.shortCallback?30:120,aiHandled:null}]});
  if(url.includes('/call-transcripts/'))return Response.json({data:{callId:url.split('/').pop(),status:'completed',dialogue:[{identifier:f.quo.caller_phone,content:'Please send an estimate.'},{identifier:f.quo.destination_number,userId:'USagent',content:'We can help.'}]}});
  if(url.includes('/call-summaries/'))return Response.json({data:{summary:[options.offScope?'Spray foam shed':'Attic insulation']}});
  assert(url.endsWith(':uploadCallConversions'),'Unexpected endpoint');bodies.push(JSON.parse(init.body));return Response.json({results:[{conversionAction:'customers/4800890529/conversionActions/7742989654'}]});
 };
 return {f,sql,env,fetcher,requests,bodies};
}
const run=t=>phoneCycle(t.env,{fetcher:t.fetcher,scheduledTime:Date.parse('2026-10-13T21:00:00Z')});
test('live alias resolves active and archived shells equally, retaining original ledger lineage',async()=>{
 const outcomes=[];
 for(const archived of [false,true]){
  const t=setup({archived});assert.equal((await run(t)).completed,true);assert.equal(t.bodies.length,1);
  const row=t.sql.prepare('SELECT outcome_id,jobber_client_id,jobber_request_id,upload_state FROM google_ads_outcome_outbox').get();assert.equal(row.jobber_client_id,'100');assert.equal(row.jobber_request_id,'200');assert.equal(row.upload_state,'accepted');outcomes.push({...row});
  const alias=t.sql.prepare('SELECT * FROM qualified_phone_alias_resolutions').get();assert.equal(alias.status,'resolved');assert.equal(alias.operational_client_id,'101');assert.equal(alias.operational_request_id,'201');assert.equal(alias.original_request_id,'200');
  assert.equal(t.sql.prepare('SELECT jobber_client_id FROM quo_call_attributions').get().jobber_client_id,'100');
  await phoneCycle(t.env,{fetcher:t.fetcher,scheduledTime:Date.parse('2026-10-14T00:00:00Z')});assert.equal(t.bodies.length,1);assert.deepEqual({...t.sql.prepare('SELECT outcome_id,jobber_client_id,jobber_request_id,upload_state FROM google_ads_outcome_outbox').get()},outcomes.at(-1));
 }
 assert.deepEqual(outcomes[0],outcomes[1]);
});
test('live alias flag is independent of watch and scope; off restores the original archived-source hold',async()=>{
 const off=setup({archived:true,aliasOff:true});await run(off);assert.equal(off.bodies.length,0);assert(!off.requests.some(r=>r.query?.includes('Alias')));assert.equal(off.sql.prepare('SELECT COUNT(*) n FROM qualified_phone_alias_resolutions').get().n,0);
 for(const watch of ['false','true']){const t=setup({archived:true,scopeOff:true});t.sql.exec('DROP TABLE qualified_phone_scope_work');t.env.PHONE_LEAD_WATCH_ENABLED=watch;await run(t);assert.equal(t.bodies.length,1);assert(!t.requests.some(r=>r.query?.includes('WorkScope')));}
});
test('live alias holds two named clients, missing proof, identity conflict and earlier history before any upload candidate',async()=>{
 for(const [options,reason] of [[{twoNamed:true},'multiple_jobber_clients'],[{noIntake:true},'alias_intake_proof_missing'],[{conflict:true},'alias_identity_conflict'],[{earlier:true},'alias_earlier_history']]){
  const t=setup(options);await run(t);assert.equal(t.bodies.length,0);assert.equal(t.sql.prepare('SELECT diagnostic_code FROM qualified_phone_calls').get().diagnostic_code,reason);assert.equal(t.sql.prepare('SELECT COUNT(*) n FROM google_ads_outcome_outbox').get().n,0);
 }
});
test('aliasing does not weaken scope or the two-way 60-second qualification requirement',async()=>{
 for(const [options,want] of [[{archived:true,noMilestone:true},1],[{archived:true,noMilestone:true,shortCallback:true},0],[{archived:true,offScope:true},0],[{archived:true,offScope:true,work:true},1],[{archived:true,offScope:true,scopeOff:true},1]]){
  const t=setup(options);await run(t);assert.equal(t.bodies.length,want,JSON.stringify(options));
 }
});
test('enabled alias flag rejects stale proof on ready rows and keeps canonical delivery fencing',async()=>{
 const t=setup();await run(t);t.sql.exec("UPDATE qualified_phone_calls SET state='ready'");
 const proof={ok:true,google_resource:t.f.call.google_resource,jobber_request_id:'200',caller_phone:t.f.quo.caller_phone,evidence:'assessment_scheduled',verified_at:Date.now(),service_scope:{policy:'attic_scope_v2',state:'in_scope'}};
 const r=await submitPhone(t.env,'local-test',t.f.call.google_resource,t.fetcher,proof);assert.equal(r.code,'alias_proof_missing');assert.equal(t.bodies.length,1);
 assert.equal(PLACEHOLDER_ALIAS_POLICY,'quo_placeholder_alias_v1');
});
test('missing alias migration fails closed and does not change Jobber or create a conversion row',async()=>{
 const t=setup({archived:true});t.sql.exec('DROP TABLE qualified_phone_alias_resolutions');await run(t);assert.equal(t.bodies.length,0);assert.equal(t.sql.prepare('SELECT diagnostic_code FROM qualified_phone_calls').get().diagnostic_code,'alias_read_unavailable');
 assert.equal(t.sql.prepare('SELECT COUNT(*) n FROM google_ads_outcome_outbox').get().n,0);
});
test('previous original source IDs cannot be replaced by a later alias lookup',async()=>{
 const t=setup({offScope:true});await run(t);assert.equal(t.bodies.length,0);
 t.sql.prepare('UPDATE qualified_phone_alias_resolutions SET original_client_id=?').run('different');
 await phoneCycle(t.env,{fetcher:t.fetcher,scheduledTime:Date.parse('2026-10-14T00:00:00Z')});
 assert.equal(t.sql.prepare('SELECT diagnostic_code FROM qualified_phone_calls').get().diagnostic_code,'alias_original_lineage_changed');assert.equal(t.bodies.length,0);
 assert.equal(t.sql.prepare('SELECT original_client_id FROM qualified_phone_alias_resolutions').get().original_client_id,'different');
});
test('manual redirect fence rejects every redirect without following or uploading',async()=>{
 for(const status of [301,302,303,307,308]){
  const t=setup({aliasResponse:()=>new Response(null,{status,headers:{Location:'https://example.test/private'}})});
  await run(t);assert.equal(t.bodies.length,0);
  const row=t.sql.prepare('SELECT state,response_json FROM qualified_phone_calls').get(),d=JSON.parse(row.response_json).alias_failure;
  assert.equal(row.state,'held');assert.equal(d.error_message,'alias_external_redirect_blocked');assert.equal(d.http_status,status);assert.equal(d.step,'jobber_candidates');assert.equal(d.api,'jobber');assert(Date.parse(d.completed_at)>0);assert(!row.response_json.includes('example.test'));
 }
});
test('HTTP, GraphQL, invalid JSON and transport failures keep safe details and stay held',async()=>{
 const cases=[
  [()=>Response.json({errors:[{message:'private detail'}]},{status:401}),401,'alias_jobber_read_failed','Error'],
  [()=>Response.json({errors:[{message:'private detail'}]}),200,'alias_jobber_read_failed','Error'],
  [()=>new Response('private body'),200,'Unrecognized error message withheld (customer-data protection)','SyntaxError'],
  [()=>{throw new TypeError('secret customer text');},null,'Unrecognized error message withheld (customer-data protection)','TypeError'],
 ];
 for(const [aliasResponse,status,message,kind] of cases){
  const t=setup({aliasResponse});await run(t);assert.equal(t.bodies.length,0);
  const raw=t.sql.prepare('SELECT response_json FROM qualified_phone_calls').get().response_json,d=JSON.parse(raw).alias_failure;
  assert.equal(d.http_status,status);assert.equal(d.error_message,message);assert.equal(d.error_class,kind);assert(!/secret|private detail|private body/.test(raw));
 }
});
test('D1 failure records the table without leaking SQL and can recover next cycle',async()=>{
 const t=setup();t.sql.exec('ALTER TABLE qualified_phone_alias_resolutions RENAME TO saved_alias');await run(t);
 const d=JSON.parse(t.sql.prepare('SELECT response_json FROM qualified_phone_calls').get().response_json).alias_failure;
 assert.equal(d.api,'d1');assert.equal(d.table,'qualified_phone_alias_resolutions');assert.equal(d.step,'persist_resolution');assert.equal(d.http_status,null);assert.equal(t.bodies.length,0);
 t.sql.exec('ALTER TABLE saved_alias RENAME TO qualified_phone_alias_resolutions');await phoneCycle(t.env,{fetcher:t.fetcher,scheduledTime:Date.parse('2026-10-14T00:00:00Z')});assert.equal(t.bodies.length,1);
});
