import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {verifyQualifiedPhoneScope,phoneScopeDecision} from '../server/qualified-phone-service-scope.js';
import {serviceScopeFromText,scopeForPerson} from '../server/lead-service-scope.js';
import {readWorkScope} from '../server/service-scope-reader.js';
function setup({inquiry='Spray foam shed',work=[],wrongAccount=false,wrongClient=false}={}) {
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0031_qualified_phone_scope.sql',import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};}};
 const calls=[],state={work};
 const fetcher=async(url,opt={})=>{
  calls.push({url,method:opt.method||'GET'});
  if(url.includes('api.quo.com/')){assert.equal(opt.method,undefined);return Response.json({data:url.includes('summaries')?{summary:[inquiry]}:{dialogue:[]}});}
  assert.equal(url,'https://api.getjobber.com/api/graphql');
  const {query,variables}=JSON.parse(opt.body);assert.match(query,/^query /);assert.doesNotMatch(query,/mutation/);
  const account={id:wrongAccount?'1919824':'2498432'};
  if(query.includes('WorkCatalog'))return Response.json({data:{account,client:{id:'client',quotes:{nodes:state.work.map((x,i)=>({id:'q'+i,createdAt:'2026-10-02T12:00:00Z'})),pageInfo:{hasNextPage:false}},jobs:{nodes:[],pageInfo:{hasNextPage:false}}}}});
  const value=state.work[Number(variables.id.slice(1))];
  return Response.json({data:{account,quote:{id:variables.id,client:{id:wrongClient?'another':'client'},title:'',lineItems:{nodes:[{id:'item',name:value,description:'',quantity:1}],pageInfo:{hasNextPage:false}}}}});
 };
 return {sqlite,calls,state,env:{ANGI_ROUTER_DB:db,QUO_API_KEY:'test',QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED:'true'},args:{call:{market_key:'ut'},quo:{quo_call_id:'ACtest',caller_phone:'+18015550101'},clientId:'client',evidence:'quote',accessToken:'test',fetcher}};
}
test('scope flag defaults off without reads or writes',async()=>{assert.deepEqual(await verifyQualifiedPhoneScope({},{}),{ok:true,disabled:true});});
test('off-scope inquiry is excluded unless same-client same-market quoted work proves attic scope',async()=>{
 for(const work of [[],['Basement walls only'],['Attic fan only']]) {const t=setup({work});const r=await verifyQualifiedPhoneScope(t.env,t.args);assert.equal(r.ok,false);assert.equal(r.reason,'scope_off_scope_only');}
 const t=setup({work:['Complete attic restoration, R49 cellulose, attic fan add-on']});
 const r=await verifyQualifiedPhoneScope(t.env,t.args);assert.equal(r.ok,true);assert.equal(r.scope.state,'in_scope');
 assert.equal(t.calls.some(x=>/upload|ingest/.test(x.url)),false);assert.equal(t.sqlite.prepare('SELECT count(*) n FROM qualified_phone_scope_work').get().n,1);
});
test('positive quote history survives deletion with no inquiry text persisted',async()=>{
 const marker='private inquiry words';const t=setup({inquiry:'Spray foam shed '+marker,work:['Attic restoration']});
 assert.equal((await verifyQualifiedPhoneScope(t.env,t.args)).ok,true);t.state.work=[];
 assert.equal((await verifyQualifiedPhoneScope(t.env,t.args)).ok,true);
 const stored=t.sqlite.prepare('SELECT scope_json FROM qualified_phone_scope_work').get().scope_json;assert.ok(!stored.includes(marker));assert.ok(!stored.includes('Attic restoration'));
});
test('unknown is held only without usable inquiry and without any work record',async()=>{
 const t=setup({inquiry:'',work:[]});assert.equal((await verifyQualifiedPhoneScope(t.env,t.args)).reason,'scope_evidence_missing');
 t.state.work=['Estimate'];const r=await verifyQualifiedPhoneScope(t.env,t.args);assert.equal(r.ok,true);assert.equal(r.scope.state,'not_excluded');assert.equal(r.scope.in_scope_evidence,false);
});
test('cross-account and cross-client work cannot establish scope',async()=>{
 for(const opts of [{wrongAccount:true},{wrongClient:true}]){const t=setup({...opts,work:['Attic insulation']});const r=await verifyQualifiedPhoneScope(t.env,t.args);assert.equal(r.reason,'scope_read_unavailable');assert.equal(r.reader_failure.api,'jobber');}
});
test('scope readers reject redirects at every endpoint and record safe failures',async()=>{
 for(const endpoint of ['summaries','transcripts','getjobber'])for(const status of [301,302,303,307,308,401,503]){
  const t=setup({inquiry:'Attic insulation'}),base=t.args.fetcher;let blocked=0;
  t.args.fetcher=async(url,init)=>{assert.equal(init.redirect,'manual');if(url.includes(endpoint)){blocked++;return Response.json({}, {status});}return base(url,init);};
  const r=await verifyQualifiedPhoneScope(t.env,t.args);assert.equal(r.reason,'scope_read_unavailable');assert.equal(r.reader_failure.http_status,status);assert.equal(blocked,1);assert.equal(t.sqlite.prepare('SELECT COUNT(*) n FROM qualified_phone_scope_work').get().n,0);
 }
 const t=setup();t.args.fetcher=async()=>{throw new TypeError('PRIVATE_CUSTOMER_TEXT');};let r=await verifyQualifiedPhoneScope(t.env,t.args);assert.equal(r.reader_failure.error_class,'TypeError');assert(!JSON.stringify(r).includes('PRIVATE_CUSTOMER_TEXT'));
 const d=setup();d.env.ANGI_ROUTER_DB={prepare(){throw Error('PRIVATE_SQL');}};r=await verifyQualifiedPhoneScope(d.env,d.args);assert.equal(r.reader_failure.table,'qualified_phone_scope_work');assert.equal(r.reader_failure.step,'scope_read_history');assert(!JSON.stringify(r).includes('PRIVATE_SQL'));
});
test('line-item pagination reaches later attic work and rejects repeated cursors',async()=>{
 let calls=0;const gql=async(_m,_q,{after})=>{calls++;return {account:{id:'2498432'},quote:{id:'q',client:{id:'c'},title:'',lineItems:{nodes:[{id:after?'second':'first',name:after?'Attic restoration':'Attic fan',quantity:1}],pageInfo:{hasNextPage:!after,endCursor:'next'}}}};};
 const scope=await readWorkScope({gql,market:'ut',accountId:'2498432',clientId:'c',type:'quote',id:'q'});assert.equal(scope.in_scope_evidence,true);assert.equal(calls,2);
 const repeat=async()=>({account:{id:'2498432'},quote:{id:'q',client:{id:'c'},lineItems:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}});
 await assert.rejects(readWorkScope({gql:repeat,market:'ut',accountId:'2498432',clientId:'c',type:'quote',id:'q'}),/cursor/);
});
test('all in-scope services and add-ons share one policy; negated foam plus basement walls is not attic work',()=>{
 for(const text of ['Attic insulation and attic fan','Insulation removal','Insulation replacement','Attic restoration','Attic sanitation','Air sealing','Baffles','Attic restoration with rodent exclusion'])assert.equal(phoneScopeDecision(serviceScopeFromText(text)).ok,true,text);
 for(const text of ['Spray foam','Attic fan only','Ventilation only','Mold only','Mould only','Wall insulation'])assert.equal(phoneScopeDecision(serviceScopeFromText(text)).reason,'scope_off_scope_only',text);
 const x=scopeForPerson(serviceScopeFromText("It's not spray foam. Need a bid for the basement wall."),[serviceScopeFromText('Basement exclusion with rim joist sealing',null,{record:true})]);assert.equal(x.state,'off_scope_only');assert.deepEqual(x.off_scope_services,['wall_insulation']);
});
