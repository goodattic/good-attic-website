import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readOnlyTransport} from '../server/phone-lead-watch-runtime.js';
const require=createRequire(import.meta.url);
let modulePath=process.env.MINIFLARE_MODULE;
if(!modulePath){try{modulePath=require.resolve('miniflare');}catch{}}
test('actual workerd accepts the guarded OAuth request and blocks every redirect without following it', {skip:!modulePath},async()=>{
 const {Miniflare,convertV4MiniflareOptions}=require(modulePath);
 const options={modules:true,compatibilityDate:'2026-07-27',script:`
 const readOnlyTransport=${readOnlyTransport.toString()};
 export default {async fetch(){
  const results=[];
  for(const status of [200,301,302,303,307,308]){
   let requests=0,mode=null;
   try{
    const response=await readOnlyTransport(async(url,opts)=>{
     requests++;const request=new Request(url,opts);mode=request.redirect;
     return new Response('fixture',{status,headers:{location:'https://untrusted.invalid/upload'}});
    })('https://oauth2.googleapis.com/token',{method:'POST',redirect:'follow',body:new URLSearchParams({refresh_token:'fixture'})});
    results.push({status,requests,mode,ok:response.ok});
   }catch(e){results.push({status,requests,mode,error:e.message,httpStatus:e.watchHttpStatus});}
  }
  let originalError;
  try{new Request('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error'});}catch(e){originalError={name:e.name,message:e.message};}
  return Response.json({results,originalError});
 }};`};
 const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
 try{
  const body=await(await mf.dispatchFetch('http://localhost/')).json();
  assert.equal(body.originalError.name,'TypeError');assert.match(body.originalError.message,/Invalid redirect value/);
  assert.deepEqual(body.results[0],{status:200,requests:1,mode:'manual',ok:true});
  for(const r of body.results.slice(1)){assert.equal(r.requests,1);assert.equal(r.mode,'manual');assert.equal(r.error,'watch_external_redirect_blocked');assert.equal(r.httpStatus,r.status);}
 }finally{await mf.dispose();}
});
