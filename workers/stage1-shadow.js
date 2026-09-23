import { _private as leads } from '../functions/api/leads.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';
import { verifyJobberWebhookSignature } from '../server/jobber-appointment-webhook.js';
import { SINCE, MARKETS, accountMarket, deriveEvents, clickIdentifier } from '../server/stage1-model.js';
import { validationCandidates, validateDataManagerOnly } from '../server/stage2-validation.js';
import { firstScheduledObservation, health } from '../server/stage2-health.js';
import ownerReviewMigration from '../migrations/0014_owner_request_review.sql';
import ownerLinkMigration from '../migrations/0013_owner_link_overrides.sql';
import stage2Migration from '../migrations/0012_stage2_observability.sql';
import migration from '../migrations/0010_stage1_shadow.sql';
import outboxMigration from '../migrations/0011_stage1_outbox.sql';

const REQUEST = 'id createdAt updatedAt source client { id } assessment { id startAt endAt isComplete completedAt }';
const QUOTE = 'id createdAt updatedAt quoteStatus amounts { total } lastTransitioned { approvedAt convertedAt } request { id } client { id }';
const JOB = `id createdAt updatedAt request { id } client { id } quote { ${QUOTE} }`;
const FIELDS = { request: REQUEST, quote: QUOTE, job: JOB };
const TOPICS = ['REQUEST_CREATE', 'REQUEST_UPDATE', 'QUOTE_CREATE', 'QUOTE_UPDATE', 'QUOTE_APPROVED', 'JOB_CREATE', 'JOB_UPDATE'];
const now = () => new Date().toISOString();
const resultRows = result => result?.results || [];
const all = async (db, sql, ...args) => resultRows(await db.prepare(sql).bind(...args).all());
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const safeError = e => String(e?.code || e?.message || 'unknown').slice(0, 1500);

