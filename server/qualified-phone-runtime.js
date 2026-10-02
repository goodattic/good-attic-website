import { _private as leads } from '../functions/api/leads.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';
import { googleCallEligible, matchQuoCallToGoogleCall, matchJobberLead, JOBBER_ACCOUNTS } from './google-qualified-phone-collector.js';
import {
 MANUAL_MATCH_FLAG, MANUAL_UPLOAD_FLAG, manualConversationEligible, resolveManualJobberRequest,
 persistManualCallLink, claimQualifiedPhoneRequest,
} from './qualified-phone-manual-match.js';

export const PHONE_FLAG = 'QUALIFIED_PHONE_UPLOAD_ENABLED';
export const MANUAL_SHADOW_START_FLAG = 'QUALIFIED_PHONE_MANUAL_SHADOW_STARTED_AT';
export const MANUAL_SHADOW_MS = 7 * 24 * 60 * 60 * 1000;
export const API_VERSION = 'v24';
const CUSTOMER = '4800890529';
const ACTION = '7742989654';
const now = () => new Date().toISOString();
const all = async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const run = (db,sql,...args)=>db.prepare(sql).bind(...args).run();
const endpoint = suffix=>`https://googleads.googleapis.com/${API_VERSION}/customers/${CUSTOMER}${suffix}`;
const CLIENT = 'id createdAt phones { number } jobs(first:100) { nodes { id jobStatus createdAt startAt endAt } pageInfo { hasNextPage } }';

function manualShadowStart(env) {
 const at=Date.parse(env[MANUAL_SHADOW_START_FLAG]||'');
 return Number.isFinite(at)?at:null;
}
export function manualUploadReady(env,at=Date.now()) {
 const started=manualShadowStart(env);
 return env[MANUAL_MATCH_FLAG]==='true'&&env[MANUAL_UPLOAD_FLAG]==='true'
  &&started!==null&&at>=started+MANUAL_SHADOW_MS;
}

