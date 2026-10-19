import { googleToken, readGoogleCalls, denverTime } from './qualified-phone-runtime.js';
import { quoConversationProof } from './qualified-phone-proof.js';
import { JOBBER_ACCOUNTS, googleCallEligible } from './google-qualified-phone-collector.js';
import { numericId } from './stage1-model.js';
import { evaluateLeadWatch, mergeQuoEvidence, phone,
  exclusionFromText, maskPaymentText, WATCH_INTERVAL_MS, WATCH_LOOKBACK_MS } from './phone-lead-watch-model.js';
import { serviceScopeFromText, combineServiceScopes, SERVICE_SCOPE_POLICY } from './lead-service-scope.js';
import {readWorkScope,REQUEST_SCOPE_FIELDS,requestScopeFromObject} from './service-scope-reader.js';
import {ALIAS_INTAKE_QUERY,possiblePlaceholderPair} from './phone-placeholder-alias.js';
import {readAliasIdentity} from './phone-placeholder-alias-reader.js';
import {watchFailure,watchStep,watchTable,watchApi} from './phone-lead-watch-diagnostics.js';

export const PHONE_LEAD_WATCH_FLAG = 'PHONE_LEAD_WATCH_ENABLED';
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const marketKeys = {ut:'utah',mo_stl:'stl',mo_kc:'kc'};

/** All external traffic, including injected transports, passes this read fence. */
export function readOnlyTransport(fetcher = fetch) {
  return async (url, options = {}) => {
    const u = new URL(url), method = (options.method || 'GET').toUpperCase();
    const oauth = u.origin === 'https://oauth2.googleapis.com' && u.pathname === '/token' && method === 'POST';
    const ads = u.origin === 'https://googleads.googleapis.com' && /^\/v\d+\/customers\/4800890529\/googleAds:searchStream$/.test(u.pathname) && method === 'POST';
    const quo = u.origin === 'https://api.quo.com' && u.pathname.startsWith('/v1/') && method === 'GET';
    let jobber = false;
    if (u.origin === 'https://api.getjobber.com' && u.pathname === '/api/graphql' && method === 'POST') {
      const query = JSON.parse(options.body || '{}').query;
      jobber = /^\s*query\b/.test(query || '') && !/\bmutation\b/i.test(query);
    }
    if (!oauth && !ads && !quo && !jobber) throw Error('watch_external_write_blocked');
    // workerd rejects redirect:'error' before issuing any request. Manual mode
    // plus an explicit rejection preserves the no-redirect read fence.
    const response=await fetcher(url, {...options,redirect:'manual',signal:options.signal || AbortSignal.timeout(20000)});
    if(response.status>=300&&response.status<400) {
      const error=Error('watch_external_redirect_blocked');
      error.watchHttpStatus=response.status;
      throw error;
    }
    return response;
  };
}

export const WATCH_CLIENT_QUERY = 'query($after:String){account{id} clients(first:100,after:$after){nodes{id name lastName createdAt isArchived phones{number} emails{address}}pageInfo{hasNextPage endCursor}}}';
const requestFields = 'id createdAt updatedAt requestStatus assessment{id startAt endAt isComplete completedAt} quotes(first:1){nodes{id}}';
export const WATCH_REQUEST_SCOPE_QUERY = `query($id:EncodedId!){request(id:$id){id ${REQUEST_SCOPE_FIELDS}}}`;
const quoteFields = 'id createdAt updatedAt quoteStatus amounts{total} lastTransitioned{approvedAt convertedAt} request{id} client{id}';
const jobFields = `id createdAt updatedAt jobStatus total request{id} client{id} quote{${quoteFields}}`;
const clientFields = 'id name lastName createdAt isArchived phones{number} emails{address}';
const detailQuery = `query($id:EncodedId!,$requestsAfter:String,$quotesAfter:String,$jobsAfter:String){client(id:$id){${clientFields}
 requests(first:20,after:$requestsAfter){nodes{${requestFields}}pageInfo{hasNextPage endCursor}}
 quotes(first:20,after:$quotesAfter){nodes{${quoteFields}}pageInfo{hasNextPage endCursor}}
 jobs(first:20,after:$jobsAfter){nodes{${jobFields}}pageInfo{hasNextPage endCursor}}}}`;
