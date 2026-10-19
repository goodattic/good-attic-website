import {numericId} from './stage1-model.js';
import {JOBBER_ACCOUNTS} from './google-qualified-phone-collector.js';
import {readClientWorkScopes,requestScopeFromObject} from './service-scope-reader.js';
import {SERVICE_SCOPE_POLICY,serviceScopeFromText,combineServiceScopes,scopeForPerson,scopeAllowsCredit} from './lead-service-scope.js';
import {qualifiedReaderFailure} from './qualified-phone-reader-diagnostics.js';
export const PHONE_SCOPE_FLAG='QUALIFIED_PHONE_SERVICE_SCOPE_ENABLED';
export function phoneScopeDecision(inquiry,work=[]) {
  const scope=scopeForPerson(inquiry,work);
  return {ok:scopeAllowsCredit(scope),reason:scope.state==='off_scope_only'?'scope_off_scope_only':scope.state==='unknown'?'scope_evidence_missing':null,scope};
}
// Reads are allowlisted here; the only writes below are service-code history in
// the independently migrated local/live DB. No external mutation is possible.
export async function verifyQualifiedPhoneScope(env,{call,quo,request,sourceRequests=[],clientId,evidence,accessToken,fetcher=fetch}) {
  if(env[PHONE_SCOPE_FLAG]!=='true')return {ok:true,disabled:true};
  const diagnostic={step:'scope_inquiry',api:null,table:null,http_status:null};
  try {
    const gql=async(_market,query,variables)=>{
      Object.assign(diagnostic,{step:'scope_jobber_work',api:'jobber',table:null,http_status:null});
      if(!/^query\b/.test(query)||/\bmutation\b/.test(query))throw Error('scope_read_only');
      const r=await fetcher('https://api.getjobber.com/api/graphql',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','X-JOBBER-GRAPHQL-VERSION':'2025-04-16'},body:JSON.stringify({query,variables}),redirect:'manual',signal:AbortSignal.timeout(20000)});
      diagnostic.http_status=r.status;if(r.status>=300&&r.status<400)throw Error('reader_external_redirect_blocked');
      const b=await r.json();if(!r.ok||b.errors?.length||!b.data)throw Error('scope_jobber_read_failed');return b.data;
    };
    const qget=async(path)=>{
      Object.assign(diagnostic,{step:path.startsWith('call-summaries/')?'scope_quo_summary':'scope_quo_transcript',api:'quo',table:null,http_status:null});
      if(!env.QUO_API_KEY)throw Error('scope_quo_key_missing');
      const r=await fetcher(`https://api.quo.com/v1/${path}`,{headers:{Authorization:env.QUO_API_KEY},redirect:'manual',signal:AbortSignal.timeout(20000)});
      diagnostic.http_status=r.status;if(r.status>=300&&r.status<400)throw Error('reader_external_redirect_blocked');
      if(r.status===404)return null;if(!r.ok)throw Error('scope_quo_read_failed');return (await r.json()).data;
    };
    const ids=[quo.quo_call_id,evidence?.startsWith('quo_two_way:')?evidence.slice('quo_two_way:'.length):null].filter(Boolean);
    const inquiry=[requestScopeFromObject(request),...sourceRequests.map(requestScopeFromObject)];
    for(const id of new Set(ids)) {
      if(!/^AC[\w-]+$/.test(id))throw Error('scope_call_id_invalid');
      const summary=await qget(`call-summaries/${id}`),transcript=await qget(`call-transcripts/${id}`);
      inquiry.push(serviceScopeFromText((summary?.summary||[]).join(' '),`quo-summary:${id}`));
      inquiry.push(serviceScopeFromText((transcript?.dialogue||[]).filter(d=>d.identifier===quo.caller_phone&&!d.userId).map(d=>d.content||'').join(' '),`quo-transcript:${id}`));
    }
    const current=await readClientWorkScopes({gql,market:call.market_key,accountId:JOBBER_ACCOUNTS[call.market_key],clientId});
    const db=env.ANGI_ROUTER_DB;
    Object.assign(diagnostic,{step:'scope_read_history',api:'d1',table:'qualified_phone_scope_work',http_status:null});
    const saved=(await db.prepare('SELECT scope_json FROM qualified_phone_scope_work WHERE market_key=? AND client_id=?').bind(call.market_key,numericId(clientId)).all()).results||[];
    const retained=saved.map(r=>JSON.parse(r.scope_json)).filter(s=>s.policy===SERVICE_SCOPE_POLICY&&s.in_scope_evidence===true);
    Object.assign(diagnostic,{step:'scope_persist_history'});
    for(const s of current.filter(s=>s.in_scope_evidence))await db.prepare(`INSERT INTO qualified_phone_scope_work(market_key,client_id,object_type,object_id,scope_json,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(market_key,client_id,object_type,object_id) DO UPDATE SET scope_json=excluded.scope_json,last_seen_at=excluded.last_seen_at`)
      .bind(call.market_key,numericId(clientId),s.object_type,numericId(s.object_id),JSON.stringify(s),new Date().toISOString(),new Date().toISOString()).run();
    Object.assign(diagnostic,{step:'scope_decision',api:null,table:null,http_status:null});
    return phoneScopeDecision(combineServiceScopes(...inquiry),[...retained,...current]);
  }catch(error){return {ok:false,reason:'scope_read_unavailable',reader_failure:qualifiedReaderFailure(error,diagnostic)};}
}
