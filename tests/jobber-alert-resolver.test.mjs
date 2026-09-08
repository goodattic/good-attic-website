import test from 'node:test';
import assert from 'node:assert/strict';
import {handleJobberAlertResolve} from '../server/jobber-alert-resolver.js';
import {onRequestGet as callRoute} from '../functions/i/[token].js';
const secret='test-alert-broker-secret-with-enough-length';
const encode=(type,id)=>btoa(`gid://Jobber/${type}/${id}`);
const markets=[['utah','ut',2498432],['stl','mo_stl',2498453],['kc','mo_kc',1919824]];
function context(account,extras={}){return {request:new Request('https://site.test/api/jobber/alert-resolve',{method:'POST',headers:{authorization:`Bearer ${secret}`},body:JSON.stringify({account_id:encode('Account',account),request_id:encode('Request',10),...extras})}),env:{CONTACT_SYNC_BROKER_SECRET:secret,ANGI_ROUTER_DB:{prepare(){}}}};}
function provider(account,patch={}){return {data:{account:{id:encode('Account',account)},request:{id:encode('Request',10),createdAt:'2026-09-08T01:00:00Z',title:'Attic estimate',jobberWebUri:'https://secure.getjobber.com/work_requests/10',source:'api',phone:null,email:null,contactName:null,client:{id:encode('Client',20),name:'Test Person',phone:'2025550187',email:'test@example.invalid',leadSource:'Website'},property:{address:{street1:'1 Test St',city:'Test City',province:'MO',postalCode:'63000'}},...patch}}};}
test('all three alert reads use the existing exact account token owner and return authoritative request context',async()=>{
 for(const[market,key,id]of markets){let route;
 const res=await handleJobberAlertResolve(context(id),{refreshJobberAccessToken:async(_env,r)=>{route=r;return {accessToken:'unused'};},jobberGraphql:async(_env,_token,query)=>{assert.ok(query.startsWith('query '));assert.equal(query.includes('mutation'),false);return provider(id);}});
 assert.equal(res.status,200);const body=await res.json();assert.equal(body.market,market);assert.equal(route.marketKey,key);assert.equal(body.request.contactName,'Test Person');assert.equal(body.request.phone,'2025550187');assert.match(body.request.address,/Test City/);assert.equal(JSON.stringify(body).includes('unused'),false);
 }
});
test('unauthorized or arbitrary-query inputs never reach Jobber',async()=>{
 const deps={refreshJobberAccessToken:()=>{throw Error('must not run');}};
 const c=context(2498432);c.request.headers.delete('authorization');assert.equal((await handleJobberAlertResolve(c,deps)).status,401);
 assert.equal((await handleJobberAlertResolve(context(2498432,{query:'mutation Bad'}),deps)).status,400);
 assert.equal((await handleJobberAlertResolve(context(999),deps)).status,400);
});
test('wrong account/object, invalid record links and token errors fail without leaking provider details',async()=>{
 for(const[result,expected]of [[provider(2498453),409],[provider(2498432,{id:encode('Request',11)}),409],[provider(2498432,{jobberWebUri:'https://evil.test/10'}),502],[provider(2498432,{createdAt:null}),502]]){
 const r=await handleJobberAlertResolve(context(2498432),{refreshJobberAccessToken:async()=>({accessToken:'hidden'}),jobberGraphql:async()=>result});assert.equal(r.status,expected);
 }
 const r=await handleJobberAlertResolve(context(2498432),{refreshJobberAccessToken:async()=>{throw Error('SECRET token');}});assert.equal(r.status,503);assert.equal((await r.text()).includes('SECRET'),false);
});
test('call action route is GET-only, token-bounded and disabled in previews',async()=>{
 let target;const params={token:'a'.repeat(32)};
 assert.equal((await callRoute({params,env:{}})).status,404);
 const r=await callRoute({params,env:{EXTERNAL_API_WRITES_ENABLED:'true',CONTACT_SYNC_SERVICE:{fetch:async req=>{target=req.url;return new Response('safe page');}}}});assert.equal(r.status,200);assert.equal(target,`https://contact-sync/call/${params.token}`);
 assert.equal((await callRoute({params:{token:'../escape'},env:{EXTERNAL_API_WRITES_ENABLED:'true',CONTACT_SYNC_SERVICE:{}}})).status,404);
});