const parse = (text, fallback = null) => {try{return JSON.parse(text);}catch{return fallback;}};
const key = o => `${o.market_key}:${o.object_type}:${numericId(o.object_id)}`;

export const requestServiceScope=requestScopeFromObject;

// No notes, summaries, transcripts, address or payment fields are persisted.
export async function loadLeadWatchSnapshot(env, {since, now, fetcher = fetch, googleCalls: suppliedCalls,diagnostics = {step:'snapshot'}} = {}) {
  const transport = readOnlyTransport(fetcher), db = env.ANGI_ROUTER_DB;
  const all = (db,sql,...args) => watchStep({step:'snapshot.database',api:'d1',table:watchTable(sql)},async()=>
    (await db.prepare(sql).bind(...args).all()).results || []);
  const wire = async (url,options) => {
    const context={step:diagnostics.step,api:watchApi(url)};
    const r=await watchStep(context,()=>transport(url,options));
    // Quo's optional 404 and bounded 429 retries retain their existing behavior.
    if(!r.ok && ['google_oauth','google_ads'].includes(context.api))
      throw watchFailure(Error(context.api==='google_ads'?`GOOGLE_CALL_READ_HTTP_${r.status}`:
        context.api==='google_oauth'?'ADS_TOKEN_REFRESH_FAILED':context.api==='jobber'?'watch_jobber_read_failed':'watch_quo_read_failed'),{...context,http_status:r.status});
    return r;
  };
  const auth = await all(db, "SELECT account_key,access_token FROM angi_router_jobber_auth WHERE account_key IN ('utah','stl','kc')");
  const gql = async (market, query, variables) => {
    const token = auth.find(a=>a.account_key===marketKeys[market])?.access_token;
    if (!token) throw Error('watch_jobber_auth_unavailable');
    for(let attempt=0;attempt<3;attempt++) {
      const r = await wire('https://api.getjobber.com/api/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-JOBBER-GRAPHQL-VERSION':'2025-04-16'},body:JSON.stringify({query,variables})});
      const b = await watchStep({step:diagnostics.step,api:'jobber',http_status:r.status},()=>r.json());
      if(b.errors?.length && b.errors.every(e=>e.extensions?.code==='THROTTLED') && attempt<2) {
        await new Promise(resolve=>setTimeout(resolve,2000*(attempt+1)));continue;
      }
      if (!r.ok || b.errors || !b.data) throw watchFailure(Error('watch_jobber_read_failed'),{step:diagnostics.step,api:'jobber',http_status:r.status});
      return b.data;
    }
  };
  const qread = async (path, params = {}, optional = false) => {
    const url = new URL(`https://api.quo.com/v1/${path}`);
    for (const [k,v] of Object.entries(params)) if(v != null) url.searchParams.set(k,v);
    let r;
    for(let attempt=0;attempt<4;attempt++) {
      r=await wire(url.toString(),{headers:{Authorization:env.QUO_API_KEY}});
      if(r.status!==429 || attempt===3)break;
      const seconds=Number(r.headers.get('Retry-After')??(attempt+1));
      await new Promise(resolve=>setTimeout(resolve,Math.min(20000,Math.max(0,Number.isFinite(seconds)?seconds*1000:1000))));
    }
    if (optional && r.status === 404) return {data:null};
    if (!r.ok) throw watchFailure(Error('watch_quo_read_failed'),{step:diagnostics.step,api:'quo',http_status:r.status});
    return watchStep({step:diagnostics.step,api:'quo',http_status:r.status},()=>r.json());
  };
  const persisted = await all(db, "SELECT evidence_json FROM phone_lead_watch_sources WHERE state IN ('matched','pending','excluded','manual_review')");
  const oldSources = persisted.map(r=>parse(r.evidence_json)).filter(Boolean);
  let googleCalls = suppliedCalls;
  if(!googleCalls) {
    diagnostics.step='snapshot.google_token';
    const token=await watchStep({step:diagnostics.step,api:'google_oauth'},()=>googleToken(env,wire));
    diagnostics.step='snapshot.google_calls';
    googleCalls=await watchStep({step:diagnostics.step,api:'google_ads'},()=>readGoogleCalls(token,since,wire));
  }
  for(const old of oldSources) if(old.path==='call' && old.google && !googleCalls.some(c=>c.google_resource===old.key)
    && (old.state==='pending' || (old.state==='matched'||old.quo&&old.client_ids?.length===1)&&Date.parse(now)-Date.parse(old.at)<=90*86400000)) googleCalls.push(old.google);
  const [attributions, capture, rawObjects, rawLeads, originals, historicalRequests, dispositions, ledger, outbox, phoneLedger] = await Promise.all([
    all(db,'SELECT * FROM quo_call_attributions'), all(db,'SELECT * FROM quo_call_capture_stage'),
    all(db,'SELECT * FROM closed_loop_stage1_objects'), all(db,'SELECT * FROM closed_loop_stage1_leads'),
    all(db,'SELECT jobber_request_id,jobber_client_id,market_key,service FROM closed_loop_leads'),
    all(db,"SELECT client_id,request_id,phone,created_at,CASE market WHEN 'utah' THEN 'ut' WHEN 'stl' THEN 'mo_stl' WHEN 'kc' THEN 'mo_kc' END AS market_key FROM quo_intake_operations WHERE request_id IS NOT NULL"),
    all(db,'SELECT market_key,request_id,disposition FROM closed_loop_lead_dispositions'),
    all(db,'SELECT event_id,market_key,status,error_category,response_raw FROM closed_loop_google_uploads'),
    all(db,'SELECT outcome_id AS event_id,market_key,event_name,jobber_quote_id,jobber_appointment_id,upload_state,google_call_key,caller_phone,diagnostic_code FROM google_ads_outcome_outbox'),
    all(db,'SELECT google_resource,outcome_id,state,diagnostic_code,response_json FROM qualified_phone_calls'),
  ]);
  const objects = rawObjects.map(({object_json,...o})=>({...o,object:parse(object_json)})).filter(o=>o.object);
  const intakeOperations=await all(db,ALIAS_INTAKE_QUERY);
  const quoCalls = mergeQuoEvidence(attributions,capture,oldSources.map(s=>s.quo).filter(Boolean));
  const clients = [], contacts = [];
  // Page to exhaustion. A repeated cursor or failed page aborts the cycle;
  // incomplete catalogs must never appear to contain a unique client.
  diagnostics.step='snapshot.jobber_clients';
  for(const market of Object.keys(JOBBER_ACCOUNTS)) {
    let after=null;const seen=new Set();
    do {
      const b=await gql(market,WATCH_CLIENT_QUERY,{after});
      if(numericId(b.account?.id)!==JOBBER_ACCOUNTS[market])throw Error('watch_account_mismatch');
      if(!b.clients?.pageInfo||!Array.isArray(b.clients.nodes))throw Error('watch_clients_incomplete');
      clients.push(...b.clients.nodes.map(c=>({...c,market_key:market})));
      after=b.clients.pageInfo.hasNextPage?b.clients.pageInfo.endCursor:null;
      if(after&&seen.has(after)||b.clients.pageInfo.hasNextPage&&!after)throw Error('watch_client_cursor_invalid');
      seen.add(after);
    }while(after);
  }
  diagnostics.step='snapshot.quo_contacts';
  let pageToken=null;const seenContacts=new Set();
  do {
    const b=await qread('contacts',{maxResults:50,pageToken});
    if(!Array.isArray(b.data))throw Error('watch_contacts_incomplete');
    contacts.push(...b.data.map(c=>({id:c.id,phones:(c.defaultFields?.phoneNumbers||[]).map(p=>p.value)})));
    pageToken=b.nextPageToken||null;
    if(pageToken&&seenContacts.has(pageToken))throw Error('watch_contact_cursor_invalid');
    seenContacts.add(pageToken);
  }while(pageToken);
  diagnostics.step='snapshot.prepare_leads';
  const leads = rawLeads.filter(l=>[l.gclid,l.gbraid,l.wbraid].some(Boolean) && Date.parse(l.inquiry_at)>=Date.parse(now)-90*86400000)
    .map(l=>({...l,client_id:originals.find(o=>o.market_key===l.market_key&&o.jobber_request_id===l.request_id)?.jobber_client_id
      || objects.find(o=>o.market_key===l.market_key&&o.object_type==='request'&&o.object_id===l.request_id)?.client_id}));
  for(const lead of leads) {
    const old=oldSources.find(s=>s.path==='click'&&s.market_key===lead.market_key&&s.lead?.request_id===lead.request_id)?.lead;
    const client=clients.find(c=>c.market_key===lead.market_key&&c.id===lead.client_id);
    lead.phones=client?(client.phones||[]).map(p=>phone(p.number)).filter(Boolean):old?.phones||[];
    lead.emails=client?(client.emails||[]).map(p=>p.address?.trim().toLowerCase()).filter(Boolean):old?.emails||[];
    lead.client_id ||= old?.client_id;
    lead.service_scope=combineServiceScopes(old?.service_scope?.policy===SERVICE_SCOPE_POLICY?old.service_scope:null,
      serviceScopeFromText(originals.find(o=>o.market_key===lead.market_key&&numericId(o.jobber_request_id)===numericId(lead.request_id))?.service,
        `closed_loop_leads:${numericId(lead.request_id)}`));
  }
  let provisional = evaluateLeadWatch({googleCalls,quoCalls,contacts,clients,leads,now});
  const wanted = new Set(provisional.sources.flatMap(s=>s.client_ids.map(id=>`${s.market_key}:${id}`)));
  diagnostics.step='snapshot.jobber_history';
  for(const c of clients.filter(c=>wanted.has(`${c.market_key}:${c.id}`))) {
    for(const old of objects.filter(o=>o.market_key===c.market_key&&o.client_id===c.id))old.current_present=false;
    const cursors={requestsAfter:null,quotesAfter:null,jobsAfter:null},seen=new Set(),collected=new Map();
    let more=true;
    while(more) {
      const b=await gql(c.market_key,detailQuery,{id:c.id,...cursors});
      if(!b.client)throw Error('watch_client_disappeared');
      Object.assign(c,Object.fromEntries(Object.entries(b.client).filter(([k])=>!['requests','quotes','jobs'].includes(k))));
      more=false;
      for(const type of ['request','quote','job']) {
        const conn=b.client[type+'s'];
        if(!conn?.pageInfo||!Array.isArray(conn.nodes))throw Error('watch_history_incomplete');
        for(const raw of conn.nodes) {
          const {title,notes,requestDetails,...obj}=raw;
          collected.set(`${type}:${obj.id}`,{market_key:c.market_key,object_type:type,object_id:obj.id,client_id:c.id,current_present:true,
            ...(type==='request'?{service_scope:requestServiceScope(raw)}:{}),object:{...obj,client:{id:c.id}}});
        }
        if(conn.pageInfo.hasNextPage) {more=true;const k=type+':'+conn.pageInfo.endCursor;if(!conn.pageInfo.endCursor||seen.has(k))throw Error('watch_history_cursor_invalid');seen.add(k);cursors[type+'sAfter']=conn.pageInfo.endCursor;}
      }
    }
    c.history_complete=true;
    for(const row of collected.values()) {const old=objects.find(o=>key(o)===key(row));if(old)Object.assign(old,row);else objects.push(row);}
  }
  const aliasCandidates=new Set(provisional.sources.filter(s=>s.path==='call'&&s.quo)
    .filter(s=>possiblePlaceholderPair(clients.filter(c=>s.client_ids.includes(c.id)&&c.market_key===s.market_key),phone(s.quo.caller_phone)))
    .flatMap(s=>s.client_ids.map(id=>`${s.market_key}:${id}`)));
  diagnostics.step='snapshot.jobber_alias_identity';
  for(const c of clients.filter(c=>aliasCandidates.has(`${c.market_key}:${c.id}`)))Object.assign(c,await readAliasIdentity({gql,marketKey:c.market_key,accountId:JOBBER_ACCOUNTS[c.market_key],clientId:c.id}));
  const exclusions=[],qualifications={},serviceScopes={},requestScopes=new Map();
  provisional=evaluateLeadWatch({googleCalls,quoCalls,contacts,clients,objects,leads,intakeOperations,historicalRequests,dispositions,now});
  diagnostics.step='snapshot.jobber_work_scope';
  const workSeen=new Set();
  for(const row of objects.filter(o=>['quote','job'].includes(o.object_type)&&wanted.has(`${o.market_key}:${o.client_id}`)
    &&Date.parse(o.object.createdAt)<=Date.parse(now))) {
    const k=key(row);if(workSeen.has(k))continue;workSeen.add(k);
    const scope=await readWorkScope({gql,market:row.market_key,accountId:JOBBER_ACCOUNTS[row.market_key],
      clientId:row.client_id,type:row.object_type,id:row.object_id});
    if(scope)row.service_scope=scope;
    else if(row.current_present!==false)throw Error('scope_record_disappeared');
  }
  diagnostics.step='snapshot.jobber_request_scope';
  for(const s of provisional.sources.filter(s=>s.path==='click')) {
    const scopeRequests=[s.lead.request_id,...objects.filter(o=>o.market_key===s.market_key&&o.object_type==='request'&&o.current_present!==false
      &&s.client_ids.includes(o.client_id)&&Date.parse(o.object.createdAt)>=Date.parse(s.at)-1000).map(o=>o.object_id)];
    for(const id of [...new Set(scopeRequests)]) {
      const key=`${s.market_key}:${numericId(id)}`;
      if(!requestScopes.has(key)) {
        const data=await gql(s.market_key,WATCH_REQUEST_SCOPE_QUERY,{id});
        requestScopes.set(key,data.request?requestServiceScope(data.request):serviceScopeFromText(''));
      }
      const o=objects.find(o=>o.market_key===s.market_key&&o.object_type==='request'&&numericId(o.object_id)===numericId(id));
      if(o)o.service_scope=requestScopes.get(key);
    }
    const original=objects.find(o=>o.market_key===s.market_key&&o.object_type==='request'&&numericId(o.object_id)===numericId(s.lead.request_id));
    // Requests contribute inquiry evidence. Quote/job evidence is combined by
    // the model for the same person and market, including split requests.
    const primary=combineServiceScopes(s.lead.service_scope,original?.service_scope||requestScopes.get(`${s.market_key}:${numericId(s.lead.request_id)}`));
    const siblings=objects.filter(o=>o.market_key===s.market_key&&o.object_type==='request'&&o.current_present!==false
      &&s.client_ids.includes(o.client_id)&&Date.parse(o.object.createdAt)>=Date.parse(s.at)-1000);
    serviceScopes[s.key]=combineServiceScopes(primary,...siblings.map(o=>o.service_scope));
    s.lead.service_scope=serviceScopes[s.key];
  }
  diagnostics.step='snapshot.quo_call_evidence';
  for(const s of provisional.sources.filter(s=>s.path==='call'&&s.quo)) {
    const summary=await qread('call-summaries/'+s.quo.quo_call_id,{},true);
    const t=await qread('call-transcripts/'+s.quo.quo_call_id,{},true);
    const callerText=(t.data?.dialogue||[]).filter(d=>d.identifier===s.quo.caller_phone&&!d.userId).map(d=>d.content||'').join(' ');
    const callerScope=serviceScopeFromText(callerText,`quo-transcript:${s.quo.quo_call_id}`);
    const summaryScope=serviceScopeFromText((summary.data?.summary||[]).join(' '),`quo-summary:${s.quo.quo_call_id}`);
    serviceScopes[s.key]=combineServiceScopes(callerScope,summaryScope);
    let kind=exclusionFromText((summary.data?.summary||[]).join(' '));
    if(!kind)kind=exclusionFromText((t.data?.dialogue||[]).map(d=>d.content||'').join(' '));
    if(kind) exclusions.push({market_key:s.market_key,phone:s.quo.caller_phone,quo_call_id:s.quo.quo_call_id,kind});
    if(googleCallEligible(s.google)&&s.client_ids.length===1) {
      const proof=await quoConversationProof({apiKey:env.QUO_API_KEY,callerPhone:s.quo.caller_phone,
        phoneNumberId:s.quo.phone_number_id,googleCallAt:s.at,fetcher:wire});
      qualifications[s.key]=proof;
      if(proof.ok && proof.callId!==s.quo.quo_call_id) {
        const followup=await qread('call-summaries/'+proof.callId,{},true);
        serviceScopes[s.key]=combineServiceScopes(serviceScopes[s.key],serviceScopeFromText((followup.data?.summary||[]).join(' '),`quo-summary:${proof.callId}`));
        const kind=exclusionFromText((followup.data?.summary||[]).join(' '));
        if(kind)exclusions.push({market_key:s.market_key,phone:s.quo.caller_phone,quo_call_id:proof.callId,kind});
      }
    }
  }
  return {googleCalls,quoCalls,contacts,clients,objects,leads,historicalRequests,dispositions,retainedWorkScopes:oldSources.flatMap(s=>s.work_scope_evidence||[]),
    ledger:[...ledger,...outbox],phoneLedger,exclusions,qualifications,serviceScopes,intakeOperations,now};
}

