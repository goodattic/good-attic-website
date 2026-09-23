import { clickIdentifier } from './stage1-model.js';

export const EXTRA_EVENT_IDS = ['gae-slc-sold-65678461','gae-stl-sold-63891747','gae-stl-sold-65203544','gae-stl-assessment-33833856'];
const SECRET_NAMES = ['OAUTH_CLIENT_ID','OAUTH_CLIENT_SECRET','OAUTH_REFRESH_TOKEN'].map(n=>'GOOGLE_DATA_MANAGER_'+n);

export function validationCandidates(baseline, events) {
  const sales=baseline.filter(r=>r.conversion_action==='GAE - Sold Job (CRM)').map(r=>({
    event_id:r.event_id,source:'sheet_baseline',action:'7754270382',
    timestamp:r.conversion_date_time,value:Number(r.conversion_value),...clickIdentifier(r)
  }));
  if(sales.length!==6)throw Error('expected_exactly_six_baseline_sales');
  return [...sales,...EXTRA_EVENT_IDS.map(id=>{
    const e=events.find(e=>e.outcome_id===id),p=e?.payload_json?JSON.parse(e.payload_json):null;
    return {event_id:id,source:'extra_shadow_event',action:e?.event_name==='assessment_completed'?'7754270379':'7754270382',
      timestamp:p?.conversionDateTime,value:p?.conversionValue,...clickIdentifier(p||{})};
  })];
}

export function dataManagerValidationRequest(row) {
  const identifier=clickIdentifier(row);
  if(Object.keys(identifier).length!==1)throw Error('missing_click_identifier');
  // Never infer a timezone from the worker, spreadsheet or account setting.
  if(!/(Z|[+-]\d{2}:\d{2})$/.test(row.timestamp||''))throw Error('explicit_timestamp_offset_required');
  const timestamp=new Date(row.timestamp.replace(' ','T'));
  if(!Number.isFinite(timestamp.getTime()))throw Error('invalid_conversion_time');
  if(!Number.isFinite(row.value)||row.value<0)throw Error('invalid_conversion_value');
  if(!['7754270382','7754270379'].includes(row.action))throw Error('unexpected_validation_action');
  return {
    destinations:[{operatingAccount:{accountType:'GOOGLE_ADS',accountId:'4800890529'},productDestinationId:row.action}],
    events:[{transactionId:row.event_id,eventTimestamp:timestamp.toISOString().replace('.000Z','+00:00').replace('Z','+00:00'),
      adIdentifiers:identifier,currency:'USD',conversionValue:row.value}],
    validateOnly:true
  };
}

// No production-upload branch exists. One event per request gives unambiguous
// per-event synchronous validation even though Data Manager fast-fails batches.
export async function validateDataManagerOnly(rows,env,fetcher=fetch) {
  if(env.GOOGLE_ADS_UPLOAD_ENABLED!=='false')throw Error('stage2_requires_google_upload_disabled');
  const missing=SECRET_NAMES.filter(n=>!env[n]);
  const report={transport:'data_manager_api',validate_only:true,recorded_conversions:0,attempted:false,
    limitation:'Synchronous validation only; Google provides no asynchronous match diagnostics for validateOnly requests.',rows:[]};
  if(missing.length)return {...report,missing_credentials:missing,rows:rows.map(r=>({event_id:r.event_id,result:'NOT_SENT_MISSING_CREDENTIALS'}))};
  const tokenResponse=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
    grant_type:'refresh_token',client_id:env[SECRET_NAMES[0]],client_secret:env[SECRET_NAMES[1]],refresh_token:env[SECRET_NAMES[2]]
  })});
  const token=await tokenResponse.json();
  if(!tokenResponse.ok||!token.access_token)return {...report,oauth_error:token.error||'token_unavailable',rows:rows.map(r=>({event_id:r.event_id,result:'NOT_SENT_OAUTH_FAILURE'}))};
  for(const row of rows){
    let body;try{body=dataManagerValidationRequest(row);}catch(error){report.rows.push({event_id:row.event_id,result:'NOT_SENT_LOCAL_VALIDATION',error:error.message});continue;}
    try{
      report.attempted=true;
      const response=await fetcher('https://datamanager.googleapis.com/v1/events:ingest',{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const raw=await response.text();
      report.rows.push({event_id:row.event_id,result:response.ok?'VALIDATE_ONLY_HTTP_SUCCESS':'GOOGLE_VALIDATION_ERROR',http_status:response.status,google_response_raw:raw});
    }catch{
      report.rows.push({event_id:row.event_id,result:'VALIDATE_ONLY_NETWORK_ERROR'});
    }
  }
  return report;
}