async function jobber(env, market, query, variables = {}) {
  if (!/^query\b/.test(query)) throw Error('read_only_jobber_query_required');
  const route = getJobberOAuthRoute(market, 'website');
  const { accessToken } = await leads.refreshJobberAccessToken(env, route);
  const response = await fetch('https://api.getjobber.com/api/graphql', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-JOBBER-GRAPHQL-VERSION': '2025-04-16' }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw Error(`jobber_${response.status}:` + JSON.stringify(body.errors || body).slice(0, 1200));
  if (body.data?.account?.id !== route.expectedAccountId) throw Error('jobber_account_mismatch');
  return body.data;
}

async function syncAttribution(env) {
  const db = env.ANGI_ROUTER_DB;
  // This legacy-named table is written by the WEBSITE attribution endpoint.
  // This reader calls no HighLevel API, and excludes Angi/provider records.
  const historical = await all(env.WEBSITE_ATTRIBUTION_DB, `SELECT id,jobber_account_id,jobber_request_id,occurred_at,gclid,gbraid,wbraid FROM highlevel_lead_attributions WHERE provider_name IS NULL AND jobber_request_id IS NOT NULL`);
  const current = await all(db, 'SELECT lead_id,market_key,jobber_request_id,inquiry_at,gclid,gbraid,wbraid FROM closed_loop_leads');
  const previous=new Map((await all(db,'SELECT * FROM closed_loop_stage1_leads')).map(r=>[r.market_key+':'+r.request_id,r]));
  const writes=[];const batchDb={prepare(sql){return {bind(...args){return {run(){writes.push(db.prepare(sql).bind(...args));}}}}}};
  for (const row of [...historical.map(r => ({ ...r, lead_id: r.id, inquiry_at: r.occurred_at, market_key: accountMarket(r.jobber_account_id), source: 'website_attribution_archive' })), ...current.map(r => ({ ...r, source: 'closed_loop_leads' }))]) {
    if (!MARKETS[row.market_key] || !row.jobber_request_id) continue;
    const old = previous.get(row.market_key+':'+row.jobber_request_id);
    const conflict = old && ['gclid', 'gbraid', 'wbraid'].some(k => old[k] && row[k] && old[k] !== row[k]);
    await run(batchDb, `INSERT INTO closed_loop_stage1_leads (market_key,request_id,lead_id,inquiry_at,gclid,gbraid,wbraid,source,conflict,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(market_key,request_id) DO UPDATE SET gclid=COALESCE(closed_loop_stage1_leads.gclid,excluded.gclid),gbraid=COALESCE(closed_loop_stage1_leads.gbraid,excluded.gbraid),wbraid=COALESCE(closed_loop_stage1_leads.wbraid,excluded.wbraid),conflict=MAX(closed_loop_stage1_leads.conflict,excluded.conflict),updated_at=excluded.updated_at`, row.market_key, row.jobber_request_id, row.lead_id, row.inquiry_at, row.gclid || null, row.gbraid || null, row.wbraid || null, row.source, conflict ? 1 : 0, now());
  }
  for(let i=0;i<writes.length;i+=75)await db.batch(writes.slice(i,i+75));
}

async function persistEvent(db, e) {
  const time = now();
  const existing = await db.prepare('SELECT upload_state FROM google_ads_outcome_outbox WHERE outcome_id=?').bind(e.id).first();
  if (existing?.upload_state === 'accepted') return; // never reset accepted events
  await run(db, `INSERT INTO closed_loop_stage1_events (outcome_id,market_key,event_name,request_id,quote_id,job_id,conversion_at,value_micros,payload_json,hold_reasons_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(outcome_id) DO UPDATE SET request_id=excluded.request_id,job_id=COALESCE(excluded.job_id,closed_loop_stage1_events.job_id),conversion_at=excluded.conversion_at,value_micros=excluded.value_micros,payload_json=excluded.payload_json,hold_reasons_json=excluded.hold_reasons_json,updated_at=excluded.updated_at`, e.id,e.market,e.stage,e.requestId,e.quoteId,e.jobId,e.time,e.valueMicros,e.payload ? JSON.stringify(e.payload) : null,JSON.stringify(e.reasons),time);
  await run(db, `INSERT INTO google_ads_outcome_outbox (outcome_id,event_name,market_key,attribution_path,attribution_status,source_lead_id,gclid,gbraid,wbraid,jobber_account_id,jobber_request_id,jobber_client_id,jobber_appointment_id,jobber_quote_id,jobber_job_id,google_account_id,google_conversion_action,milestone_at,conversion_at,value_micros,currency_code,revenue_source,consent_status,upload_state,diagnostic_code,created_at,updated_at) VALUES (?,?,?,'website','pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'USD',?,'unknown','shadow',?,?,?) ON CONFLICT(outcome_id) DO UPDATE SET gclid=excluded.gclid,gbraid=excluded.gbraid,wbraid=excluded.wbraid,source_lead_id=excluded.source_lead_id,jobber_request_id=excluded.jobber_request_id,jobber_job_id=COALESCE(excluded.jobber_job_id,google_ads_outcome_outbox.jobber_job_id),conversion_at=excluded.conversion_at,value_micros=excluded.value_micros,diagnostic_code=excluded.diagnostic_code,updated_at=excluded.updated_at WHERE google_ads_outcome_outbox.upload_state='shadow'`, e.id,e.stage,e.market,e.leadId,e.identifier.gclid || null,e.identifier.gbraid || null,e.identifier.wbraid || null,MARKETS[e.market].account,e.requestId,e.clientId,e.assessmentId,e.quoteId,e.jobId,'4800890529',e.stage === 'appointment_set' ? '7741195421' : e.stage === 'assessment_completed' ? '7754270379' : '7754270382',e.time || e.windowTime,e.time,e.valueMicros,e.stage === 'sold_job' ? 'jobber_approved_quote_total' : 'zero',e.reasons.join('|') || null,time,time);
}

async function cachedEnvironment(env) {
 const db=env.ANGI_ROUTER_DB,writes=[];
 const objects=new Map((await all(db,'SELECT * FROM closed_loop_stage1_objects')).map(o=>[o.market_key+':'+o.object_type+':'+o.object_id,o]));
 const leads=new Map((await all(db,'SELECT * FROM closed_loop_stage1_leads')).map(l=>[l.market_key+':'+l.request_id,l]));
 const historical=new Set((await all(db,'SELECT market_key,request_id FROM closed_loop_stage2_historical_appointments')).map(r=>r.market_key+':'+r.request_id));
 const overrides=new Map((await all(db,'SELECT * FROM closed_loop_owner_link_overrides')).map(r=>[r.market_key+':'+r.quote_id,r]));
 const requestLinks=new Map((await all(db,'SELECT * FROM closed_loop_owner_request_links')).map(r=>[r.market_key+':'+r.replacement_request_id,r]));
 const dispositions=new Map((await all(db,'SELECT * FROM closed_loop_lead_dispositions')).map(r=>[r.market_key+':'+r.request_id,r]));
 const states=new Map((await all(db,'SELECT outcome_id,upload_state FROM google_ads_outcome_outbox')).map(e=>[e.outcome_id,e]));
 const cached={prepare(sql){return {bind(...args){return {async first(){if(sql.startsWith('SELECT object_json'))return objects.get(args.join(':'))||null;if(sql.startsWith('SELECT * FROM closed_loop_stage1_leads'))return leads.get(args.join(':'))||null;if(sql.startsWith('SELECT request_id FROM closed_loop_stage2_historical_appointments'))return historical.has(args.join(':'))?{request_id:args[1]}:null;if(sql.startsWith('SELECT * FROM closed_loop_owner_link_overrides'))return overrides.get(args.join(':'))||null;if(sql.startsWith('SELECT * FROM closed_loop_owner_request_links'))return requestLinks.get(args.join(':'))||null;if(sql.startsWith('SELECT * FROM closed_loop_lead_dispositions'))return dispositions.get(args.join(':'))||null;if(sql.startsWith('SELECT upload_state'))return states.get(args[0])||null;throw Error('unexpected_cached_query');},async run(){writes.push(db.prepare(sql).bind(...args));}};}};}};
 return {env:{...env,ANGI_ROUTER_DB:cached},async flush(){for(let i=0;i<writes.length;i+=75)await db.batch(writes.slice(i,i+75));}};
}

async function processObject(env, market, type, object, webhook = null) {
  if (!object?.id) return;
  const db = env.ANGI_ROUTER_DB;
  const old = await db.prepare('SELECT object_json,first_scheduled_at FROM closed_loop_stage1_objects WHERE market_key=? AND object_type=? AND object_id=?').bind(market,type,object.id).first();
  const historical=type==='request' ? await db.prepare('SELECT request_id FROM closed_loop_stage2_historical_appointments WHERE market_key=? AND request_id=?').bind(market,object.id).first() : null;
  const scheduledAt=type==='request' ? firstScheduledObservation(old,object,historical,env.STAGE2_APPOINTMENT_CUTOFF,now()) : null;
  const quote = type === 'quote' ? object : type === 'job' ? object.quote : null;
  const override = quote ? await db.prepare('SELECT * FROM closed_loop_owner_link_overrides WHERE market_key=? AND quote_id=?').bind(market,quote.id).first() : null;
  // Apply owner evidence only to derivation; retain the original Jobber JSON below.
  let effective = object;
  if (override) {
    const conflict = [object.request?.id,quote.request?.id].some(id=>id && id!==override.request_id);
    effective = type === 'quote' ? {...object,request:{id:override.request_id}} : {...object,request:{id:override.request_id},quote:{...quote,request:{id:override.request_id}}};
    if (conflict) effective.ownerLinkConflict = true;
  }
  const requestId = type === 'request' ? object.id : effective.request?.id || effective.quote?.request?.id || null;
  await run(db, `INSERT INTO closed_loop_stage1_objects (market_key,object_type,object_id,request_id,client_id,source_created_at,source_updated_at,object_json,first_scheduled_at,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(market_key,object_type,object_id) DO UPDATE SET request_id=excluded.request_id,source_updated_at=excluded.source_updated_at,object_json=excluded.object_json,first_scheduled_at=COALESCE(closed_loop_stage1_objects.first_scheduled_at,excluded.first_scheduled_at),observed_at=excluded.observed_at`, market,type,object.id,requestId,object.client?.id || null,object.createdAt || null,object.updatedAt || null,JSON.stringify(object),scheduledAt,now());
  const requestLink = requestId ? await db.prepare('SELECT * FROM closed_loop_owner_request_links WHERE market_key=? AND replacement_request_id=?').bind(market,requestId).first() : null;
  const attributionRequestId = requestLink?.source_request_id || requestId;
  let lead = attributionRequestId ? await db.prepare('SELECT * FROM closed_loop_stage1_leads WHERE market_key=? AND request_id=?').bind(market,attributionRequestId).first() : null;
  const disposition = attributionRequestId ? await db.prepare('SELECT * FROM closed_loop_lead_dispositions WHERE market_key=? AND request_id=?').bind(market,attributionRequestId).first() : null;
  if (lead && disposition) lead={...lead,disposition:disposition.disposition};
  if (requestLink) effective={...effective,ownerAllowedStage:requestLink.allowed_stage};
  for (const e of deriveEvents(market,type,effective,lead,scheduledAt)) {await persistEvent(db,e);env.STAGE2_RUN_STATS?.events.add(e.id);}
}

async function scanPage(env, market, type) {
  const db = env.ANGI_ROUTER_DB;
  const state = await db.prepare('SELECT * FROM closed_loop_stage1_scan WHERE market_key=? AND object_type=?').bind(market,type).first();
  if (state?.completed_at?.slice(0,10) === now().slice(0,10)) return { skipped: true };
  const cursor = state?.completed_at ? null : state?.cursor || null;
  const range = type === 'job' ? 'createdAt' : 'updatedAt';
  const query = `query Stage1Page($after:String) { account { id } ${type}s(first:25,after:$after,filter:{${range}:{after:"2026-06-30T23:59:59Z"}}) { nodes { ${FIELDS[type]} } pageInfo { hasNextPage endCursor } } }`;
  try {
    const data = await jobber(env,market,query,{after:cursor});
    const page = data[`${type}s`];
    if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor)) throw Error('pagination_not_advancing');
    const cache=await cachedEnvironment(env);
    for (const object of page.nodes) await processObject(cache.env,market,type,object);
    await cache.flush();
    await run(db, `INSERT INTO closed_loop_stage1_scan (market_key,object_type,cursor,completed_at,page_count,object_count,error,updated_at) VALUES (?,?,?,?,?,?,NULL,?) ON CONFLICT(market_key,object_type) DO UPDATE SET cursor=excluded.cursor,completed_at=excluded.completed_at,page_count=excluded.page_count,object_count=excluded.object_count,error=NULL,updated_at=excluded.updated_at`, market,type,page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,page.pageInfo.hasNextPage ? null : now(),(cursor ? state?.page_count || 0 : 0)+1,(cursor ? state?.object_count || 0 : 0)+page.nodes.length,now());
    return { count: page.nodes.length, complete: !page.pageInfo.hasNextPage };
  } catch (e) {
    await run(db, `INSERT INTO closed_loop_stage1_scan (market_key,object_type,error,updated_at) VALUES (?,?,?,?) ON CONFLICT(market_key,object_type) DO UPDATE SET error=excluded.error,updated_at=excluded.updated_at`,market,type,safeError(e),now());
    return { error: safeError(e) };
  }
}