export async function phoneLeadWatchCycle(env, {scheduledTime=Date.now(),since,fetcher=fetch,loadSnapshot=loadLeadWatchSnapshot,clock=()=>Date.now(),requestedRunKey}={}) {
  if(env?.[PHONE_LEAD_WATCH_FLAG]!=='true')return {disabled:true};
  const db=env.ANGI_ROUTER_DB,now=new Date(scheduledTime).toISOString();
  const runKey=requestedRunKey||`watch:${Math.floor(scheduledTime/WATCH_INTERVAL_MS)}`;
  if(requestedRunKey&&!/^watch-manual:[0-9a-f-]{36}$/.test(requestedRunKey))throw Error('invalid_watch_run_key');
  const claim=requestedRunKey
    ?await run(db,"UPDATE phone_lead_watch_runs SET diagnostic_code='watch_run_claimed',started_at=? WHERE run_key=? AND status='running' AND diagnostic_code='watch_run_requested'",now,runKey)
    :await run(db,"INSERT OR IGNORE INTO phone_lead_watch_runs(run_key,started_at,status) VALUES(?,?,'running')",runKey,now);
  if(Number(claim.meta?.changes??claim.changes)!==1)return {skipped:true};
  const diagnostics={step:'snapshot'};
  const write=(table,sql,...args)=>watchStep({step:'persist.'+table,api:'d1',table},()=>run(db,sql,...args));
  try {
    const snapshot=await loadSnapshot(env,{since:since||denverTime(scheduledTime-WATCH_LOOKBACK_MS).slice(0,10),now,fetcher:readOnlyTransport(fetcher),diagnostics});
    diagnostics.step='evaluate';
    const result=evaluateLeadWatch({...snapshot,now});
    for(const s of result.sources) {
      const safe={...s,surname:maskPaymentText(s.surname)};
      await write('phone_lead_watch_sources',`INSERT INTO phone_lead_watch_sources(source_key,path,market_key,source_at,retry_until,state,evidence_json,first_seen_at,last_checked_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET state=excluded.state,evidence_json=excluded.evidence_json,last_checked_at=excluded.last_checked_at`,s.key,s.path,s.market_key,s.at,s.retry_until,s.state,JSON.stringify(safe),now,now);
    }
    for(const r of result.results) await write('phone_lead_watch_results',`INSERT INTO phone_lead_watch_results(source_key,result_id,state,result_json,first_seen_at,last_checked_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(source_key,result_id) DO UPDATE SET state=excluded.state,result_json=excluded.result_json,last_checked_at=excluded.last_checked_at`,r.source_key,r.result_id,r.state,JSON.stringify(r),now,now);
    const summary={mode:'watch_only',upload_enabled:false,calls:result.sources.filter(s=>s.path==='call').length,
      matched_quo:result.sources.filter(s=>s.path==='call'&&s.quo).length,matched_client:result.sources.filter(s=>s.path==='call'&&s.quo&&s.client_ids.length===1).length,
      would_send:result.results.filter(r=>r.state==='would_send').length,manual_review:result.manual_review.length,pending:result.pending.length,excluded:result.excluded.length};
    await write('phone_lead_watch_runs',"UPDATE phone_lead_watch_runs SET status='completed',completed_at=?,summary_json=?,diagnostic_code=NULL WHERE run_key=?",new Date(clock()).toISOString(),JSON.stringify(summary),runKey);
    return summary;
  }catch(error) {
    const failure=watchFailure(error,diagnostics).watchDiagnostic;
    const completedAt=new Date(clock()).toISOString();
    await run(db,"UPDATE phone_lead_watch_runs SET status='failed',completed_at=?,diagnostic_code='watch_read_or_evaluation_failed',summary_json=? WHERE run_key=?",completedAt,JSON.stringify({failure}),runKey);
    console.error(JSON.stringify({phone_lead_watch_failure:failure,completed_at:completedAt}));
    return {failed:true,diagnostic_code:'watch_read_or_evaluation_failed',failure};
  }
}

