import { ACTIONS, MARKETS, clickIdentifier, utcTime, SINCE } from './stage1-model.js';
const CANARY='gae-stl-sold-65203544';
// The seven KC archive leads predate this release (latest inquiry: Oct 4).
// New KC inquiries must prove their website source at the upload boundary,
// even if Fieldflow's archive row won the Stage 1 lead upsert race.
const KC_PAID_PROOF_CUTOVER='2026-10-19T00:00:00Z';
const KC_JOBBER_ACCOUNT='Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==';
// Snapshot of the seven pre-cutover KC archive Requests. Six had no click ID
// and remain ineligible. The seventh is pinned by Client, time, and hashes of
// both stored identifiers; no raw click ID is checked into source control.
const KC_LEGACY_ARCHIVE=Object.freeze({
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzI3NzY0NzM=':{inquiry:'2026-08-12T23:56:27.438Z'},
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzMyMjQyOTA=':{inquiry:'2026-08-25T17:47:01.260Z'},
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzM5MzM3ODU=':{inquiry:'2026-09-13T16:23:06.541Z'},
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzQyMzMyNjY=':{
  inquiry:'2026-09-21T18:29:27.381Z',
  client:'Z2lkOi8vSm9iYmVyL0NsaWVudC8xNTM5NTkyNjU=',
  gclid:'f77566854b600fe2303758cc81e53ef94dfbf1758dd9c9c3fe751ca39e086e26',
  gbraid:'2cdb37667d96c1befdb1210d89e68fa9a4b40977a7ad9341399d4f75d50327a5',
 },
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzQ2OTUxMDU=':{inquiry:'2026-10-02T21:55:05.072Z'},
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzQ2OTU4ODM=':{inquiry:'2026-10-02T22:22:16.085Z'},
 'Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMzQ3MTkzOTc=':{inquiry:'2026-10-04T16:09:42.937Z'},
});
const now=()=>new Date().toISOString();
const later=(ms)=>new Date(Date.now()+ms).toISOString();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const parse=raw=>{try{return JSON.parse(raw);}catch{return null;}};
const duplicateReason=r=>['PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID','PROCESSING_ERROR_REASON_DUPLICATE_GCLID','DUPLICATE_TRANSACTION_ID','DUPLICATE_GCLID'].includes(r);
export function classifyDiagnostics(body,action){
 const rows=body?.requestStatusPerDestination;
 if(!Array.isArray(rows)||rows.length!==1)return {status:'processing',error:'UNEXPECTED_DIAGNOSTIC_SHAPE'};
 const d=rows[0];
 if(d.destination?.operatingAccount?.accountId!=='4800890529'||d.destination?.productDestinationId!==action)return {status:'processing',error:'DIAGNOSTIC_DESTINATION_MISMATCH'};
 const errors=(d.errorInfo?.errorCounts||[]).filter(e=>Number(e.recordCount)>0);
 if(d.requestStatus==='SUCCESS'&&!errors.length)return {status:'accepted',error:null};
 if(['FAILED','PARTIAL_SUCCESS'].includes(d.requestStatus)){
  if(errors.length&&errors.every(e=>duplicateReason(e.reason)))return {status:'duplicate_of_sheet_import',error:errors.map(e=>e.reason).join('|')};
  return {status:'retryable',error:errors.map(e=>e.reason).join('|')||d.requestStatus};
 }
 return {status:'processing',error:null};
}
export function liveRequest(row,cutoverAt){
 if(row.outcome_id===CANARY)throw Error('canary_resend_forbidden');
 if(!MARKETS[row.market_key]||!ACTIONS[row.event_name]||row.google_account_id!=='4800890529'||row.google_conversion_action!==ACTIONS[row.event_name])throw Error('unexpected_destination');
 if(row.diagnostic_code||!row.payload_json||JSON.parse(row.hold_reasons_json||'[]').length)throw Error('event_held');
 if(!['shadow','retryable'].includes(row.upload_state))throw Error('event_already_dispatched');
 const p=JSON.parse(row.payload_json),identifier=clickIdentifier(p);
 if(Object.keys(identifier).length!==1)throw Error('missing_click_identifier');
 if(p.orderId!==row.outcome_id||p.conversionAction!==`customers/4800890529/conversionActions/${row.google_conversion_action}`)throw Error('payload_identity_mismatch');
 if(!/(Z|[+-]\d{2}:\d{2})$/.test(p.conversionDateTime||''))throw Error('timestamp_offset_missing');
 const timestamp=utcTime(p.conversionDateTime.replace(' ','T'));
 if(!timestamp||Date.parse(timestamp)<Date.parse(SINCE)||Date.parse(timestamp)>Date.now())throw Error('invalid_conversion_time');
 if(row.event_name==='appointment_set'&&(!cutoverAt||Date.parse(timestamp)<Date.parse(cutoverAt)))throw Error('historical_appointment_held');
 if(!Number.isFinite(p.conversionValue)||p.conversionValue<0||p.currencyCode!=='USD')throw Error('invalid_conversion_value');
 return {destinations:[{operatingAccount:{accountType:'GOOGLE_ADS',accountId:'4800890529'},productDestinationId:row.google_conversion_action}],events:[{transactionId:row.outcome_id,eventTimestamp:timestamp.replace(' ','T'),adIdentifiers:identifier,eventSource:'OTHER',currency:'USD',conversionValue:p.conversionValue}],validateOnly:false};
}
async function clickHash(key,value){
 const bytes=new TextEncoder().encode(`${key}:${value}`);
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function kcLegacyArchiveGate(db,row,stageLead,allowlist=KC_LEGACY_ARCHIVE){
 const pin=allowlist[row.jobber_request_id];
 if(!pin||stageLead.source!=='website_attribution_archive'||stageLead.inquiry_at!==pin.inquiry)
  return {ok:false,reason:'kc_legacy_archive_not_pinned'};
 if(!pin.gclid)return {ok:false,reason:'kc_legacy_archive_no_click'};
 if(row.jobber_client_id!==pin.client)return {ok:false,reason:'kc_legacy_client_changed'};
 // A reused Request is no longer the original archive lead, even when its
 // older archive timestamp survives a Stage 1 upsert.
 const reused=await db.prepare(`SELECT 1 AS present FROM website_form_conversions
  WHERE market_key='mo_kc' AND jobber_request_id=?
  UNION ALL SELECT 1 AS present FROM closed_loop_leads
  WHERE market_key='mo_kc' AND jobber_request_id=? LIMIT 1`)
  .bind(row.jobber_request_id,row.jobber_request_id).first();
 if(reused)return {ok:false,reason:'kc_legacy_request_reused'};
 let payload;
 try{payload=JSON.parse(row.payload_json);}catch{return {ok:false,reason:'kc_legacy_payload_invalid'};}
 for(const key of ['gclid','gbraid','wbraid']){
  const expected=pin[key]||null;
  if(!expected&&stageLead[key])return {ok:false,reason:'kc_legacy_click_changed'};
  if(expected&&(!stageLead[key]||await clickHash(key,stageLead[key])!==expected))
   return {ok:false,reason:'kc_legacy_click_changed'};
 }
 const selected=['gclid','gbraid','wbraid'].find(key=>pin[key]);
 const outboxIds=['gclid','gbraid','wbraid'].filter(key=>row[key]);
 if(outboxIds.length!==1||outboxIds[0]!==selected
  ||await clickHash(selected,row[selected])!==pin[selected])
  return {ok:false,reason:'kc_legacy_click_changed'};
 const payloadIds=['gclid','gbraid','wbraid'].filter(key=>payload[key]);
 if(!selected||payloadIds.length!==1||payloadIds[0]!==selected
  ||!payload[selected]||await clickHash(selected,payload[selected])!==pin[selected])
  return {ok:false,reason:'kc_legacy_payload_click_changed'};
 return {ok:true,legacy:true};
}
export function kcStageOutboxLineageGate(row){
 // Existing accepted UT/STL uploads include differing Job links across ledgers.
 // Apply this exact join only to the new KC website proof path.
 if(row.stage_market_key==='mo_kc'&&row.attribution_path!=='website')
  return {ok:false,reason:'kc_stage1_attribution_path_mismatch'};
 if(row.market_key!=='mo_kc'&&row.stage_market_key!=='mo_kc')return {ok:true};
 if(row.stage_market_key!==row.market_key||row.stage_event_name!==row.event_name
  ||row.stage_request_id!==row.jobber_request_id
  ||(row.stage_quote_id||null)!==(row.jobber_quote_id||null)
  ||(row.stage_job_id||null)!==(row.jobber_job_id||null)
  ||row.stage_conversion_at!==row.conversion_at)
  return {ok:false,reason:'stage1_outbox_lineage_mismatch'};
 if(!Number.isSafeInteger(row.stage_value_micros)
  ||row.stage_value_micros!==row.value_micros)
  return {ok:false,reason:'stage1_outbox_value_mismatch'};
 let payload;
 try{payload=JSON.parse(row.payload_json);}catch{return {ok:false,reason:'stage1_payload_lineage_mismatch'};}
 if(!utcTime(row.stage_conversion_at)
  ||payload?.conversionDateTime!==utcTime(row.stage_conversion_at)
  ||!Number.isFinite(payload?.conversionValue)
  ||Math.round(payload.conversionValue*1e6)!==row.stage_value_micros)
  return {ok:false,reason:'stage1_payload_lineage_mismatch'};
 return {ok:true};
}
export async function kcWebsiteProofGate(db,row){
 // Call-origin candidates have their own proof and upload path. This gate is
 // only for the Stage 1 website-click path feeding Data Manager.
 if(row.market_key!=='mo_kc'||row.attribution_path!=='website')return {ok:true};
 if(row.jobber_account_id!==MARKETS.mo_kc.account||!row.jobber_request_id||!row.jobber_client_id)
  return {ok:false,reason:'kc_jobber_identity_missing'};
 const stageLead=await db.prepare('SELECT source,inquiry_at,gclid,gbraid,wbraid,conflict FROM closed_loop_stage1_leads WHERE market_key=? AND request_id=?')
  .bind('mo_kc',row.jobber_request_id).first();
 if(stageLead?.conflict)return {ok:false,reason:'kc_stage1_lead_conflict'};
 const inquiryAt=stageLead?.inquiry_at;
 if(!inquiryAt||!Number.isFinite(Date.parse(inquiryAt)))return {ok:false,reason:'kc_inquiry_time_missing'};
 if(stageLead.source==='website_attribution_archive'&&Date.parse(inquiryAt)<Date.parse(KC_PAID_PROOF_CUTOVER))
  return kcLegacyArchiveGate(db,row,stageLead);
 if(Date.parse(inquiryAt)<Date.parse(KC_PAID_PROOF_CUTOVER))
  return {ok:false,reason:'kc_unproven_pre_cutover_lead'};
 // The original form ledger must affirm consent before a new KC paid outcome
 // can enter Google Data Manager. Reconciled rows with unknown consent hold.
 if(row.consent_status!=='granted')return {ok:false,reason:'kc_consent_not_granted'};
 const proof=await db.prepare(`
  SELECT l.submission_id,l.inquiry_at,l.campaign,l.gclid,l.gbraid,l.wbraid,l.consent_state,
    p.source_reason,p.evidence_json
  FROM closed_loop_leads l
  JOIN website_google_source_proofs p ON p.submission_id=l.submission_id
    AND p.market_key=l.market_key AND p.account_id=l.jobber_account_id
    AND p.jobber_request_id=l.jobber_request_id AND p.jobber_client_id=l.jobber_client_id
    AND p.source_lead_id='website:' || lower(l.submission_id)
    AND p.state='completed' AND p.source_key='google' AND p.source_detail='google_ads'
  JOIN website_form_conversions f ON f.submission_id=l.submission_id
    AND f.transaction_id=l.submission_id AND f.market_key=l.market_key
    AND f.jobber_account_id=l.jobber_account_id
    AND f.jobber_request_id=l.jobber_request_id AND f.jobber_client_id=l.jobber_client_id
    AND f.state='completed' AND f.reconciliation_required=0
  JOIN acknowledgement_sources a ON a.account_id=l.jobber_account_id
    AND a.request_id=l.jobber_request_id AND a.market_key=l.market_key
    AND a.client_id=l.jobber_client_id AND a.source_kind='website'
    AND a.source_lead_id=p.source_lead_id AND a.source_created_at=l.inquiry_at
  WHERE l.market_key='mo_kc' AND l.original_source='Google Ads'
    AND l.jobber_account_id=? AND l.jobber_request_id=?
    AND l.jobber_client_id=? AND l.inquiry_at=?
  LIMIT 1`).bind(KC_JOBBER_ACCOUNT,row.jobber_request_id,row.jobber_client_id,inquiryAt).first();
 if(!proof)return {ok:false,reason:'kc_paid_source_chain_unconfirmed'};
 if(proof.consent_state!=='granted')return {ok:false,reason:'kc_source_consent_not_granted'};
 const reason=String(proof.source_reason||'').replace(/^(?:paid_touch|first_touch)_/,'');
 if(!['gclid','gbraid','wbraid'].includes(reason))return {ok:false,reason:'kc_click_proof_missing'};
 let evidence,payload;
 try{evidence=JSON.parse(proof.evidence_json);payload=JSON.parse(row.payload_json);}catch{return {ok:false,reason:'kc_proof_payload_invalid'};}
 if(evidence?.schema_version!==1||evidence.source_key!=='google'
  ||evidence.source_detail!=='google_ads'||evidence.source_reason!==proof.source_reason
  ||!evidence.attribution||typeof evidence.attribution!=='object'
  ||!evidence.verified_signals||typeof evidence.verified_signals!=='object')
  return {ok:false,reason:'kc_paid_source_evidence_invalid'};
 const selected=String(evidence.verified_signals[reason]||'').trim();
 if(!/^[A-Za-z0-9._~-]{6,300}$/.test(selected)||selected!==proof[reason])
  return {ok:false,reason:'kc_click_proof_mismatch'};
 const proofIds=['gclid','gbraid','wbraid'].filter(key=>proof[key]);
 const outboxIds=['gclid','gbraid','wbraid'].filter(key=>row[key]);
 const payloadIds=['gclid','gbraid','wbraid'].filter(key=>payload[key]);
 if(proofIds.length!==1||outboxIds.length!==1||payloadIds.length!==1
  ||proofIds[0]!==reason||outboxIds[0]!==reason||payloadIds[0]!==reason
  ||row[reason]!==selected||payload[reason]!==selected
  ||clickIdentifier(stageLead)[reason]!==selected)
  return {ok:false,reason:'kc_click_lineage_mismatch'};
 const prefix=proof.source_reason.startsWith('paid_touch_')?'paid_touch':
  proof.source_reason.startsWith('first_touch_')?'first_touch':'';
 const attribution=evidence.attribution;
 const landings=prefix?[attribution[`${prefix}_landing_page`]]:
  [attribution.ad_landing_page,attribution.source_url,attribution.page_url];
 let landingUrl=null;
 for(const landing of landings){try{landingUrl=new URL(landing);break;}catch{}}
 const campaign=String(landingUrl?.searchParams.get('utm_campaign')
  ||attribution[prefix?`${prefix}_utm_campaign`:'utm_campaign']||'').trim().slice(0,500);
 if(campaign!==String(proof.campaign||''))return {ok:false,reason:'kc_campaign_proof_mismatch'};
 return {ok:true};
}
async function access(env,fetcher){
 const names=['OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REFRESH_TOKEN'].map(n=>'GOOGLE_DATA_MANAGER_'+n);
 if(names.some(n=>!env[n]))throw Error('missing_cloud_oauth_secret');
 const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:env[names[0]],client_secret:env[names[1]],refresh_token:env[names[2]]}),signal:AbortSignal.timeout(20000)});
 const b=await r.json();if(!r.ok||!b.access_token)throw Error('data_manager_oauth_failed');return b.access_token;
}
async function result(db,id,attempt,status,http,raw,requestId){
 const at=now(),processing=status==='processing';
 // No response / server error is ambiguous: never automatically retransmit it.
 const duplicate=status==='duplicate_of_sheet_import';
 const retry=status==='retryable',auto=retry&&http>=400&&http<500;
 const category=duplicate?'duplicate_of_sheet_import':retry?(auto?'GOOGLE_INGESTION_REJECTED':'AMBIGUOUS_DELIVERY_MANUAL_REVIEW'):null;
 await db.batch([
 db.prepare('UPDATE closed_loop_google_upload_attempts SET request_id=?,http_status=?,response_raw=? WHERE event_id=? AND attempt_number=?').bind(requestId,http,raw,id,attempt),
 db.prepare('UPDATE closed_loop_google_uploads SET status=?,request_id=?,http_status=?,response_raw=?,submitted_at=?,next_diagnostics_at=?,auto_retry=?,next_retry_at=?,error_category=?,updated_at=? WHERE event_id=?').bind(status,requestId,http,raw,processing?at:null,processing?later(1800000):null,auto?1:0,auto?later(86400000):null,category,at,id),
 db.prepare('UPDATE google_ads_outcome_outbox SET upload_state=?,google_response_category=?,updated_at=? WHERE outcome_id=?').bind(processing?'submitted':duplicate?'accepted':'retryable',processing?'DATA_MANAGER_PROCESSING':category,at,id)
 ]);
}
export async function submitReady(env,token,fetcher=fetch,limit=40){
 const db=env.ANGI_ROUTER_DB;
 const control=await db.prepare("SELECT value FROM closed_loop_stage1_control WHERE name='stage3c_activated_at'").first();
 const paused=await db.prepare("SELECT value FROM closed_loop_stage1_control WHERE name='stage3c_sheet_imports_paused_at'").first();
 if(env.GOOGLE_ADS_UPLOAD_ENABLED!=='true'||env.GOOGLE_ADS_TRANSPORT!=='data_manager_api'||!control||!paused)return {sent:0,disabled:true};
 const rows=await all(db,`SELECT o.*,e.payload_json,e.hold_reasons_json,
  e.market_key AS stage_market_key,e.event_name AS stage_event_name,
  e.request_id AS stage_request_id,e.quote_id AS stage_quote_id,
  e.job_id AS stage_job_id,e.conversion_at AS stage_conversion_at,
  e.value_micros AS stage_value_micros
  FROM google_ads_outcome_outbox o JOIN closed_loop_stage1_events e USING(outcome_id)
  LEFT JOIN closed_loop_google_uploads u ON u.event_id=o.outcome_id
  WHERE e.payload_json IS NOT NULL AND o.outcome_id<>?
  AND ( (o.upload_state='shadow' AND u.event_id IS NULL)
   OR (o.upload_state='retryable' AND u.status='retryable' AND u.auto_retry=1 AND u.next_retry_at<=?))
  ORDER BY e.conversion_at LIMIT ?`,CANARY,now(),limit);
 let sent=0;const skipped=[];
 for(const row of rows){
  const lineage=kcStageOutboxLineageGate(row);
  if(!lineage.ok){skipped.push({event_id:row.outcome_id,error:lineage.reason});continue;}
  let body;try{body=liveRequest(row,control.value);}catch(e){skipped.push({event_id:row.outcome_id,error:e.message});continue;}
  let proof;
  try{proof=await kcWebsiteProofGate(db,row);}catch{proof={ok:false,reason:'kc_paid_source_gate_unavailable'};}
  if(!proof.ok){skipped.push({event_id:row.outcome_id,error:proof.reason});continue;}
  const at=now(),raw=JSON.stringify(body);
  // A single atomic per-event claim prevents racing cron/admin invocations.
  const claim=await db.prepare(`INSERT INTO closed_loop_google_uploads(event_id,market_key,action_id,status,attempt_count,claimed_at,request_json,updated_at) VALUES(?,?,?,'submitting',1,?,?,?) ON CONFLICT(event_id) DO UPDATE SET status='submitting',attempt_count=closed_loop_google_uploads.attempt_count+1,claimed_at=excluded.claimed_at,request_json=excluded.request_json,updated_at=excluded.updated_at,auto_retry=0 WHERE closed_loop_google_uploads.status='retryable' AND closed_loop_google_uploads.auto_retry=1 AND closed_loop_google_uploads.next_retry_at<=? RETURNING attempt_count`).bind(row.outcome_id,row.market_key,row.google_conversion_action,at,raw,at,at).first();
  if(!claim)continue;
  const attempt=claim.attempt_count;
  const fenced=await db.batch([
   db.prepare('INSERT INTO closed_loop_google_upload_attempts(event_id,attempt_number,started_at,request_json) VALUES(?,?,?,?)').bind(row.outcome_id,attempt,at,raw),
   db.prepare("UPDATE google_ads_outcome_outbox SET upload_state='submitted',attempt_count=attempt_count+1,last_attempt_at=?,updated_at=?,google_response_category='DATA_MANAGER_IN_FLIGHT' WHERE outcome_id=? AND upload_state IN ('shadow','retryable')").bind(at,at,row.outcome_id)
  ]);
  if(fenced[1].meta?.changes!==1){await result(db,row.outcome_id,attempt,'retryable',null,'LOCAL_OUTBOX_FENCE_CONFLICT',null);continue;}
  let response,responseRaw;
  try{response=await fetcher('https://datamanager.googleapis.com/v1/events:ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:raw,signal:AbortSignal.timeout(25000)});responseRaw=await response.text();}
  catch{await result(db,row.outcome_id,attempt,'retryable',null,'LOCAL_NETWORK_OR_TIMEOUT_DELIVERY_UNKNOWN',null);continue;}
  const b=parse(responseRaw),requestId=b?.requestId||null;
  await result(db,row.outcome_id,attempt,response.ok&&requestId?'processing':(b?.error?.details||[]).some(d=>duplicateReason(d.reason))?'duplicate_of_sheet_import':'retryable',response.status,responseRaw,requestId);sent++;
 }
 return {sent,skipped};
}
export async function checkDiagnostics(env,token,fetcher=fetch){
 const db=env.ANGI_ROUTER_DB,at=now();
 const rows=await all(db,"SELECT * FROM closed_loop_google_uploads WHERE status='processing' AND request_id IS NOT NULL AND next_diagnostics_at<=? ORDER BY next_diagnostics_at LIMIT 60",at);
 let checked=0;
 for(const row of rows){
  let response,raw;
  try{response=await fetcher('https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId='+encodeURIComponent(row.request_id),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});raw=await response.text();}catch{continue;}
  const state=response.ok?classifyDiagnostics(parse(raw),row.action_id):{status:'processing',error:'DIAGNOSTICS_HTTP_'+response.status};
  const pending=state.status==='processing',retry=state.status==='retryable',done=['accepted','duplicate_of_sheet_import'].includes(state.status),checkedAt=now();
  await db.batch([
   db.prepare('INSERT INTO closed_loop_google_diagnostics VALUES(?,?,?,?,?)').bind(row.event_id,row.request_id,checkedAt,response.status,raw),
   db.prepare('UPDATE closed_loop_google_uploads SET status=?,diagnostics_status=?,diagnostics_raw=?,diagnostics_at=?,next_diagnostics_at=?,completed_at=?,auto_retry=?,next_retry_at=?,error_category=?,updated_at=? WHERE event_id=? AND request_id=?').bind(state.status,response.status,raw,checkedAt,pending?later(300000):null,done?checkedAt:null,retry?1:0,retry?later(86400000):null,state.error,checkedAt,row.event_id,row.request_id),
   db.prepare('UPDATE google_ads_outcome_outbox SET upload_state=?,google_response_category=?,next_retry_at=?,updated_at=? WHERE outcome_id=?').bind(done?'accepted':retry?'retryable':'submitted',state.status==='duplicate_of_sheet_import'?'duplicate_of_sheet_import':state.status==='accepted'?'DATA_MANAGER_SUCCESS':state.error||'DATA_MANAGER_PROCESSING',retry?later(86400000):null,checkedAt,row.event_id)
  ]);checked++;
 }
 return {checked};
}
export async function uploadCycle(env,fetcher=fetch){
 const db=env.ANGI_ROUTER_DB;
 if(env.GOOGLE_ADS_UPLOAD_ENABLED!=='true'||env.GOOGLE_ADS_TRANSPORT!=='data_manager_api')return {disabled:true};
 const lease=String(Date.now()+240000);
 const claim=await run(db,"INSERT INTO closed_loop_stage1_control(name,value,updated_at) VALUES('stage3c_upload_lease',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(closed_loop_stage1_control.value AS INTEGER)<?",lease,now(),Date.now());
 if(!claim.meta?.changes)return {already_running:true};
 try{
  // Interrupted claims are not eligible for an automatic resend.
  await run(db,"UPDATE closed_loop_google_uploads SET status='retryable',auto_retry=0,error_category='INTERRUPTED_DELIVERY_MANUAL_REVIEW',updated_at=? WHERE status='submitting' AND claimed_at<?",now(),new Date(Date.now()-600000).toISOString());
  await run(db,"UPDATE google_ads_outcome_outbox SET upload_state='retryable',google_response_category='INTERRUPTED_DELIVERY_MANUAL_REVIEW',updated_at=? WHERE outcome_id IN (SELECT event_id FROM closed_loop_google_uploads WHERE status='retryable' AND error_category='INTERRUPTED_DELIVERY_MANUAL_REVIEW')",now());
  const token=await access(env,fetcher);
  const diagnostics=await checkDiagnostics(env,token,fetcher);
  const uploads=await submitReady(env,token,fetcher);
  await run(db,"INSERT INTO closed_loop_stage1_control(name,value,updated_at) VALUES('stage3c_last_successful_run_at',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",now(),now());
  return {diagnostics,uploads};
 }finally{await run(db,"DELETE FROM closed_loop_stage1_control WHERE name='stage3c_upload_lease' AND value=?",lease);}
}
export async function uploadHealth(env){
 const db=env.ANGI_ROUTER_DB,since=new Date(Date.now()-86400000).toISOString();
 const rows=await all(db,'SELECT status,count(*) count FROM closed_loop_google_uploads GROUP BY status');
 const counts=Object.fromEntries(rows.map(r=>[r.status,r.count]));
 const uploaded=await db.prepare('SELECT count(*) count FROM closed_loop_google_uploads WHERE submitted_at>=?').bind(since).first();
 const last=await db.prepare("SELECT value FROM closed_loop_stage1_control WHERE name='stage3c_last_successful_run_at'").first();
 const canary=await db.prepare("SELECT count(*) count FROM google_ads_outcome_outbox WHERE outcome_id=? AND upload_state='accepted'").bind(CANARY).first();
 return {uploads_enabled:env.GOOGLE_ADS_UPLOAD_ENABLED==='true',events_uploaded_last_24h:uploaded?.count||0,upload_counts:{accepted:(counts.accepted||0)+(canary?.count||0),failed:counts.retryable||0,duplicate:counts.duplicate_of_sheet_import||0,processing:counts.processing||0,in_flight:counts.submitting||0},last_successful_upload_run_at:last?.value||null};
}
