import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),mfPath=process.env.MINIFLARE_MODULE;
test('actual Workers runtime accepts both readers manual mode and rejects redirect responses',{skip:!mfPath},async()=>{
 const {Miniflare,convertV4MiniflareOptions}=require(mfPath),esbuild=require(require.resolve('esbuild',{paths:[mfPath]}));
 const build=await esbuild.build({bundle:true,write:false,format:'esm',platform:'browser',stdin:{resolveDir:process.cwd(),contents:`
 import {quoConversationProof} from './server/qualified-phone-proof.js';
 import {verifyQualifiedPhoneScope} from './server/qualified-phone-service-scope.js';
 const db={prepare(){return{bind(){return this;},async all(){return{results:[]}},async run(){return{meta:{changes:0}}}}}};
 export default{async fetch(){const rows=[];for(const status of [200,301,302,303,307,308,401]){
 const modes=[];const fetcher=async(url,init)=>{modes.push(new Request(url,init).redirect);if(status!==200)return Response.json({}, {status});
 if(url.includes('/calls?'))return Response.json({data:[]});if(url.includes('summaries'))return Response.json({data:{summary:['Attic insulation']}});if(url.includes('transcripts'))return Response.json({data:{dialogue:[]}});
 return Response.json({data:{account:{id:'2498432'},client:{id:'100',quotes:{nodes:[],pageInfo:{hasNextPage:false}},jobs:{nodes:[],pageInfo:{hasNextPage:false}}}}});};
 const proof=await quoConversationProof({apiKey:'fixture',callerPhone:'+18015550101',phoneNumberId:'PNfixture',googleCallAt:'2026-10-01T12:00:00Z',fetcher});
 const scope=await verifyQualifiedPhoneScope({QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED:'true',QUO_API_KEY:'fixture',ANGI_ROUTER_DB:db},{call:{market_key:'ut'},quo:{quo_call_id:'ACfixture',caller_phone:'+18015550101'},clientId:'100',accessToken:'fixture',fetcher});rows.push({status,modes,proof,scope});}return Response.json(rows);}};`}});
 const options={modules:true,compatibilityDate:'2026-07-27',script:build.outputFiles[0].text},mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
 try{const rows=await(await mf.dispatchFetch('http://localhost/')).json();assert.equal(rows[0].proof.reason,'no_two_way_quo_conversation');assert.equal(rows[0].scope.ok,true);for(const r of rows){assert(r.modes.every(x=>x==='manual'));if(r.status!==200){assert.equal(r.proof.reader_failure.http_status,r.status);assert.equal(r.scope.reader_failure.http_status,r.status);assert.equal(r.scope.ok,false);}}}finally{await mf.dispose();}
});