async function drainWebhooks(env) {
  const db=env.ANGI_ROUTER_DB;
  const rows=await all(db,"SELECT * FROM closed_loop_stage1_webhooks WHERE state IN ('pending','retryable') AND attempts<8 ORDER BY received_at LIMIT 15");
  for(const e of rows) {
    const type=e.topic.startsWith('REQUEST_')?'request':e.topic.startsWith('QUOTE_')?'quote':'job';
    try {
      const data=await jobber(env,e.market_key,`query Stage1Object($id:EncodedId!) { account { id } ${type}(id:$id) { ${FIELDS[type]} } }`,{id:e.item_id});
      if(!data[type])throw Error('webhook_object_not_found');
      await processObject(env,e.market_key,type,data[type],e);
      await run(db,"UPDATE closed_loop_stage1_webhooks SET state='done',attempts=attempts+1,error=NULL,updated_at=? WHERE event_key=?",now(),e.event_key);
      if(env.STAGE2_RUN_STATS)env.STAGE2_RUN_STATS.webhooks++;
    } catch(error) { await run(db,"UPDATE closed_loop_stage1_webhooks SET state=?,attempts=attempts+1,error=?,updated_at=? WHERE event_key=?",e.attempts>=7?'manual_review':'retryable',safeError(error),now(),e.event_key); }
  }
}

