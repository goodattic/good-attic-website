import {JOBBER_ACCOUNTS,matchJobberLead} from './google-qualified-phone-collector.js';
import {jobberLeadProof} from './qualified-phone-proof.js';
import {ALIAS_INTAKE_QUERY,PHONE_ALIAS_FLAG,resolvePhonePlaceholderAlias,aliasIdEqual} from './phone-placeholder-alias.js';
import {readAliasCandidates} from './phone-placeholder-alias-reader.js';
import {qualifiedAliasFailure} from './qualified-phone-alias-diagnostics.js';
const all=async(db,q)=>(await db.prepare(q).all()).results||[];
export const ALIAS_HISTORY_SQL=`SELECT market_key,object_type,object_id,client_id,
 json_extract(object_json,'$.createdAt') AS created_at,
 json_extract(object_json,'$.assessment.id') AS assessment_id,
 json_array_length(json_extract(object_json,'$.quotes.nodes')) AS quote_count
 FROM closed_loop_stage1_objects`;
export function aliasHistoricalObjects(rows) {
 return rows.map(r=>({market_key:r.market_key,object_type:r.object_type,object_id:r.object_id,client_id:r.client_id,current_present:false,
  object:{id:r.object_id,createdAt:r.created_at,assessment:r.assessment_id?{id:r.assessment_id}:null,
   quotes:{nodes:Number(r.quote_count)>0?[{id:'historical-quote'}]:[]}}}));
}
export function aliasOperationalRequest({resolution,call,quo,clients,objects,dispositions=[]}) {
 const client=clients.find(c=>aliasIdEqual(c.id,resolution.operational_client_id));
 const candidates=objects.filter(o=>o.market_key===call.market_key&&o.object_type==='request'&&o.current_present!==false&&aliasIdEqual(o.client_id,client?.id))
  .map(o=>({object:o.object,proof:jobberLeadProof({request:o.object,client,disposition:dispositions.find(d=>d.market_key===call.market_key&&aliasIdEqual(d.request_id,o.object_id))})}))
  .filter(p=>p.proof.ok&&matchJobberLead({callerPhone:quo.caller_phone,googleCallAt:call.start_call_date_time,marketKey:call.market_key,
   records:[{market_key:call.market_key,phone:quo.caller_phone,created_at:p.object.createdAt}]}).ok);
 const milestones=candidates.filter(p=>p.proof.milestone),choices=milestones.length?milestones:candidates;
 return choices.length===1?{ok:true,request:choices[0].object,client}:
  {ok:false,reason:choices.length?'alias_multiple_operational_requests':'alias_operational_request_unavailable'};
}
export async function readQualifiedPhoneAlias(env,{call,quo,accessToken,fetcher=fetch}) {
 if(env[PHONE_ALIAS_FLAG]!=='true')return {ok:true,disabled:true};
 const diagnostic={step:'jobber_candidates',api:'jobber',table:null,http_status:null};
 try {
  const gql=async(_market,query,variables)=>{
   if(!/^query\b/.test(query)||/\bmutation\b/i.test(query))throw Error('alias_read_only');
   diagnostic.step=query.includes('AliasIdentity')?'jobber_identity':query.includes('AliasHistory')?'jobber_history':'jobber_candidates';
   diagnostic.http_status=null;
   const r=await fetcher('https://api.getjobber.com/api/graphql',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','X-JOBBER-GRAPHQL-VERSION':'2025-04-16'},body:JSON.stringify({query,variables}),redirect:'manual',signal:AbortSignal.timeout(20000)});
   diagnostic.http_status=r.status;
   if(r.status>=300&&r.status<400)throw Error('alias_external_redirect_blocked');
   const b=await r.json();if(!r.ok||b.errors?.length||!b.data)throw Error('alias_jobber_read_failed');return b.data;
  };
  const data=await readAliasCandidates({gql,marketKey:call.market_key,accountId:JOBBER_ACCOUNTS[call.market_key],callerPhone:quo.caller_phone,originalClientId:quo.jobber_client_id});
  const db=env.ANGI_ROUTER_DB;
  const read=async(table,query)=>{Object.assign(diagnostic,{step:'read_evidence',api:'d1',table,http_status:null});return all(db,query);};
  const intakeOperations=await read('quo_intake_operations',ALIAS_INTAKE_QUERY);
  const dispositions=await read('closed_loop_lead_dispositions','SELECT market_key,request_id,disposition FROM closed_loop_lead_dispositions');
  const history=aliasHistoricalObjects(await read('closed_loop_stage1_objects',ALIAS_HISTORY_SQL));
  Object.assign(diagnostic,{step:'resolve_alias',api:null,table:null,http_status:null});
  const historicalRequests=intakeOperations.map(r=>({...r,market_key:({utah:'ut',stl:'mo_stl',kc:'mo_kc'})[r.market]}));
  const resolution=resolvePhonePlaceholderAlias({call,quo,...data,objects:[...data.objects,...history],intakeOperations,historicalRequests,dispositions});
  let operational=null;
  if(resolution.status==='resolved') {
   operational=aliasOperationalRequest({resolution,call,quo,...data,dispositions});
   if(!operational.ok){resolution.status='held';resolution.reason=operational.reason;}
   else resolution.operational_request_id=operational.request.id;
  }
  if(resolution.status==='original')resolution.operational_request_id=quo.jobber_request_id;
  const timestamp=new Date().toISOString();
  Object.assign(diagnostic,{step:'persist_resolution',api:'d1',table:'qualified_phone_alias_resolutions'});
  const old=await db.prepare('SELECT original_client_id,original_request_id FROM qualified_phone_alias_resolutions WHERE google_resource=?').bind(call.google_resource).first();
  const unchanged=(a,b)=>a==null&&b==null||aliasIdEqual(a,b);
  if(old&&(!unchanged(old.original_client_id,resolution.original_client_id)||!unchanged(old.original_request_id,resolution.original_request_id)))return {ok:false,reason:'alias_original_lineage_changed'};
  await db.prepare(`INSERT INTO qualified_phone_alias_resolutions(google_resource,market_key,status,reason,original_client_id,original_request_id,
    operational_client_id,operational_request_id,evidence_json,first_seen_at,last_checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(google_resource) DO UPDATE SET status=excluded.status,reason=excluded.reason,operational_client_id=excluded.operational_client_id,
    operational_request_id=excluded.operational_request_id,evidence_json=excluded.evidence_json,last_checked_at=excluded.last_checked_at`)
   .bind(call.google_resource,call.market_key,resolution.status,resolution.reason,resolution.original_client_id,resolution.original_request_id,
    resolution.operational_client_id,resolution.operational_request_id||null,JSON.stringify(resolution),timestamp,timestamp).run();
  return resolution.status==='held'?{ok:false,reason:resolution.reason,resolution}:{ok:true,resolution,operational};
 }catch(error){
  const failure=qualifiedAliasFailure(error,diagnostic);
  console.error(JSON.stringify({qualified_phone_alias_failure:failure}));
  return {ok:false,reason:'alias_read_unavailable',alias_failure:failure};
 }
}
