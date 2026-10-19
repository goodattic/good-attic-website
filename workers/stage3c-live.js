import {phoneCycle,phoneHealth} from '../server/qualified-phone-runtime.js';
import {googleCallMatchShadowCycle} from '../server/google-call-match-shadow.js';
import {collectSoldJobCallShadow} from '../server/sold-job-call-shadow.js';
import {INVOICE_TOPICS, handleInvoiceLineageWebhook, invoiceLineageShadowCycle, invoiceLineageShadowHealth} from '../server/invoice-lineage-runtime.js';
import base from './stage3a-canary.js';
import {tick} from './stage1-shadow.js';
import {health} from '../server/stage2-health.js';
import {uploadCycle,uploadHealth} from '../server/data-manager-live.js';
import {handleCallRequestLineageReview} from '../server/call-request-lineage-review-api.js';
import {phoneLeadWatchCycle,phoneLeadWatchHealth,requestedPhoneLeadWatchCycle} from '../server/phone-lead-watch-runtime.js';
export default {
 async scheduled(_event,env,ctx){
  // Separate watch ledger only. Never promotes rows into an upload queue.
  if(env.PHONE_LEAD_WATCH_ENABLED==='true'){
   const watch=(async()=>{
    await requestedPhoneLeadWatchCycle(env,{scheduledTime:_event.scheduledTime||Date.now()});
    return phoneLeadWatchCycle(env,{scheduledTime:_event.scheduledTime||Date.now()});
   })().catch(()=>({failed:true}));
   if(ctx?.waitUntil)ctx.waitUntil(watch);else await watch;
  }
  const phone=phoneCycle(env,{scheduledTime:_event.scheduledTime||Date.now()}).catch(()=>({failed:true}));
  if(ctx?.waitUntil)ctx.waitUntil(phone);
  if(env.GOOGLE_CALL_MATCH_SHADOW_ENABLED==='true'){
   const shadow=googleCallMatchShadowCycle(env,{scheduledTime:_event.scheduledTime||Date.now()}).catch(()=>({failed:true}));
   if(ctx?.waitUntil)ctx.waitUntil(shadow);else await shadow;
  }
  if(env.INVOICE_LINEAGE_SHADOW_ENABLED==='true'){
   const invoices=invoiceLineageShadowCycle(env).catch(()=>({failed:true}));
   if(ctx?.waitUntil)ctx.waitUntil(invoices);else await invoices;
  }
  try{
   await tick(env,'scheduled');
   // Off by default. This writes a separate shadow ledger only, and receives no
   // consent proof or upload capability from the live website pipeline.
   if(env.SOLD_JOB_CALL_SHADOW_ENABLED==='true'){
    console.log(JSON.stringify({sold_job_call_shadow:await collectSoldJobCallShadow({database:env.ANGI_ROUTER_DB})}));
   }
  }finally{console.log(JSON.stringify(await uploadCycle(env)));}
 },
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return Response.json({...await health(env),...await uploadHealth(env),qualified_phone:await phoneHealth(env),invoice_lineage:await invoiceLineageShadowHealth(env),phone_lead_watch:await phoneLeadWatchHealth(env)},{headers:{'Cache-Control':'no-store'}});
  if(path==='/call-request-lineage/preview')return handleCallRequestLineageReview({request,env,action:'preview'});
  if(path==='/call-request-lineage/verify')return handleCallRequestLineageReview({request,env,action:'verify'});
  if(path==='/call-request-lineage/supersede')return handleCallRequestLineageReview({request,env,action:'supersede'});
  if(path==='/webhooks/jobber/invoice-lineage'&&request.method==='POST')return handleInvoiceLineageWebhook({request,env});
  if(path==='/webhooks/jobber'&&request.method==='POST'){
   let topic='';try{topic=(await request.clone().json())?.data?.webHookEvent?.topic||'';}catch{}
   if(INVOICE_TOPICS.has(String(topic).toUpperCase()))return handleInvoiceLineageWebhook({request,env});
  }
  if(path==='/qualified-phone/backfill'){
   if(!env.STAGE1_ADMIN_SECRET||request.headers.get('Authorization')!==`Bearer ${env.STAGE1_ADMIN_SECRET}`)return Response.json({error:'unauthorized'},{status:401});
   if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
   const {since}=await request.json();
   if(!/^2026-09-(0[89]|[12][0-9]|30)$/.test(since||''))return Response.json({error:'invalid_since'},{status:400});
   return Response.json(await phoneCycle(env,{since}));
  }
  if(path==='/uploads/tick'){
   if(!env.STAGE1_ADMIN_SECRET||request.headers.get('Authorization')!==`Bearer ${env.STAGE1_ADMIN_SECRET}`)return Response.json({error:'unauthorized'},{status:401});
   if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
   try{return Response.json(await uploadCycle(env));}catch{return Response.json({error:'upload_cycle_failed'},{status:500});}
  }
  return base.fetch(request,env);
 }
};
