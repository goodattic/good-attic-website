// Pure identity resolution. This creates no Jobber merge and no upload authority.
import {numericId} from './stage1-model.js';
import {JOBBER_ACCOUNTS} from './google-qualified-phone-collector.js';
export const PLACEHOLDER_ALIAS_POLICY='quo_placeholder_alias_v1';
export const PHONE_ALIAS_FLAG='QUALIFIED_PHONE_PLACEHOLDER_ALIAS_ENABLED';
export const aliasIdEqual=(a,b)=>Boolean(a&&b&&numericId(a)===numericId(b));
export function aliasPhone(value) {
 const n=String(value||'').replace(/(?:ext\.?|x|#)\s*\d+\s*$/i,'').replace(/\D/g,'');
 return /^1\d{10}$/.test(n)?'+'+n:/^\d{10}$/.test(n)?'+1'+n:null;
}
const numbers=c=>[...new Set((c?.phones||[]).map(p=>aliasPhone(p.number||p.value||p)).filter(Boolean))];
const emails=c=>(c?.emails||[]).map(e=>String(e.address||e.value||e).trim().toLowerCase()).filter(Boolean);
const at=t=>Date.parse(t||'');
const market=r=>r.market_key||({utah:'ut',stl:'mo_stl',kc:'mo_kc'}[r.market]);
export const isPhonePlaceholder=(c,phone)=>/^[+\d() .-]+$/.test(String(c?.name||'').trim())&&aliasPhone(c.name)===phone;
const isNamed=c=>/\p{L}{2}/u.test(c?.name||'')&&!/^(?:unknown|new (?:client|customer)|quo (?:caller|client)|test)(?:\b|$)/i.test(c.name);
export function exactPhoneClients(clients,marketKey,phone) {
 return clients.filter(c=>c.market_key===marketKey&&numbers(c).includes(aliasPhone(phone)));
}
export function possiblePlaceholderPair(clients,phone) {
 return clients.length===2&&clients.filter(c=>isPhonePlaceholder(c,phone)).length===1&&clients.filter(isNamed).length===1;
}
export const ALIAS_INTAKE_QUERY=`SELECT operation_id,account_id,market,phone,phone_number_id,operation_state,classification,reason,uncertain,
 client_id,request_id,created_at,updated_at,json_extract(source_json,'$.type') AS source_type,
 json_extract(source_json,'$.id') AS quo_call_id,json_extract(source_json,'$.occurred_at') AS source_at,
 json_extract(source_json,'$.from') AS source_phone,json_extract(source_json,'$.to') AS destination_number,
 json_extract(source_json,'$.direction') AS direction,
 CASE WHEN COALESCE(json_extract(source_json,'$.first_name'),'')<>'' OR COALESCE(json_extract(source_json,'$.last_name'),'')<>'' THEN 1 ELSE 0 END AS source_has_name
 FROM quo_intake_operations WHERE operation_kind='intake' AND request_id IS NOT NULL`;

export function resolvePhonePlaceholderAlias({call,quo,clients=[],objects=[],intakeOperations=[],historicalRequests=[],dispositions=[],now=new Date().toISOString()}) {
 const base={policy:PLACEHOLDER_ALIAS_POLICY,quo_call_id:quo?.quo_call_id||null,
  original_client_id:quo?.jobber_client_id||null,original_request_id:quo?.jobber_request_id||null,
  candidate_client_ids:clients.map(c=>c.id),operational_client_id:null,operation_id:null};
 const hold=reason=>({...base,status:'held',reason});
 if(clients.length===1&&(!quo?.jobber_client_id||aliasIdEqual(clients[0].id,quo.jobber_client_id)))return {...base,status:'original',reason:null,operational_client_id:clients[0].id};
 const caller=aliasPhone(quo?.caller_phone),when=at(call?.start_call_date_time),mk=call?.market_key;
 if(!caller||!Number.isFinite(when)||!JOBBER_ACCOUNTS[mk])return hold('alias_source_invalid');
 if(!possiblePlaceholderPair(clients,caller))return hold('multiple_jobber_clients');
 const shell=clients.find(c=>isPhonePlaceholder(c,caller)),named=clients.find(isNamed);
 if(clients.some(c=>c.market_key!==mk||!numbers(c).includes(caller)))return hold('alias_market_or_phone_conflict');
 if(quo.jobber_client_id&&!aliasIdEqual(quo.jobber_client_id,shell.id))return hold('alias_original_client_conflict');
 const rows=intakeOperations.filter(r=>r.quo_call_id===quo.quo_call_id&&market(r)===mk);
 if(rows.length!==1)return hold(rows.length?'alias_intake_conflict':'alias_intake_proof_missing');
 const p=rows[0];
 if(p.classification!=='eligible_new_client'||Number(p.uncertain)!==0||p.source_type!=='call'||Number(p.source_has_name)!==0
  ||!['completed','request_created','note_creating','note_created'].includes(p.operation_state)
  ||p.direction!=='incoming'||aliasPhone(p.phone)!==caller||aliasPhone(p.source_phone)!==caller
  ||!aliasIdEqual(p.account_id,JOBBER_ACCOUNTS[mk])||!aliasIdEqual(p.client_id,shell.id)||!p.request_id
  ||quo.jobber_request_id&&!aliasIdEqual(p.request_id,quo.jobber_request_id)
  ||p.phone_number_id!==quo.phone_number_id||aliasPhone(p.destination_number)!==aliasPhone(quo.destination_number)
  ||!Number.isFinite(at(p.source_at))||Math.abs(at(p.source_at)-at(quo.call_started_at_utc))>1000
  ||!Number.isFinite(at(p.created_at))||at(p.created_at)<when||at(p.created_at)>at(now)
  ||!Number.isFinite(at(p.updated_at))||at(shell.createdAt)<at(p.created_at)-1000||at(shell.createdAt)>at(p.updated_at))return hold('alias_intake_proof_conflict');
 base.original_client_id=shell.id;base.original_request_id=p.request_id;base.operation_id=p.operation_id;
 if(clients.some(c=>c.history_complete!==true||c.alias_identity_complete!==true))return hold('alias_history_incomplete');
 if(clients.some(c=>!Number.isFinite(at(c.createdAt))))return hold('alias_identity_time_missing');
 const group=objects.filter(o=>o.market_key===mk&&clients.some(c=>aliasIdEqual(c.id,o.client_id||o.object?.client?.id)));
 const older=value=>Number.isFinite(at(value))&&at(value)<when;
 const historic=historicalRequests.filter(r=>market(r)===mk&&(clients.some(c=>aliasIdEqual(c.id,r.client_id))||aliasPhone(r.phone)===caller
  ||r.email&&clients.some(c=>emails(c).includes(String(r.email).trim().toLowerCase()))));
 if(group.some(o=>!Number.isFinite(at(o.object?.createdAt)))||historic.some(r=>!Number.isFinite(at(r.created_at))))return hold('alias_history_incomplete');
 if(clients.some(c=>older(c.createdAt)||(c.alias_invoice_dates||[]).some(older))||group.some(o=>older(o.object?.createdAt))||historic.some(r=>older(r.created_at)))return hold('alias_earlier_history');
 if(numbers(shell).some(n=>n!==caller)||emails(shell).some(e=>!emails(named).includes(e))
  ||(shell.alias_address_fingerprints||[]).some(a=>!(named.alias_address_fingerprints||[]).includes(a)))return hold('alias_identity_conflict');
 if(dispositions.some(d=>d.market_key===mk&&aliasIdEqual(d.request_id,p.request_id)))return hold('alias_original_excluded');
 const shellHistory=group.filter(o=>aliasIdEqual(o.client_id||o.object?.client?.id,shell.id));
 if(shell.alias_invoice_dates?.length||shellHistory.some(o=>o.object_type!=='request'||!aliasIdEqual(o.object_id,p.request_id)
  ||o.object?.assessment?.id||o.object?.quotes?.nodes?.length||o.object?.jobs?.nodes?.length)
  ||historic.some(r=>aliasIdEqual(r.client_id,shell.id)&&!aliasIdEqual(r.request_id,p.request_id)))return hold('alias_independent_placeholder_history');
 // Archived source shells are permitted; operational qualification still requires
 // an active named client/request. Never erase the original source identities.
 return {...base,status:'resolved',reason:null,operational_client_id:named.id,alias_client_ids:[shell.id]};
}
