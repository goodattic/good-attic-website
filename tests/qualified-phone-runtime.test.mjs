import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {phoneCycle,phoneHealth,submitPhone,uploadBody,denverTime,fromDenver,classifyResponse} from '../server/qualified-phone-runtime.js';
function db(){const sqlite=new DatabaseSync(':memory:');for(const f of ['0009_google_ads_outcome_outbox','0011_stage1_outbox','0016_qualified_phone_calls'])sqlite.exec(readFileSync(new URL('../migrations/'+f+'.sql',import.meta.url),'utf8'));sqlite.exec('CREATE TABLE quo_call_attributions (quo_call_id TEXT, caller_phone TEXT, destination_number TEXT, phone_number_id TEXT, call_started_at_utc TEXT, direction TEXT, jobber_request_id TEXT, jobber_client_id TEXT)');sqlite.exec('CREATE TABLE angi_router_jobber_auth (account_key TEXT, access_token TEXT, access_expires_at INTEGER, refresh_token TEXT, refresh_revision INTEGER, refresh_status TEXT, refresh_lease_token TEXT, refresh_lease_expires_at INTEGER, last_error_code TEXT)');sqlite.exec('CREATE TABLE closed_loop_lead_dispositions (market_key TEXT, request_id TEXT, disposition TEXT)');sqlite.prepare('INSERT INTO angi_router_jobber_auth(account_key,access_token,access_expires_at,refresh_status) VALUES(?,?,?,?)').run('utah','jobber-test-token',9999999999999,'ready');return {sqlite,async batch(s){return Promise.all(s.map(x=>x.run()))},prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}}}};}
const call={campaign:{id:'123',name:'Search | UT | Attic'},callView:{resourceName:'customers/4800890529/callViews/123',startCallDateTime:'2026-09-25 08:30:19',callerAreaCode:'801',callDurationSeconds:'20',callStatus:'RECEIVED'}};
const proof={ok:true,record:{created_at:'2026-09-25T14:30:57Z',jobber_request_id:'req1',jobber_client_id:'client1'},evidence:'assessment_completed'};
function setup(){const database=db();database.sqlite.prepare('INSERT INTO quo_call_attributions VALUES(?,?,?,?,?,?,?,?)').run('quo1','+18015558808','+13853364442','PNqw8amabk','2026-09-25T14:30:19Z','incoming','req1','client1');return {ANGI_ROUTER_DB:database,QUALIFIED_PHONE_UPLOAD_ENABLED:'true',GOOGLE_ADS_OAUTH_REFRESH_TOKEN:'ads-token',GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID:'client',GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET:'secret'};}
function transport(calls=[call],response={results:[{conversionAction:'customers/4800890529/conversionActions/7742989654'}]}){const requests=[];return {requests,fetcher:async(url,init)=>{requests.push({url,init});if(url.includes('oauth2')){assert.equal(init.body.get('refresh_token'),'ads-token');return Response.json({access_token:'access'})}assert.equal(init.headers['developer-token'],undefined);assert.equal(init.headers['login-customer-id'],undefined);if(url.includes('searchStream'))return Response.json([{results:calls}]);assert.ok(url.endsWith(':uploadCallConversions'));const body=JSON.parse(init.body);assert.equal(body.partialFailure,true);assert.equal(body.conversions[0].conversionAction,'customers/4800890529/conversionActions/7742989654');return Response.json(response)}};}
test('Denver summer/winter and conversion floor preserve seconds',()=>{assert.equal(fromDenver('2026-09-25 08:30:19'),'2026-09-25 08:30:19-06:00');assert.equal(fromDenver('2026-01-25 08:30:19'),'2026-01-25 08:30:19-07:00');assert.equal(denverTime('2026-09-25T14:30:19.430Z'),'2026-09-25 08:30:19-06:00');assert.equal(uploadBody({caller_phone:'+18015558808',call_started_at_original:'2026-09-25T14:30:19Z',conversion_at:'2026-09-25T14:00:00Z'}).conversions[0].conversionDateTime,'2026-09-25 08:31:19-06:00')});
test('partial failures are not success; only too-recent may retry',()=>{const fail=code=>({partialFailureError:{details:[{errors:[{errorCode:{conversionUploadError:code}}]}]}});assert.equal(classifyResponse(200,fail('UNPARSEABLE_CALLERS_PHONE_NUMBER')).state,'failed');assert.equal(classifyResponse(200,fail('TOO_RECENT_CALL')).state,'retryable');assert.equal(classifyResponse(200,fail('CALL_CONVERSION_ALREADY_EXISTS')).state,'uploaded');assert.equal(classifyResponse(200,{}).state,'failed');assert.equal(classifyResponse(503,{}).state,'failed')});
test('phone flag defaults off without any DB or network access',async()=>{assert.deepEqual(await phoneCycle({}),{disabled:true})});
test('safe reader failures are persisted on held rows without an outbox or upload',async()=>{
 for(const reason of ['quo_read_unavailable','quo_transcript_unavailable','scope_read_unavailable']){
  const env=setup(),t=transport(),failure={step:'quo_calls',api:'quo',http_status:401,completed_at:new Date().toISOString()};
  await phoneCycle(env,{scheduledTime:1,fetcher:t.fetcher,verify:async()=>({ok:false,reason,reader_failure:failure})});
  const row=env.ANGI_ROUTER_DB.sqlite.prepare('SELECT state,response_json FROM qualified_phone_calls').get();assert.equal(row.state,'held');assert.deepEqual(JSON.parse(row.response_json),{reader_failure:failure});assert.equal(env.ANGI_ROUTER_DB.sqlite.prepare('SELECT count(*) n FROM google_ads_outcome_outbox').get().n,0);assert(!t.requests.some(x=>x.url.includes('uploadCall')));
 }
});
test('real cycle persists, uploads once across repeated delivery and three-hour restarts',async()=>{const env=setup(),t=transport(),options={fetcher:t.fetcher,verify:async()=>proof,scheduledTime:Date.parse('2026-09-29T21:00:00Z')};assert.equal((await phoneCycle(env,options)).completed,true);assert.equal((await phoneCycle(env,options)).skipped,true);await phoneCycle(env,{...options,scheduledTime:options.scheduledTime+10800000});assert.equal(t.requests.filter(r=>r.url.includes('uploadCall')).length,1);const h=await phoneHealth(env);assert.equal(h.uploaded,1);assert.equal(h.candidates,1);assert.equal(h.last_run.status,'completed');const response=env.ANGI_ROUTER_DB.sqlite.prepare('SELECT response_json FROM qualified_phone_calls').get().response_json;assert.ok(!response.includes('8808'))});
test('unknown delivery is permanently fenced; another scheduled run cannot retransmit',async()=>{const env=setup(),t=transport();const fetcher=async(u,i)=>{if(u.includes('uploadCall'))throw Error('network');return t.fetcher(u,i)};await phoneCycle(env,{fetcher,verify:async()=>proof,scheduledTime:1});const qualification={ok:true,google_resource:call.callView.resourceName,jobber_request_id:'req1',caller_phone:'+18015558808',evidence:'assessment_completed',verified_at:Date.now()};const x=await submitPhone(env,'access',call.callView.resourceName,t.fetcher,qualification);assert.equal(x.code,'duplicate_prevented');assert.equal((await phoneHealth(env)).failed,1)});
test('failed qualification holds; a persisted old-rule ready row cannot bypass proof',async()=>{const env=setup(),t=transport();await phoneCycle(env,{fetcher:t.fetcher,verify:async()=>({ok:false,reason:'no_two_way_quo_conversation'}),scheduledTime:1});assert.equal(t.requests.filter(r=>r.url.includes('uploadCall')).length,0);assert.equal(env.ANGI_ROUTER_DB.sqlite.prepare('SELECT state FROM qualified_phone_calls').get().state,'held');const prior=setup(),priorTransport=transport();await phoneCycle(prior,{fetcher:priorTransport.fetcher,verify:async()=>proof,scheduledTime:1});prior.ANGI_ROUTER_DB.sqlite.prepare("UPDATE qualified_phone_calls SET state='ready'").run();const result=await submitPhone(prior,'access',call.callView.resourceName,priorTransport.fetcher);assert.equal(result.code,'qualification_proof_missing');assert.equal(prior.ANGI_ROUTER_DB.sqlite.prepare('SELECT state FROM qualified_phone_calls').get().state,'held');assert.equal(priorTransport.requests.filter(r=>r.url.includes('uploadCall')).length,1)});
test('full cycle uploads for a Jobber milestone or two-way callback, and holds both short wrong-number shapes',async()=>{
 const account='Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==';
 for(const scenario of ['assessment','callback','wrong_number_27','wrong_number_17','archived']){
  const env=setup(),requests=[];
  env.QUO_API_KEY='quo-test-key';
  const fetcher=async(url,init)=>{
   requests.push(url);
   if(url.includes('oauth2'))return Response.json({access_token:'ads-access'});
   if(url.includes('searchStream'))return Response.json([{results:[call]}]);
   if(url.includes('getjobber.com')){
    const body=JSON.parse(init.body);assert.equal(body.variables.id,'req1');
    return Response.json({data:{account:{id:account},request:{id:'req1',createdAt:'2026-09-25T14:30:57Z',requestStatus:'converted',assessment:scenario==='assessment'||scenario==='archived'?{id:'a1',startAt:'2026-09-26T15:00:00Z',isComplete:true,completedAt:'2026-09-26T16:00:00Z'}:null,quotes:scenario==='callback'?null:{nodes:[]},client:{id:'client1',isArchived:scenario==='archived',phones:[{number:'+18015558808'}],jobs:{nodes:[],pageInfo:{hasNextPage:false}}}}}});
   }
   if(url.includes('/call-transcripts/'))return Response.json({data:{callId:'ACcallback',status:'completed',dialogue:[{identifier:'+18015558808',userId:null,content:'Can you help?'},{identifier:'+13853364442',userId:'USagent',content:'Yes'}]}});
   if(url.includes('api.quo.com/v1/calls'))return Response.json({data:[{id:scenario.startsWith('wrong_number')?'ACshort':'ACcallback',createdAt:'2026-09-25T15:00:00Z',phoneNumberId:'PNqw8amabk',participants:['+13853364442','+18015558808'],direction:'outgoing',status:'completed',answeredAt:'2026-09-25T15:00:03Z',duration:scenario==='wrong_number_27'?27:scenario==='wrong_number_17'?17:120,aiHandled:null}]});
   assert.ok(url.includes('uploadCallConversions'));
   return Response.json({results:[{conversionAction:'customers/4800890529/conversionActions/7742989654'}]});
  };
  await phoneCycle(env,{fetcher,scheduledTime:1});
  const state=env.ANGI_ROUTER_DB.sqlite.prepare('SELECT state,diagnostic_code FROM qualified_phone_calls').get();
  assert.equal(state.state,['assessment','callback'].includes(scenario)?'uploaded':'held',`${scenario}: ${JSON.stringify(state)}`);
  assert.equal(requests.filter(url=>url.includes('uploadCallConversions')).length,['assessment','callback'].includes(scenario)?1:0,scenario);
 }
});
test('missing STL area, >=60 seconds and wrong-market calls cannot upload',async()=>{const env=setup();const t=transport([{...call,campaign:{id:'stl',name:'Search | MO-STL | Attic'},callView:{...call.callView,callerAreaCode:undefined,callStatus:'MISSED',callDurationSeconds:undefined}},{...call,callView:{...call.callView,resourceName:'second',callDurationSeconds:'60'}}]);await phoneCycle(env,{fetcher:t.fetcher,verify:async()=>{throw Error('must not read Jobber')},scheduledTime:1});assert.equal(t.requests.filter(r=>r.url.includes('uploadCall')).length,0);const h=await phoneHealth(env);assert.equal(h.held,1);assert.equal(h.excluded,1)});
test('two Quo calls from the same caller inside the Google match window cannot upload',async()=>{const env=setup(),t=transport();env.ANGI_ROUTER_DB.sqlite.prepare('INSERT INTO quo_call_attributions VALUES(?,?,?,?,?,?,?,?)').run('quo2','+18015558808','+13853364442','PNqw8amabk','2026-09-25T14:30:40Z','incoming','req2','client1');await phoneCycle(env,{fetcher:t.fetcher,verify:async()=>{throw Error('ambiguous call must not read Jobber')},scheduledTime:Date.parse('2026-09-29T21:00:00Z')});assert.equal(t.requests.filter(r=>r.url.includes('uploadCall')).length,0);assert.deepEqual({...env.ANGI_ROUTER_DB.sqlite.prepare('SELECT state,diagnostic_code FROM qualified_phone_calls').get()},{state:'held',diagnostic_code:'multiple_quo_calls_same_caller'});assert.equal(env.ANGI_ROUTER_DB.sqlite.prepare('SELECT COUNT(*) AS n FROM google_ads_outcome_outbox').get().n,0)});
test('migration is kept out of initialize and existing initializer remains exact',()=>{const s=readFileSync(new URL('../workers/stage1-shadow.js',import.meta.url),'utf8');assert.ok(!s.includes('0016'));assert.ok(!s.includes('qualifiedPhoneMigration'))});
test('live scope flag is independent of watch mode; real cycle enforces scope before creating an upload candidate',async()=>{
 for(const scenario of [{enabled:true,inquiry:'Spray foam shed',work:false,want:0},
  {enabled:true,inquiry:'Spray foam shed',work:true,want:1},
  {enabled:true,inquiry:'Attic insulation and attic fan',work:false,want:1},
  {enabled:false,inquiry:'Spray foam shed',work:false,want:1}]) {
  const env=setup();env.QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED=String(scenario.enabled);env.PHONE_LEAD_WATCH_ENABLED='true';env.QUO_API_KEY='test';
  env.ANGI_ROUTER_DB.sqlite.exec(readFileSync(new URL('../migrations/0031_qualified_phone_scope.sql',import.meta.url),'utf8'));
  env.ANGI_ROUTER_DB.sqlite.exec("UPDATE quo_call_attributions SET quo_call_id='ACscope'");
  const calls=[];
  const fetcher=async(url,init)=>{
   calls.push(url);
   if(url.includes('oauth2'))return Response.json({access_token:'test'});
   if(url.includes('searchStream'))return Response.json([{results:[call]}]);
   if(url.includes('getjobber.com')) {
    const {query}=JSON.parse(init.body),account={id:'Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg=='};
    if(query.includes('WorkCatalog'))return Response.json({data:{account,client:{id:'client1',quotes:{nodes:scenario.work?[{id:'quote1',createdAt:'2026-09-26T12:00:00Z'}]:[],pageInfo:{hasNextPage:false}},jobs:{nodes:[],pageInfo:{hasNextPage:false}}}}});
    if(query.includes('WorkScope'))return Response.json({data:{account,quote:{id:'quote1',client:{id:'client1'},lineItems:{nodes:[{id:'i',name:'Attic restoration',quantity:1}],pageInfo:{hasNextPage:false}}}}});
    return Response.json({data:{account,request:{id:'req1',createdAt:'2026-09-25T14:30:57Z',requestStatus:'converted',assessment:{id:'a',startAt:'2026-09-26T12:00:00Z'},quotes:{nodes:[]},client:{id:'client1',isArchived:false,phones:[{number:'+18015558808'}],jobs:{nodes:[],pageInfo:{hasNextPage:false}}}}}});
   }
   if(url.includes('api.quo.com'))return Response.json({data:url.includes('summaries')?{summary:[scenario.inquiry]}:{dialogue:[]}});
   assert.ok(url.endsWith('uploadCallConversions'));return Response.json({results:[{conversionAction:'customers/4800890529/conversionActions/7742989654'}]});
  };
  assert.equal((await phoneCycle(env,{scheduledTime:1,fetcher})).completed,true);
  assert.equal(calls.filter(u=>u.includes('uploadCallConversions')).length,scenario.want);
  assert.equal(env.ANGI_ROUTER_DB.sqlite.prepare('SELECT count(*) n FROM google_ads_outcome_outbox').get().n,scenario.want);
  if(!scenario.enabled)assert.equal(calls.filter(u=>u.includes('api.quo.com')).length,0);
 }
});
test('a fresh old-rule proof cannot bypass the enabled scope screen on a persisted ready row',async()=>{
 const env=setup(),t=transport();await phoneCycle(env,{scheduledTime:1,fetcher:t.fetcher,verify:async()=>proof});
 env.ANGI_ROUTER_DB.sqlite.exec("UPDATE qualified_phone_calls SET state='ready'");env.QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED='true';
 const result=await submitPhone(env,'test',call.callView.resourceName,t.fetcher,{ok:true,google_resource:call.callView.resourceName,jobber_request_id:'req1',caller_phone:'+18015558808',evidence:'assessment_completed',verified_at:Date.now()});
 assert.equal(result.code,'scope_proof_missing');assert.equal(t.requests.filter(r=>r.url.includes('uploadCall')).length,1);
});