export function denverTime(value) {
 const d=new Date(value);
 if(!Number.isFinite(+d))throw Error('invalid_timestamp');
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(d).map(x=>[x.type,x.value]));
 return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}${p.timeZoneName.replace('GMT','')||'+00:00'}`;
}
export function fromDenver(value) {
 if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value||''))throw Error('invalid_google_call_time');
 let at=Date.parse(value.replace(' ','T')+'Z');
 for(let i=0;i<2;i++){
  const offset=denverTime(at).slice(-6),sign=offset[0]==='-'?-1:1;
  at=Date.parse(value.replace(' ','T')+'Z')-sign*(Number(offset.slice(1,3))*60+Number(offset.slice(4)))*60000;
 }
 return denverTime(at);
}
export function campaignMarket(name) {
 const markers=[['ut',/\| UT \|/],['mo_stl',/\| MO-STL \|/],['mo_kc',/\| MO-KC \|/]].filter(([,re])=>re.test(name||''));
 return markers.length===1?markers[0][0]:null;
}
export function classifyResponse(status,body) {
 const errors=(body?.partialFailureError?.details||body?.error?.details||[]).flatMap(d=>d.errors||[]);
 const codes=errors.flatMap(e=>Object.values(e.errorCode||{})).map(String);
 if(body?.partialFailureError||body?.error||status!==200){
  if(codes.length&&codes.every(c=>c==='CALL_CONVERSION_ALREADY_EXISTS'))return {state:'uploaded',code:'already_accepted'};
  if(codes.length&&codes.every(c=>c==='TOO_RECENT_CALL'))return {state:'retryable',code:'TOO_RECENT_CALL'};
  return {state:'failed',code:codes.join('|')||`GOOGLE_HTTP_${status}_REVIEW_REQUIRED`};
 }
 if(body?.results?.length!==1||!body.results[0]?.conversionAction)return {state:'failed',code:'AMBIGUOUS_RESPONSE_MANUAL_REVIEW'};
 return {state:'uploaded',code:'GOOGLE_ACCEPTED'};
}
export function uploadBody(row) {
 if(!/^\+1\d{10}$/.test(row.caller_phone||''))throw Error('invalid_caller_e164');
 const start=Date.parse(row.call_started_at_original),created=Date.parse(row.conversion_at);
 if(!Number.isFinite(start)||!Number.isFinite(created))throw Error('missing_conversion_time');
 return {conversions:[{conversionAction:`customers/${CUSTOMER}/conversionActions/${ACTION}`,callerId:row.caller_phone,callStartDateTime:denverTime(start),conversionDateTime:denverTime(created<start?start+60000:created),conversionValue:0,currencyCode:'USD'}],partialFailure:true};
}
async function googleToken(env,fetcher) {
 if(!env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN)throw Error('ADS_REFRESH_TOKEN_MISSING');
 const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET,refresh_token:env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN}),signal:AbortSignal.timeout(20000)});
 const b=await r.json();if(!r.ok||!b.access_token)throw Error('ADS_TOKEN_REFRESH_FAILED');return b.access_token;
}
export async function readGoogleCalls(token,since,fetcher=fetch) {
 const query=`SELECT campaign.id, campaign.name, call_view.resource_name, call_view.start_call_date_time, call_view.call_duration_seconds, call_view.caller_area_code, call_view.call_status FROM call_view WHERE call_view.start_call_date_time >= '${since} 00:00:00'`;
 const r=await fetcher(endpoint('/googleAds:searchStream'),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error(`GOOGLE_CALL_READ_HTTP_${r.status}`);
 const b=await r.json();if(!Array.isArray(b))throw Error('GOOGLE_CALL_READ_INVALID');
 return b.flatMap(x=>x.results||[]).map(x=>({google_resource:x.callView.resourceName,campaign_id:x.campaign.id,market_key:campaignMarket(x.campaign.name),start_call_date_time:fromDenver(x.callView.startCallDateTime),call_duration_seconds:Number(x.callView.callDurationSeconds||0),caller_area_code:x.callView.callerAreaCode||'',call_status:x.callView.callStatus}));
}
async function verifyJobber(env,call,quo,fetcher,manualCandidate=false) {
 const route=getJobberOAuthRoute(call.market_key,'website');
 if(!route)return {ok:false,reason:'jobber_account_mismatch'};
 if(manualCandidate){
  try {
   const {accessToken}=await leads.refreshJobberAccessToken(env,route);
   const read=async(query,variables)=>{
    const r=await fetcher('https://api.getjobber.com/api/graphql',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','X-JOBBER-GRAPHQL-VERSION':'2025-04-16'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
    if(!r.ok)throw Error('jobber_read_unavailable');
    const body=await r.json();
    if(body.errors?.length||!body.data)throw Error('jobber_read_unavailable');
    return body.data;
   };
   return resolveManualJobberRequest({callerPhone:quo.caller_phone,callAt:call.start_call_date_time,
    marketKey:call.market_key,accountId:route.expectedAccountId,read,db:env.ANGI_ROUTER_DB});
  }catch{return {ok:false,reason:'jobber_read_unavailable'};}
 }
 const {accessToken}=await leads.refreshJobberAccessToken(env,route);
 const isRequest=Boolean(quo.jobber_request_id),id=quo.jobber_request_id||quo.jobber_client_id;
 if(!id)return {ok:false,reason:'jobber_link_missing'};
 const query=isRequest?`query PhoneProof($id:EncodedId!){account{id} request(id:$id){id createdAt client{${CLIENT}}}}`:`query PhoneProof($id:EncodedId!){account{id} client(id:$id){${CLIENT}}}`;
 const r=await fetcher('https://api.getjobber.com/api/graphql',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','X-JOBBER-GRAPHQL-VERSION':'2025-04-16'},body:JSON.stringify({query,variables:{id}}),signal:AbortSignal.timeout(25000)});
 const b=await r.json();if(!r.ok||b.errors?.length)return {ok:false,reason:'jobber_read_unavailable'};
 if(b.data?.account?.id!==route.expectedAccountId)return {ok:false,reason:'jobber_account_mismatch'};
 const obj=isRequest?b.data.request:b.data.client,client=isRequest?obj?.client:obj;
 if(!obj||!client)return {ok:false,reason:'jobber_record_deleted'};
 const nums=client.phones?.map(p=>String(p.number).replace(/\D/g,''))||[];
 if(!nums.some(n=>(n.length===10?'1'+n:n)===quo.caller_phone.replace(/\D/g,'')))return {ok:false,reason:'jobber_phone_mismatch'};
 if(client.jobs.pageInfo.hasNextPage)return {ok:false,reason:'jobber_history_incomplete'};
 const callAt=Date.parse(call.start_call_date_time);
 // An older completed job is sufficient to exclude; older uncertain jobs hold.
 if(client.jobs.nodes.some(j=>Date.parse(j.createdAt)<callAt))return {ok:false,reason:'prior_job_requires_review'};
 if(isRequest){
  const disposition=await env.ANGI_ROUTER_DB.prepare('SELECT disposition FROM closed_loop_lead_dispositions WHERE market_key=? AND request_id=?').bind(call.market_key,obj.id).first();
  if(disposition)return {ok:false,reason:'jobber_lead_excluded'};
 }
 const record={market_key:call.market_key,phone:quo.caller_phone,created_at:obj.createdAt,jobber_request_id:isRequest?obj.id:null,jobber_client_id:client.id,prior_completed_work:false};
 const match=matchJobberLead({callerPhone:quo.caller_phone,googleCallAt:call.start_call_date_time,marketKey:call.market_key,records:[record]});
 return match.ok?{ok:true,record}:match;
}
async function identity(call) {
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(call.google_resource));
 return 'qualified-phone:'+Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function submitPhone(env,token,resource,fetcher=fetch) {
 const db=env.ANGI_ROUTER_DB;
 if(env[PHONE_FLAG]!=='true')return {state:'held',code:'phone_upload_disabled'};
 const row=await db.prepare('SELECT o.*,p.state AS phone_state,p.google_call_json AS phone_call_json FROM qualified_phone_calls p JOIN google_ads_outcome_outbox o ON o.outcome_id=p.outcome_id WHERE p.google_resource=?').bind(resource).first();
 if(!row)return {state:'held',code:'candidate_missing'};
 let manualMarker=false;
 try{manualMarker=JSON.parse(row.phone_call_json)?.match_origin==='manual';}catch{}
 if(manualMarker&&!manualUploadReady(env)){
  return {state:'held',code:'manual_phone_upload_disabled'};
 }
 // No claims-table dependency is introduced while manual matching is off;
 // the existing phone stage can keep running before migration 0020 is applied.
 if(env[MANUAL_MATCH_FLAG]==='true'){
  const requestClaim=await db.prepare('SELECT match_origin FROM qualified_phone_request_claims WHERE google_resource=?').bind(resource).first();
  if((requestClaim?.match_origin==='manual')!==manualMarker)return {state:'held',code:'phone_origin_conflict'};
  if(requestClaim?.match_origin==='manual'&&!manualUploadReady(env))return {state:'held',code:'manual_phone_upload_disabled'};
 }
 const body=uploadBody(row),at=now();
 // Claim before the network. Unknown delivery stays fenced across restarts.
 const claim=await run(db,"UPDATE qualified_phone_calls SET state='submitting',attempt_count=attempt_count+1,updated_at=? WHERE google_resource=? AND (state='ready' OR (state='retryable' AND next_retry_at<=? AND attempt_count<5))",at,resource,at);
 if(claim.meta?.changes!==1)return {state:row.phone_state,code:'duplicate_prevented'};
 let status=null,parsed=null,result;
 try{
  const response=await fetcher(endpoint(':uploadCallConversions'),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  status=response.status;parsed=await response.json();result=classifyResponse(status,parsed);
 }catch{result={state:'failed',code:'AMBIGUOUS_DELIVERY_MANUAL_REVIEW'};}
 // Google may echo caller numbers or trigger values. Store only sanitized fields.
 const safe={http_status:status,state:result.state,diagnostic_code:result.code,partial_failure:Boolean(parsed?.partialFailureError),result_count:parsed?.results?.length||0};
 await db.batch([
  db.prepare('UPDATE qualified_phone_calls SET state=?,diagnostic_code=?,http_status=?,response_json=?,next_retry_at=?,updated_at=? WHERE google_resource=?').bind(result.state,result.code,status,JSON.stringify(safe),result.state==='retryable'?new Date(Date.now()+3*3600000).toISOString():null,now(),resource),
  db.prepare('UPDATE google_ads_outcome_outbox SET upload_state=?,attempt_count=attempt_count+1,last_attempt_at=?,google_response_category=?,diagnostic_code=?,updated_at=? WHERE outcome_id=?').bind(result.state==='uploaded'?'accepted':result.state==='retryable'?'retryable':'held',at,result.code,result.code,now(),row.outcome_id)
 ]);
 return safe;
}
export async function phoneCycle(env,{scheduledTime=Date.now(),since,fetcher=fetch,verify=verifyJobber}={}) {
 if(env[PHONE_FLAG]!=='true')return {disabled:true};
 const db=env.ANGI_ROUTER_DB,at=now();
 const key=since?`backfill:${since}:${Math.floor(scheduledTime/10800000)}`:`scheduled:${Math.floor(scheduledTime/10800000)}`;
 const claim=await run(db,"INSERT OR IGNORE INTO qualified_phone_runs(run_key,started_at,status) VALUES(?,?,'running')",key,at);
 if(!claim.meta?.changes)return {skipped:true};
 try{
  const token=await googleToken(env,fetcher);
  const start=since||denverTime(scheduledTime-14*86400000).slice(0,10);
  const calls=await readGoogleCalls(token,start,fetcher);
  const quo=await all(db,'SELECT * FROM quo_call_attributions WHERE call_started_at_utc>=?',start);
  const shadowStart=manualShadowStart(env);
  const manualClaimRows=env[MANUAL_MATCH_FLAG]==='true'
   ? await all(db,"SELECT google_resource FROM qualified_phone_request_claims WHERE match_origin='manual'") : [];
  const manualClaims=new Set(manualClaimRows.map(row=>row.google_resource));
  const prepared=calls.map(call=>{
   const match=matchQuoCallToGoogleCall(call,quo);
   const manualUnlinkedOrClaimed=env[MANUAL_MATCH_FLAG]==='true'&&match.ok
    &&(!match.call.jobber_request_id||manualClaims.has(call.google_resource));
   const callAt=Date.parse(call.start_call_date_time);
   const manualBlockedReason=manualUnlinkedOrClaimed&&shadowStart===null?'manual_shadow_start_missing'
    :manualUnlinkedOrClaimed&&callAt<shadowStart?'manual_before_shadow_start':null;
   const manualCandidate=env[MANUAL_MATCH_FLAG]==='true'&&shadowStart!==null
    &&callAt>=shadowStart&&manualUnlinkedOrClaimed;
   const conversation=manualCandidate?manualConversationEligible(match.call,call):null;
   return {call,match,manualCandidate,manualBlockedReason,conversation,
    eligible:manualCandidate?conversation.ok:googleCallEligible(call)};
  });
  const ambiguous=new Set();
  for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++){
   const a=prepared[i],b=prepared[j];
   const manualPair=a.manualCandidate||b.manualCandidate;
   if(manualPair&&a.eligible&&b.eligible&&a.match.ok&&b.match.ok&&a.call.market_key===b.call.market_key
    &&a.match.call.caller_phone===b.match.call.caller_phone
    &&Math.abs(Date.parse(a.call.start_call_date_time)-Date.parse(b.call.start_call_date_time))<=7*86400000+3600000){
    ambiguous.add(a.call.google_resource);ambiguous.add(b.call.google_resource);
   }
  }
  for(const {call,eligible,match,manualCandidate,manualBlockedReason,conversation} of prepared){
   const old=await db.prepare('SELECT state,diagnostic_code FROM qualified_phone_calls WHERE google_resource=?').bind(call.google_resource).first();
   if(old&&(['uploaded','submitting','failed'].includes(old.state)
    ||old.diagnostic_code==='ambiguous_google_calls_same_caller'))continue;
   let reason=!call.market_key?'unmapped_campaign':!match.ok?match.reason:manualBlockedReason?manualBlockedReason
    :!eligible?(manualCandidate?conversation.reason:'duration_at_least_60s')
    :ambiguous.has(call.google_resource)?'ambiguous_google_calls_same_caller':null;
   let record,manualHold=false,matchOrigin=null;
   if(!reason){
    const proof=await verify(env,call,match.call,fetcher,manualCandidate);
    if(!proof.ok)reason=proof.reason;
    else {
     record=proof.record;
     if(proof.manual){
      const route=getJobberOAuthRoute(call.market_key,'website');
      const linked=await persistManualCallLink(db,{accountId:route.expectedAccountId,marketKey:call.market_key,quoCall:match.call,record});
      if(!linked.ok)reason=linked.reason;
     }
     // Apply the Request-level fence to both newly linked manual Requests and
     // prelinked auto-created Requests. 0020 reserves existing live outcomes.
     if(!reason&&manualCandidate&&!proof.manual)reason='manual_request_proof_missing';
     if(!reason&&env[MANUAL_MATCH_FLAG]==='true'&&record?.jobber_request_id){
      const claimed=await claimQualifiedPhoneRequest(db,{marketKey:call.market_key,requestId:record.jobber_request_id,
       googleResource:call.google_resource,quoCallId:match.call.quo_call_id,manual:Boolean(proof.manual)});
      if(!claimed.ok)reason=claimed.reason;
      else {
       matchOrigin=claimed.match_origin;
       manualHold=matchOrigin==='manual'&&!manualUploadReady(env);
      }
     }
     if(reason)record=null;
    }
   }
   let id=record?await identity(call):null;
   if(record?.jobber_request_id){
    const existing=await db.prepare('SELECT quo_call_id,jobber_request_id,jobber_client_id FROM google_ads_outcome_outbox WHERE outcome_id=?').bind(id).first();
    if(existing&&(existing.quo_call_id!==match.call.quo_call_id||existing.jobber_request_id!==record.jobber_request_id||existing.jobber_client_id!==record.jobber_client_id)){
     reason='phone_outbox_identity_conflict';record=null;id=null;
    }
   }
   const callEvidence=manualCandidate?{...call,match_origin:'manual',
    start_call_date_time_utc:new Date(call.start_call_date_time).toISOString(),quo_call_id:match.call.quo_call_id,
    quo_final_status:match.call.final_status,quo_duration_seconds:match.call.duration_seconds,
    quo_answered_at:match.call.answered_at}:call;
   await run(db,`INSERT INTO qualified_phone_calls(google_resource,market_key,google_call_json,outcome_id,state,diagnostic_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(google_resource) DO UPDATE SET outcome_id=COALESCE(excluded.outcome_id,qualified_phone_calls.outcome_id),google_call_json=CASE WHEN json_extract(qualified_phone_calls.google_call_json,'$.match_origin')='manual' AND COALESCE(json_extract(excluded.google_call_json,'$.match_origin'),'')!='manual' THEN qualified_phone_calls.google_call_json ELSE excluded.google_call_json END,state=CASE WHEN excluded.diagnostic_code='manual_phone_upload_disabled' THEN 'held' WHEN qualified_phone_calls.state='retryable' THEN 'retryable' ELSE excluded.state END,diagnostic_code=excluded.diagnostic_code,updated_at=excluded.updated_at WHERE qualified_phone_calls.state IN ('held','excluded','ready','retryable')`,call.google_resource,call.market_key,JSON.stringify(callEvidence),id,reason?(eligible?'held':'excluded'):manualHold?'held':'ready',reason|| (manualHold?'manual_phone_upload_disabled':null),at,at);
   if(!record)continue;
   const q=match.call;
   await run(db,`INSERT OR IGNORE INTO google_ads_outcome_outbox(outcome_id,event_name,market_key,attribution_path,attribution_status,quo_call_id,google_call_key,caller_phone,call_started_at_original,call_started_at_utc,call_timezone,jobber_account_id,jobber_request_id,jobber_client_id,google_account_id,google_conversion_action,milestone_at,conversion_at,value_micros,currency_code,consent_status,upload_state,created_at,updated_at) VALUES(?,'qualified_lead',?,'quo_call','pending',?,?,?,?,?,'America/Denver',?,?,?,?,?,?,?,0,'USD','unknown','held',?,?)`,id,call.market_key,q.quo_call_id,call.google_resource,q.caller_phone,call.start_call_date_time,new Date(call.start_call_date_time).toISOString(),JOBBER_ACCOUNTS[call.market_key],record.jobber_request_id,record.jobber_client_id,CUSTOMER,ACTION,record.created_at,record.created_at,at,at);
   if(manualHold)continue;
   await submitPhone(env,token,call.google_resource,fetcher);
  }
  await run(db,"UPDATE qualified_phone_runs SET status='completed',completed_at=? WHERE run_key=?",now(),key);
  return {completed:true,calls:calls.length};
 }catch{
  await run(db,"UPDATE qualified_phone_runs SET status='failed',completed_at=?,diagnostic_code='PHONE_CYCLE_FAILED' WHERE run_key=?",now(),key);
  return {failed:true,diagnostic_code:'PHONE_CYCLE_FAILED'};
 }
}
export async function phoneHealth(env) {
 try{
  const rows=await all(env.ANGI_ROUTER_DB,'SELECT state,count(*) AS n FROM qualified_phone_calls GROUP BY state');
  const counts=Object.fromEntries(rows.map(r=>[r.state,r.n]));
  const last=await env.ANGI_ROUTER_DB.prepare('SELECT started_at,completed_at,status,diagnostic_code FROM qualified_phone_runs ORDER BY started_at DESC LIMIT 1').first();
  return {enabled:env[PHONE_FLAG]==='true',manual_match_enabled:env[MANUAL_MATCH_FLAG]==='true',
   manual_upload_enabled:manualUploadReady(env),manual_shadow_started_at:env[MANUAL_SHADOW_START_FLAG]||null,
   lookback_days:14,interval_hours:3,
   candidates:Object.values(counts).reduce((a,b)=>a+b,0)-(counts.excluded||0),uploaded:counts.uploaded||0,
   held:(counts.held||0)+(counts.ready||0)+(counts.retryable||0),failed:(counts.failed||0)+(counts.submitting||0),
   excluded:counts.excluded||0,last_run:last||null};
 }catch{return {enabled:env[PHONE_FLAG]==='true',manual_match_enabled:env[MANUAL_MATCH_FLAG]==='true',
  manual_upload_enabled:manualUploadReady(env),manual_shadow_started_at:env[MANUAL_SHADOW_START_FLAG]||null,
  status:'schema_unavailable'};}
}

/** Read-only, no-PII evidence for the first seven days of manual matching. */
export async function manualShadowReport(env,at=Date.now()) {
 const started=manualShadowStart(env);
 if(started===null)return {configured:false,candidates:[]};
 const ended=started+MANUAL_SHADOW_MS;
 const rows=await all(env.ANGI_ROUTER_DB,`SELECT p.google_resource,p.market_key,p.state,p.diagnostic_code,
  p.created_at AS first_seen_at,
  json_extract(p.google_call_json,'$.start_call_date_time_utc') AS google_call_at,
  json_extract(p.google_call_json,'$.quo_call_id') AS quo_call_id,
  json_extract(p.google_call_json,'$.quo_final_status') AS quo_final_status,
  json_extract(p.google_call_json,'$.quo_duration_seconds') AS quo_duration_seconds,
  json_extract(p.google_call_json,'$.quo_answered_at') AS quo_answered_at,
  o.jobber_request_id
  FROM qualified_phone_calls p
  LEFT JOIN google_ads_outcome_outbox o ON o.outcome_id=p.outcome_id
  WHERE json_extract(p.google_call_json,'$.match_origin')='manual'
   AND json_extract(p.google_call_json,'$.start_call_date_time_utc')>=?
   AND json_extract(p.google_call_json,'$.start_call_date_time_utc')<?
  ORDER BY google_call_at,p.google_resource`,new Date(started).toISOString(),new Date(ended).toISOString());
 return {configured:true,shadow_started_at:new Date(started).toISOString(),
  shadow_ends_at:new Date(ended).toISOString(),ready_for_review:at>=ended,
  google_may_already_count_answered_calls:true,
  candidates:rows.map(row=>({...row,would_upload_after_approval:
   row.state==='held'&&row.diagnostic_code==='manual_phone_upload_disabled'
   &&row.quo_final_status==='completed'&&Number(row.quo_duration_seconds)>=60
   &&Number.isFinite(Date.parse(row.quo_answered_at||''))&&Boolean(row.jobber_request_id)}))};
}
