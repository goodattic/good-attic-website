import { dataManagerValidationRequest } from './stage2-validation.js';
export const CANARY_ID='gae-stl-sold-65203544';
const now=()=>new Date().toISOString();
export const CANARY_SCHEMA=`CREATE TABLE IF NOT EXISTS closed_loop_stage3a_canary(event_id TEXT PRIMARY KEY,claimed_at TEXT NOT NULL,state TEXT NOT NULL,request_json TEXT NOT NULL,response_status INTEGER,response_raw TEXT,request_id TEXT,diagnostics_status INTEGER,diagnostics_raw TEXT,diagnostics_at TEXT);`;
async function access(env,fetcher){
 const body=new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET,refresh_token:env.GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN});
 const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body});const b=await r.json();if(!r.ok||!b.access_token)throw Error('canary_oauth_failed');return b.access_token;
}
export function canaryRequest(row){
 if(row?.outcome_id!==CANARY_ID||row.market_key!=='mo_stl'||row.event_name!=='sold_job'||row.google_account_id!=='4800890529'||row.google_conversion_action!=='7754270382'||row.value_micros!==5290400000||row.currency_code!=='USD'||row.upload_state!=='shadow'||row.attempt_count!==0||row.diagnostic_code)throw Error('canary_row_not_exactly_authorized');
 if(new Date(row.conversion_at).toISOString()!=='2026-09-22T02:53:22.000Z')throw Error('canary_timestamp_changed');
 const request=dataManagerValidationRequest({event_id:CANARY_ID,action:'7754270382',timestamp:row.conversion_at,value:5290.40,gclid:row.gclid,gbraid:row.gbraid,wbraid:row.wbraid});
 request.validateOnly=false;return request;
}
export async function sendCanary(env,fetcher=fetch){
 if(env.GOOGLE_ADS_UPLOAD_ENABLED!=='false')throw Error('general_uploads_must_remain_disabled');
 const db=env.ANGI_ROUTER_DB;
 if(await db.prepare('SELECT event_id FROM closed_loop_stage3a_canary WHERE event_id=?').bind(CANARY_ID).first())return {already_attempted:true,event_id:CANARY_ID};
 const row=await db.prepare('SELECT * FROM google_ads_outcome_outbox WHERE outcome_id=?').bind(CANARY_ID).first();
 const request=canaryRequest(row),token=await access(env,fetcher),at=now();
 // Atomic one-time claim survives crashes, ambiguous network failures and retries.
 // An existing audit row NEVER grants permission to issue a second ingest request.
 const claim=await db.prepare("INSERT OR IGNORE INTO closed_loop_stage3a_canary(event_id,claimed_at,state,request_json) VALUES(?,?,'claimed',?) RETURNING event_id").bind(CANARY_ID,at,JSON.stringify(request)).first();
 if(!claim)return {already_attempted:true,event_id:CANARY_ID};
 const fence=await db.prepare("UPDATE google_ads_outcome_outbox SET upload_state='submitted',attempt_count=1,last_attempt_at=?,updated_at=?,google_response_category='CANARY_IN_FLIGHT' WHERE outcome_id=? AND upload_state='shadow' AND attempt_count=0").bind(at,at,CANARY_ID).run();
 if(fence.meta?.changes!==1)throw Error('canary_outbox_fence_failed_no_send');
 let response,raw;
 try{response=await fetcher('https://datamanager.googleapis.com/v1/events:ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(request)});raw=await response.text();}
 catch {await db.prepare("UPDATE closed_loop_stage3a_canary SET state='network_unknown_no_retry' WHERE event_id=?").bind(CANARY_ID).run();throw Error('canary_network_unknown_do_not_retry');}
 let parsed={};try{parsed=JSON.parse(raw);}catch{}
 await db.prepare('UPDATE closed_loop_stage3a_canary SET state=?,response_status=?,response_raw=?,request_id=? WHERE event_id=?').bind(response.ok?'ingestion_accepted':'ingestion_rejected',response.status,raw,parsed.requestId||null,CANARY_ID).run();
 await db.prepare('UPDATE google_ads_outcome_outbox SET upload_state=?,google_response_category=?,updated_at=? WHERE outcome_id=?').bind(response.ok?'accepted':'rejected',response.ok?'DATA_MANAGER_INGESTION_ACCEPTED_NOT_MATCH_CONFIRMED':'DATA_MANAGER_INGESTION_REJECTED',now(),CANARY_ID).run();
 return {event_id:CANARY_ID,http_status:response.status,google_response_raw:raw,request_id:parsed.requestId||null,google_upload_enabled:false};
}
export async function canaryStatus(env,fetcher=fetch){
 const db=env.ANGI_ROUTER_DB,row=await db.prepare('SELECT * FROM closed_loop_stage3a_canary WHERE event_id=?').bind(CANARY_ID).first();
 if(!row?.request_id)return {event_id:CANARY_ID,error:'no_recorded_request_id'};
 const token=await access(env,fetcher);
 const r=await fetcher('https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+encodeURIComponent(row.request_id),{headers:{Authorization:`Bearer ${token}`}}),raw=await r.text(),at=now();
 await db.prepare('UPDATE closed_loop_stage3a_canary SET diagnostics_status=?,diagnostics_raw=?,diagnostics_at=? WHERE event_id=?').bind(r.status,raw,at,CANARY_ID).run();
 return {event_id:CANARY_ID,request_id:row.request_id,checked_at:at,http_status:r.status,google_response_raw:raw};
}