export async function makeReports(env) {
  const db=env.ANGI_ROUTER_DB, reports=[];
  for(const market of Object.keys(MARKETS)) {
    const dispositions=await all(db,'SELECT * FROM closed_loop_lead_dispositions WHERE market_key=?',market);
    const tests=new Set(dispositions.filter(d=>d.disposition==='test_excluded').map(d=>d.request_id));
    const resolved=new Set(dispositions.map(d=>d.request_id));
    const links=await all(db,'SELECT * FROM closed_loop_owner_request_links WHERE market_key=?',market);
    for(const link of links)resolved.add(link.source_request_id);
    const leads=(await all(db,'SELECT * FROM closed_loop_stage1_leads WHERE market_key=? AND inquiry_at>=?',market,SINCE)).filter(l=>!tests.has(l.request_id));
    const events=await all(db,'SELECT * FROM closed_loop_stage1_events WHERE market_key=?',market);
    const allLeads=(await all(db,'SELECT * FROM closed_loop_stage1_leads WHERE market_key=?',market)).filter(l=>!tests.has(l.request_id));
    const clickedRequests=new Set(allLeads.filter(l=>Object.keys(clickIdentifier(l)).length).map(l=>l.request_id));
    for(const link of links)if(clickedRequests.has(link.source_request_id))clickedRequests.add(link.replacement_request_id);
    const objects=await all(db,'SELECT object_type,object_id,request_id FROM closed_loop_stage1_objects WHERE market_key=?',market);
    const stages={};
    for(const stage of ['appointment_set','assessment_completed','sold_job']){const s=events.filter(e=>e.event_name===stage),ready=s.filter(e=>e.payload_json);stages[stage]={observed:s.length,website_with_click_id:s.filter(e=>clickedRequests.has(e.request_id)).length,shadow_ready:ready.length,held:s.length-ready.length,observed_value_usd:Math.round(s.reduce((n,e)=>n+(e.value_micros||0),0)/10000)/100,shadow_ready_value_usd:Math.round(ready.reduce((n,e)=>n+(e.value_micros||0),0)/10000)/100};}
    const reasons={};for(const e of events)for(const reason of JSON.parse(e.hold_reasons_json))reasons[reason]=(reasons[reason]||0)+1;
    const allLeadIds=new Set(allLeads.map(r=>r.request_id));
    const linkage={};for(const type of ['request','quote','job']){const s=objects.filter(o=>o.object_type===type);linkage[type]={scanned:s.length,missing_request_link:s.filter(o=>!o.request_id).length,without_original_website_lead:s.filter(o=>!o.request_id||!allLeadIds.has(o.request_id)).length};}
    const requestIds=new Set(objects.filter(o=>o.object_type==='request').map(o=>o.object_id));
    const missingRequestObjects=allLeads.filter(l=>!requestIds.has(l.request_id)&&!resolved.has(l.request_id)).map(l=>l.request_id);
    const today=now().slice(0,10);
    const daily={date:today,time_zone:'UTC',website_leads_with_click_id:leads.filter(l=>l.inquiry_at.slice(0,10)===today&&Object.keys(clickIdentifier(l)).length).length,website_leads_missing_click_id:leads.filter(l=>l.inquiry_at.slice(0,10)===today&&!Object.keys(clickIdentifier(l)).length).length,stages:{}};
    for(const stage of Object.keys(stages)){const e=events.filter(e=>e.event_name===stage&&e.conversion_at?.slice(0,10)===today);daily.stages[stage]={observed:e.length,shadow_ready:e.filter(e=>e.payload_json).length,held:e.filter(e=>!e.payload_json).length,shadow_ready_value_usd:Math.round(e.filter(e=>e.payload_json).reduce((n,e)=>n+(e.value_micros||0),0)/10000)/100};}
    const scan=await all(db,'SELECT * FROM closed_loop_stage1_scan WHERE market_key=?',market);
    const report={market,account:MARKETS[market].account,since:SINCE,as_of:now(),mode:'shadow',google_upload_enabled:false,excluded_test_leads:tests.size,closed_deleted_by_staff:dispositions.filter(d=>d.disposition==='closed_deleted_by_staff').length,owner_verified_request_links:links.length,website_leads_with_click_id:leads.filter(l=>Object.keys(clickIdentifier(l)).length).length,website_leads_missing_click_id:leads.filter(l=>!Object.keys(clickIdentifier(l)).length).length,daily,stages,linkage,attribution_requests_not_returned_by_backfill:missingRequestObjects,hold_reasons:reasons,held_event_count:events.filter(e=>JSON.parse(e.hold_reasons_json).length).length,scan_complete:scan.length===3&&scan.every(s=>s.completed_at&&!s.error),scan,webhooks:await all(db,'SELECT state,count(*) count FROM closed_loop_stage1_webhooks WHERE market_key=? GROUP BY state',market)};
    await run(db,'INSERT INTO closed_loop_stage1_reports(report_date,market_key,report_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(report_date,market_key) DO UPDATE SET report_json=excluded.report_json,updated_at=excluded.updated_at',now().slice(0,10),market,JSON.stringify(report),now());reports.push(report);
  }
  return reports;
}