// Operator requests are isolated to this watch table. An atomic claim permits
// one execution even if cron invocations overlap; failed requests never retry.
export async function requestedPhoneLeadWatchCycle(env,options={}) {
  if(env?.[PHONE_LEAD_WATCH_FLAG]!=='true')return {disabled:true};
  const request=await env.ANGI_ROUTER_DB.prepare("SELECT run_key FROM phone_lead_watch_runs WHERE status='running' AND diagnostic_code='watch_run_requested' ORDER BY started_at LIMIT 1").first();
  if(!request)return {skipped:true};
  return phoneLeadWatchCycle(env,{...options,requestedRunKey:request.run_key});
}

/** Public aggregate-only health. Never return evidence_json or arbitrary JSON. */
export async function phoneLeadWatchHealth(env) {
  const enabled=env?.[PHONE_LEAD_WATCH_FLAG]==='true';
  const empty={enabled,last_run_at:null,last_run_status:null,counts_as_of:null,would_send_count:null,manual_review_count:null,pending_count:null};
  try {
    const last=await env.ANGI_ROUTER_DB.prepare('SELECT started_at,status FROM phone_lead_watch_runs ORDER BY started_at DESC LIMIT 1').first();
    const completed=await env.ANGI_ROUTER_DB.prepare("SELECT completed_at,summary_json FROM phone_lead_watch_runs WHERE status='completed' ORDER BY started_at DESC LIMIT 1").first();
    const summary=parse(completed?.summary_json,{}),count=k=>Number.isSafeInteger(summary?.[k])&&summary[k]>=0?summary[k]:null;
    const stamp=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))?x:null;
    return {...empty,status:last?'available':'no_runs',last_run_at:stamp(last?.started_at),
      last_run_status:['running','completed','failed'].includes(last?.status)?last.status:null,counts_as_of:stamp(completed?.completed_at),
      would_send_count:count('would_send'),manual_review_count:count('manual_review'),pending_count:count('pending')};
  }catch{return {...empty,status:'schema_unavailable'};}
}