async function tick(env, trigger="manual") {
  if(env.GOOGLE_ADS_UPLOAD_ENABLED !== 'false') throw Error('stage1_requires_google_upload_disabled');
  if(env.PHASE2_SHADOW_ENABLED !== 'true') return {mode:'disabled'};
  const db=env.ANGI_ROUTER_DB,lease=String(Date.now()+840000);
  const claim=await run(db,"INSERT INTO closed_loop_stage1_control(name,value,updated_at) VALUES('tick_lease',?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE CAST(closed_loop_stage1_control.value AS INTEGER)<?",lease,now(),Date.now());
  if(!claim.meta?.changes)return {mode:'already_running'};
  const runId=crypto.randomUUID();
  const stats={events:new Set(),webhooks:0};
  try {
  const cutoff=await db.prepare("SELECT value FROM closed_loop_stage1_control WHERE name='stage2_appointment_start_at'").first();
  env={...env,STAGE2_RUN_STATS:stats,STAGE2_APPOINTMENT_CUTOFF:cutoff?.value};
  await run(db,"INSERT INTO closed_loop_stage2_runs(run_id,trigger,started_at,status) VALUES(?,?,?,'running')",runId,trigger,now());
    await syncAttribution(env);await drainWebhooks(env);
    const pages={};for(const m of Object.keys(MARKETS)){pages[m]={};for(const t of ['request','quote','job'])pages[m][t]=await scanPage(env,m,t);}
    // Re-evaluate cached observations when late website attribution arrives.
    const cached=await all(db,`SELECT o.* FROM closed_loop_stage1_objects o WHERE request_id IN (SELECT request_id FROM closed_loop_stage1_leads) OR EXISTS (SELECT 1 FROM closed_loop_owner_request_links r WHERE r.market_key=o.market_key AND r.replacement_request_id=o.request_id) OR EXISTS (SELECT 1 FROM closed_loop_owner_link_overrides v WHERE v.market_key=o.market_key AND v.quote_id=CASE WHEN o.object_type='quote' THEN o.object_id ELSE json_extract(o.object_json,'$.quote.id') END)`);
    const cache=await cachedEnvironment(env);
    for(const o of cached)await processObject(cache.env,o.market_key,o.object_type,JSON.parse(o.object_json));
    await cache.flush();
    const reports=await makeReports(env);
    const failed=Object.values(pages).some(p=>Object.values(p).some(r=>r.error));
    await run(db,'UPDATE closed_loop_stage2_runs SET completed_at=?,status=?,events_processed=?,webhooks_processed=? WHERE run_id=?',now(),failed?'partial_failure':'success',stats.events.size,stats.webhooks,runId);
    return {mode:'shadow',pages,reports};
  } catch(error){
    await run(db,"UPDATE closed_loop_stage2_runs SET completed_at=?,status='failed' WHERE run_id=?",now(),runId);
    throw error;
  } finally {await run(db,"DELETE FROM closed_loop_stage1_control WHERE name='tick_lease' AND value=?",lease);}
}

async function webhook(request,env) {
  const raw=await request.text();if(raw.length>65536)return json({error:'payload_too_large'},413);
  let e;try {e=JSON.parse(raw)?.data?.webHookEvent;}catch{return json({error:'invalid_json'},400);}
  const market=accountMarket(e?.accountId);
  if(!market||!TOPICS.includes(e?.topic)||!e?.itemId)return json({error:'unsupported_event'},400);
  const route=getJobberOAuthRoute(market,'website');
  if(!await verifyJobberWebhookSignature(raw,request.headers.get('X-Jobber-Hmac-SHA256'),env[route.clientSecretEnvKey]||env.JOBBER_CLIENT_SECRET))return json({error:'invalid_signature'},401);
  const at=e.occurredAt||e.occuredAt;if(!Number.isFinite(Date.parse(at)))return json({error:'event_time_missing'},400);
  const key=[market,e.topic,e.itemId,at].join(':');
  await run(env.ANGI_ROUTER_DB,'INSERT OR IGNORE INTO closed_loop_stage1_webhooks(event_key,market_key,topic,item_id,occurred_at,received_at,updated_at) VALUES(?,?,?,?,?,?,?)',key,market,e.topic,e.itemId,at,now(),now());
  return json({ok:true,mode:'shadow',recorded_conversion:false},202);
}

export default {
  async scheduled(_event,env){console.log(JSON.stringify(await tick(env,"scheduled")));},
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET')return json(await health(env));
    if(path==='/webhooks/jobber'&&request.method==='POST')return webhook(request,env);
    if(!env.STAGE1_ADMIN_SECRET||request.headers.get('Authorization')!==`Bearer ${env.STAGE1_ADMIN_SECRET}`)return json({error:'unauthorized'},401);
    try{
      if(path==='/initialize'&&request.method==='POST'){
        if(env.GOOGLE_ADS_UPLOAD_ENABLED!=='false')throw Error('stage1_requires_google_upload_disabled');
        const schema=await env.ANGI_ROUTER_DB.prepare("SELECT sql FROM sqlite_master WHERE name='google_ads_outcome_outbox'").first();
        const sql=migration+(schema?.sql.includes("'shadow'")&&schema.sql.includes("'mo_kc'")?'':outboxMigration)+stage2Migration+ownerLinkMigration+ownerReviewMigration;
        const statements=sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
        await env.ANGI_ROUTER_DB.batch(statements.map(s=>env.ANGI_ROUTER_DB.prepare(s)));
        return json({initialized:true,mode:'shadow'});
      }
      if(path==='/tick'&&request.method==='POST')return json(await tick(env));
      if(path==='/report'&&request.method==='GET')return json({reports:(await all(env.ANGI_ROUTER_DB,'SELECT report_json FROM closed_loop_stage1_reports WHERE report_date=(SELECT MAX(report_date) FROM closed_loop_stage1_reports)')).map(r=>JSON.parse(r.report_json)),events:await all(env.ANGI_ROUTER_DB,'SELECT * FROM closed_loop_stage1_events'),baseline:(await all(env.ANGI_ROUTER_DB,'SELECT row_json FROM closed_loop_stage1_baseline')).map(r=>JSON.parse(r.row_json))});
      if(path==='/validate-only'&&request.method==='POST'){
        const baseline=(await all(env.ANGI_ROUTER_DB,'SELECT row_json FROM closed_loop_stage1_baseline')).map(r=>JSON.parse(r.row_json));
        const events=await all(env.ANGI_ROUTER_DB,'SELECT * FROM closed_loop_stage1_events');
        const report=await validateDataManagerOnly(validationCandidates(baseline,events),env);
        for(const row of report.rows)await run(env.ANGI_ROUTER_DB,'INSERT INTO closed_loop_stage2_validation(event_id,checked_at,result_json) VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET checked_at=excluded.checked_at,result_json=excluded.result_json',row.event_id,now(),JSON.stringify(row));
        return json(report);
      }
      return json({error:'not_found'},404);
    }catch(e){return json({error:safeError(e),mode:'shadow'},500);}
  }
};

export { tick, scanPage, processObject, persistEvent, TOPICS };
