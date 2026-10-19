// Pure watch-only reconciliation. No transport and no access to the upload queue.
import { googleCallEligible, JOBBER_ACCOUNTS, MARKET_LINES } from './google-qualified-phone-collector.js';
import { jobberLeadProof } from './qualified-phone-proof.js';
import { ACTIONS, deriveEvents, numericId, clickIdentifier, utcTime } from './stage1-model.js';
import { denverTime } from './qualified-phone-runtime.js';
import { combineServiceScopes, serviceScopeFromText, scopeAllowsCredit, scopeForPerson, SERVICE_SCOPE_POLICY } from './lead-service-scope.js';
import { WATCH_KNOWN_REFUSALS } from './phone-lead-watch-refusals.js';
import {resolvePhonePlaceholderAlias} from './phone-placeholder-alias.js';

export const WATCH_INTERVAL_MS = 3 * 3600000;
export const WATCH_LOOKBACK_MS = 14 * 86400000;
export const WATCH_MATCH_SECONDS = 5;
export const WATCH_MARKET_LINES = Object.freeze({ut:[MARKET_LINES.ut,'+13853360062'],mo_stl:[MARKET_LINES.mo_stl],mo_kc:[MARKET_LINES.mo_kc]});
export const WATCH_ACTIONS = Object.freeze({
  call: Object.freeze({ qualified_lead: '7742989654', sold_job: '7788072382' }),
  click: Object.freeze({ ...ACTIONS }),
});
const time = value => Date.parse(value || '');
const unique = values => [...new Set(values.filter(Boolean))];
export function phone(value) {
  const digits = String(value || '').replace(/(?:ext\.?|x|#)\s*\d+\s*$/i, '').replace(/\D/g, '');
  return /^1\d{10}$/.test(digits) ? `+${digits}` : /^\d{10}$/.test(digits) ? `+1${digits}` : null;
}
const email = value => String(value || '').trim().toLowerCase();
const phones = client => unique((client?.phones || []).map(p => phone(p.number || p.value || p)));
const emails = client => unique((client?.emails || []).map(p => email(p.address || p.value || p)));
const sameId = (a, b) => Boolean(a && b && numericId(a) === numericId(b));
// Jobber's API timestamps have whole-second precision. A source-created client
// in that same second is not evidence that the person existed before intake.
function predates(value, source) {
  const a = time(value), b = time(source.at);
  if (source.path === 'click' && source.time_basis === 'submission_upper_bound'
    && /^\d{4}.*:\d\dZ$/.test(value || '') && Math.floor(a / 1000) === Math.floor(b / 1000)) return false;
  return a < b;
}
export function maskPaymentText(value) {
  return String(value || '')
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, '[PAYMENT NUMBER REDACTED]')
    .replace(/\b(?:cvv|cvc|security code|expir(?:y|ation)(?: date)?)\b[^\n.;]{0,80}/gi, '[PAYMENT DETAIL REDACTED]');
}

// Persist only the classification code, never call text or notes. These are
// conservative exclusion signals; they do not declare a call qualified.
export function exclusionFromText(value) {
  const text = String(value || '');
  if (/\b(?:test (?:call|lead|request|submission)|internal test|testing (?:the )?(?:form|integration))\b/i.test(text)) return 'test';
  if (/\b(?:wrong number|mistakenly thought they were calling|trying to reach (?:Critter Control|Orkin|Rottler)|is this (?:Orkin|Rottler|Critter Control)|thought this was my mom|did not have the correct phone number)\b/i.test(text)) return 'wrong_number';
  if (/\b(?:does not sell insulation products|does not install (?:asset|access) doors|not extermination)\b/i.test(text)) return 'wrong_service';
  if (/\b(?:previous service|previous installation|services (?:done with|were performed)|installed in her attic by|returning customer|existing customer)\b/i.test(text)) return 'returning_customer';
  if (/\b(?:account manager for Good Attic|selling (?:leads|advertising)|sales solicitation|vendor solicitation)\b/i.test(text)) return 'vendor';
  return null;
}

export function mergeQuoEvidence(...sources) {
  const rows = new Map();
  for (const source of sources) for (const row of source || []) {
    if (!row.quo_call_id) continue;
    const old = rows.get(row.quo_call_id);
    const conflict = old && ['caller_phone', 'destination_number', 'phone_number_id'].some(k => old[k] && row[k] && old[k] !== row[k])
      || old && Number.isFinite(time(old.call_started_at_utc)) && Number.isFinite(time(row.call_started_at_utc))
        && Math.abs(time(old.call_started_at_utc) - time(row.call_started_at_utc)) > 1000;
    rows.set(row.quo_call_id, { ...old, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v != null)),
      evidence_conflict: Boolean(old?.evidence_conflict || row.evidence_conflict || conflict) });
  }
  return [...rows.values()];
}

function safeQuo(row) {
  return Object.fromEntries(['quo_call_id','account_id','market','market_key','destination_number','phone_number_id',
    'caller_phone','call_started_at_utc','call_started_at_original','direction','final_status','duration_seconds',
    'jobber_request_id','jobber_client_id','evidence_conflict'].filter(k=>row[k]!=null).map(k=>[k,row[k]]));
}

function quoMarket(row) {
  const lineMarket = Object.entries(WATCH_MARKET_LINES).find(([, numbers]) => numbers.includes(phone(row.destination_number)))?.[0];
  const declared = row.market_key || { utah: 'ut', stl: 'mo_stl', kc: 'mo_kc' }[row.market];
  if (lineMarket && declared && lineMarket !== declared) return null;
  if (row.account_id && declared && numericId(row.account_id) !== JOBBER_ACCOUNTS[declared]) return null;
  return lineMarket || null;
}

export function matchWatchCalls(googleCalls, quoCalls) {
  const rows = googleCalls.map(g => {
    const near = quoCalls.filter(q => q.direction === 'incoming' && phone(q.caller_phone)
      && Math.abs(time(g.start_call_date_time) - time(q.call_started_at_utc)) <= WATCH_MATCH_SECONDS * 1000
      && (!g.caller_area_code || phone(q.caller_phone).slice(2, 5) === String(g.caller_area_code)));
    const right = near.filter(q => quoMarket(q) === g.market_key);
    const base = { key: g.google_resource, path: 'call', market_key: g.market_key,
      at: g.start_call_date_time, google: g, quo: null, reasons: [] };
    if (!/^customers\/4800890529\/callViews\/[^/\s]+$/.test(g.google_resource || '') || !Number.isFinite(time(base.at)) || !JOBBER_ACCOUNTS[g.market_key]) return { ...base, reasons: ['invalid_google_identity'] };
    if (right.length !== 1) return { ...base, reasons: [right.length ? 'ambiguous_quo_call' : near.length ? 'market_line_mismatch' : 'no_matching_quo_call'], nearby_quo_ids: near.map(q => q.quo_call_id) };
    if (right[0].evidence_conflict) return { ...base, reasons: ['quo_evidence_conflict'] };
    return { ...base, quo: safeQuo(right[0]), delta_seconds: Math.abs(time(base.at) - time(right[0].call_started_at_utc)) / 1000 };
  });
  for (const row of rows) {
    if (rows.filter(x => x.key === row.key).length > 1) { row.reasons = ['duplicate_google_resource']; row.quo = null; }
    else if (row.quo && rows.filter(x => x.quo?.quo_call_id === row.quo.quo_call_id).length > 1) row.reasons.push('multiple_google_calls_for_quo_call');
  }
  return rows;
}

export function relatedPhones(caller, contacts) {
  return unique([phone(caller), ...contacts.filter(c => (c.phones || []).some(p => phone(p) === phone(caller)))
    .flatMap(c => c.phones || []).map(phone)]);
}
export function clientsForSource(source, clients, contacts = []) {
  if (source.path === 'call') {
    if (!source.quo) return [];
    const numbers = relatedPhones(source.quo.caller_phone, contacts);
    return clients.filter(c => c.market_key === source.market_key && phones(c).some(p => numbers.includes(p)));
  }
  const anchor = clients.find(c => c.market_key === source.market_key && sameId(c.id, source.lead.client_id));
  const numbers = unique([...phones(anchor), ...(source.lead.phones || []).map(phone)]);
  const addresses = unique([...emails(anchor), ...(source.lead.emails || []).map(email)]);
  return clients.filter(c => c.market_key === source.market_key && (sameId(c.id, source.lead.client_id)
    || phones(c).some(p => numbers.includes(p)) || emails(c).some(e => addresses.includes(e))));
}

export function permanentConsentFailure(row = {}) {
  const evidence = [row.error_category, row.diagnostic_code, row.response_raw, row.response_json].join(' ');
  return /CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY|APPLE_INTERACTIONS_NOT_SUPPORTED|CONSENT_NOT_GRANTED|CONSENT_DENIED|(?:apple|ios).{0,100}(?:privacy|consent)|(?:privacy|consent).{0,100}(?:apple|ios)/i.test(evidence);
}
const accepted = row => ['accepted', 'uploaded'].includes(row?.status || row?.state || row?.upload_state);

// Adapt a copy for the shared stage derivation; never change its live rule.
// A fallback is used only for a converted quote. A supplied invalid or pre-ad
// preferred time is held, never replaced by a more convenient later time.
export function watchSoldObject(row, owned) {
  const obj=row.object, q=row.object_type==='quote'?obj:row.object_type==='job'?obj.quote:null;
  if(!q)return {object:obj,time_basis:null};
  let at=q.lastTransitioned?.approvedAt, basis=at?'approvedAt':null;
  const jobs=owned.filter(o=>o.object_type==='job'&&o.current_present!==false&&sameId(o.object?.quote?.id,q.id))
    .sort((a,b)=>time(a.object.createdAt)-time(b.object.createdAt));
  const job=row.object_type==='job'?obj:jobs[0]?.object;
  if(!at && String(q.quoteStatus).toLowerCase()==='converted') {
    at=q.lastTransitioned?.convertedAt;
    if(at)basis='convertedAt';
    else if(job?.createdAt){at=job.createdAt;basis='job.createdAt';}
  }
  const quote={...q,lastTransitioned:{...q.lastTransitioned,approvedAt:at}};
  return {object:row.object_type==='quote'?quote:{...obj,quote},time_basis:basis,job_id:job?.id||null};
}

export function evaluateLeadWatch(input) {
  const { googleCalls = [], quoCalls = [], contacts = [], clients = [], objects = [], leads = [],
    historicalRequests = [], dispositions = [], ledger = [], phoneLedger = [], qualifications = {},
    exclusions = [], serviceScopes = {}, retainedWorkScopes = [], intakeOperations = [], aliasEnabled = true,
    now = new Date().toISOString(), actions = WATCH_ACTIONS } = input;
  const sources = matchWatchCalls(googleCalls, mergeQuoEvidence(quoCalls));
  for (const lead of leads) if (Object.keys(clickIdentifier(lead)).length) sources.push({
    key: `click:${lead.market_key}:${numericId(lead.request_id)}`, path: 'click', market_key: lead.market_key,
    at: lead.click_at || lead.inquiry_at, time_basis: lead.click_at ? 'click' : 'submission_upper_bound', lead, reasons: [] });
  const results = [];
  for (const s of sources) {
    s.clients = clientsForSource(s, clients, contacts);
    s.candidate_client_ids=s.clients.map(c=>c.id);
    if(aliasEnabled&&s.path==='call'&&s.quo&&!s.reasons.length&&s.clients.length>1) {
      s.alias=resolvePhonePlaceholderAlias({call:s.google,quo:s.quo,clients:s.clients,objects,intakeOperations,historicalRequests,dispositions,now});
      if(s.alias.status==='resolved')s.clients=s.clients.filter(c=>sameId(c.id,s.alias.operational_client_id));
      else if(s.alias.reason!=='multiple_jobber_clients')s.reasons.push('multiple_jobber_clients',s.alias.reason);
    }
    s.client_ids = s.clients.map(c => c.id);
    s.phone = s.quo?.caller_phone || phones(s.clients[0])[0] || null;
    s.surname = maskPaymentText(s.clients[0]?.lastName || s.clients[0]?.name || s.phone || 'Unknown');
    s.retry_until = Number.isFinite(time(s.at)) ? new Date(time(s.at) + WATCH_LOOKBACK_MS).toISOString() : null;
    if (!s.reasons.length && s.clients.length !== 1) s.reasons.push(s.clients.length ? 'multiple_jobber_clients' : 'jobber_client_not_found');
    const c = s.clients.length === 1 ? s.clients[0] : null;
    const owned = c ? objects.filter(o => o.market_key === s.market_key && sameId(o.client_id || o.object?.client?.id, c.id))
      .sort((a,b)=>(a.current_present===false?1:0)-(b.current_present===false?1:0)) : [];
    if (c) {
      if (c.history_complete !== true) s.reasons.push('jobber_history_incomplete');
      if (!Number.isFinite(time(c.createdAt)) || !Number.isFinite(time(s.at))) s.reasons.push('identity_time_missing');
      else if (predates(c.createdAt, s)) s.reasons.push(s.time_basis === 'submission_upper_bound' ? 'client_before_submission_click_time_unknown' : 'client_predates_ad');
      if (s.path==='call' && time(c.createdAt)>time(s.retry_until)) s.reasons.push('client_added_after_retry_window');
      if (owned.some(o => predates(o.object?.createdAt, s))) s.reasons.push('jobber_record_predates_ad');
      if (historicalRequests.some(r => r.market_key === s.market_key && (sameId(r.client_id, c.id)
        || phones(c).includes(phone(r.phone)) || emails(c).includes(email(r.email))) && predates(r.created_at, s))) s.reasons.push('historical_request_predates_ad');
      if (owned.some(o => o.object_type === 'job' && time(o.object?.createdAt) < time(s.at))) s.reasons.push('prior_job');
      if (dispositions.some(d => d.market_key === s.market_key && d.disposition === 'test_excluded'
        && (owned.some(o => sameId(o.object_id, d.request_id)) || sameId(s.lead?.request_id, d.request_id)))) s.reasons.push('excluded_test');
      if (/^(?:test\b|internal test\b)/i.test(c.name || '')) s.reasons.push('excluded_test');
    }
    const excluded = exclusions.filter(e => e.market_key === s.market_key && (e.quo_call_id && e.quo_call_id === s.quo?.quo_call_id
      || phone(e.phone) && phone(e.phone) === s.phone || c && (sameId(e.client_id, c.id)||sameId(e.client_id,s.alias?.original_client_id))));
    s.reasons.push(...excluded.map(e => `excluded_${e.kind}`));
    const retained=c?retainedWorkScopes.filter(o=>o.market_key===s.market_key&&sameId(o.client_id,c.id)
      &&o.scope?.policy===SERVICE_SCOPE_POLICY&&o.scope.in_scope_evidence&&time(o.created_at)<=time(now)):[];
    s.work_scope_evidence=[...retained,...owned.filter(o=>['quote','job'].includes(o.object_type)&&time(o.object.createdAt)<=time(now))
      .map(o=>({market_key:s.market_key,client_id:c.id,object_type:o.object_type,object_id:o.object_id,created_at:o.object.createdAt,
        scope:o.service_scope||serviceScopeFromText('',`jobber-${o.object_type}:${numericId(o.object_id)}`,{record:true})}))];
    const workEvidence=new Map();
    for(const item of s.work_scope_evidence) {
      const key=`${item.object_type}:${numericId(item.object_id)}`,old=workEvidence.get(key);
      if(!old||!old.scope.in_scope_evidence||item.scope.in_scope_evidence)workEvidence.set(key,item);
    }
    s.work_scope_evidence=[...workEvidence.values()];
    s.service_scope=scopeForPerson(serviceScopes[s.key] || combineServiceScopes(serviceScopeFromText(s.lead?.service)),s.work_scope_evidence.map(o=>o.scope));
    if(c && (s.path==='click'||s.quo) && !scopeAllowsCredit(s.service_scope)) {
      s.reasons.push(s.service_scope.state==='off_scope_only'?'excluded_off_scope_service':
        'service_scope_unverified');
    }
    if (s.lead?.conflict) s.reasons.push('conflicting_click_ids');
    s.reasons = unique(s.reasons);
    const knownEarlierProspect=s.path==='call'&&s.reasons.some(r=>['client_predates_ad','jobber_record_predates_ad','historical_request_predates_ad'].includes(r))
      &&!s.reasons.includes('excluded_returning_customer');
    s.state = knownEarlierProspect||s.reasons.some(r=>['excluded_off_scope_service','excluded_wrong_service'].includes(r))?'excluded':s.reasons.length ? s.reasons.every(r => ['jobber_client_not_found', 'no_matching_quo_call'].includes(r))
      && time(now) < time(s.retry_until) ? 'pending' : 'manual_review' : 'matched';
    const events = [];
    for (const o of owned) {
      const obj = o.object;
      const saleObject=watchSoldObject(o,owned);
      for (const e of deriveEvents(s.market_key, o.object_type, saleObject.object, s.lead || { inquiry_at: s.at, gclid: 'watch-only' }, o.first_scheduled_at, now)) {
        events.push({ result_id: e.id, type: e.stage, at: e.time, value: e.valueMicros == null ? null : e.valueMicros / 1e6,
          object_id: e.quoteId || e.requestId || e.jobId, request_id: e.requestId, assessment_id: e.assessmentId,
          quote_id: e.quoteId, job_id: e.jobId || (e.stage==='sold_job'?saleObject.job_id:null),
          time_basis:e.stage==='sold_job'?saleObject.time_basis:null, reasons: [...e.reasons.filter(r => !['missing_request_link', 'missing_original_website_lead', 'missing_click_id'].includes(r)),
            ...(o.current_present===false?['source_object_not_current']:[])] });
      }
      if (o.object_type === 'quote') events.push({result_id:`quote:${s.market_key}:${numericId(obj.id)}`,type:'quote_created',at:obj.createdAt,value:obj.amounts?.total,object_id:obj.id,reasons:o.current_present===false?['source_object_not_current']:[]});
    }
    if (s.path === 'call' && s.quo && c && googleCallEligible(s.google)) {
      const requests = owned.filter(o => o.object_type === 'request' && o.current_present!==false && time(o.object.createdAt) >= time(s.at)
        && time(o.object.createdAt) <= time(s.at) + 7 * 86400000).sort((a,b) => time(a.object.createdAt)-time(b.object.createdAt));
      // Existing qualified-call rule: active request/client, a scheduled/completed
      // assessment or quote, otherwise a verified two-speaker 60-second call.
      const proofs = requests.map(o => ({ o, proof: jobberLeadProof({ request: o.object, client: c,
        disposition: dispositions.find(d => d.market_key === s.market_key && sameId(d.request_id,o.object_id)) }) }));
      const valid = proofs.find(p => p.proof.ok && (p.proof.milestone || qualifications[s.key]?.ok));
      events.push({result_id:`qualified:${s.key}`, type:'qualified_lead', at:valid?.o.object.createdAt || null, value:0,
        request_id:valid?.o.object.id, reasons:valid ? [] : ['qualification_proof_missing']});
    }
    const seen = new Set();
    for (const e of events) {
      if (seen.has(e.result_id)) continue;
      seen.add(e.result_id);
      const action = actions[s.path]?.[e.type] || null;
      const acceptedRow = ledger.find(l => l.event_id === e.result_id && accepted(l))
        || (e.type === 'qualified_lead' && phoneLedger.find(l => l.google_resource === s.key && accepted(l)))
        || ledger.find(l => accepted(l) && l.market_key === s.market_key && l.event_name === e.type
          && (e.assessment_id && sameId(e.assessment_id,l.jobber_appointment_id) || e.quote_id && sameId(e.quote_id,l.jobber_quote_id)));
      const failed = [...WATCH_KNOWN_REFUSALS, ...ledger, ...phoneLedger].find(l => (l.event_id === e.result_id || s.path === 'call' && (l.google_resource === s.key || l.google_call_key === s.key || l.caller_phone === s.phone)) && permanentConsentFailure(l));
      let reasons = unique([...s.reasons, ...e.reasons]);
      if (ledger.some(l=>l.event_id===e.result_id && ['submitting','submitted','unknown','rejected','permanently_failed'].includes(l.status||l.upload_state))) reasons.push('existing_delivery_requires_review');
      if (!Number.isFinite(time(e.at))) reasons.push('result_time_unavailable');
      else if (time(e.at) <= time(s.at)) reasons.push('result_not_after_ad');
      else if (time(e.at) > time(now)) reasons.push('future_result');
      if (e.value == null || !Number.isFinite(e.value) || e.value < 0) reasons.push('result_value_unavailable');
      if (time(now)-time(s.at)>90*86400000) reasons.push('attribution_window_review');
      if(failed)reasons.push('permanent_consent_refusal');
      const state = acceptedRow ? 'already_accepted' : failed ? 'permanently_failed' : !action ? 'no_destination' : reasons.length ? 'held' : 'would_send';
      const identifier = s.path === 'call' ? { callerId:s.phone, callStartDateTime:denverTime(s.at) } : clickIdentifier(s.lead);
      const preview = state === 'would_send' ? { conversionAction:`customers/4800890529/conversionActions/${action}`,
        ...identifier, conversionDateTime:utcTime(e.at), conversionValue:e.value, currencyCode:'USD',
        ...(s.path === 'click' ? {orderId:e.result_id} : {}) } : null;
      results.push({...e,source_key:s.key,path:s.path,market_key:s.market_key,surname:s.surname,client_id:c?.id,
        state,reasons:unique(reasons),action,identifier,preview,
        refusal:failed?{code:failed.error_category||failed.diagnostic_code||'permanent_consent_refusal',evidence_date:failed.evidence_date||null,evidence_kind:failed.evidence_kind||'ledger',retry:false}:null,
        ledger_id:acceptedRow?.event_id || acceptedRow?.outcome_id || null});
    }
    delete s.clients;
  }
  // One canonical result across every source and request. Prefer a retained
  // click ID; otherwise earliest eligible call. Never duplicate a sale by job ID.
  const winner = new Map();
  const resultKey = r => r.type === 'qualified_lead' ? `${r.market_key}:${r.client_id}:qualified_lead`
    : r.assessment_id ? `${r.market_key}:${r.type}:${numericId(r.assessment_id)}` : r.result_id;
  const alreadyRecorded = new Set(results.filter(r=>r.state==='already_accepted').map(resultKey));
  for (const r of results.filter(r => r.state === 'would_send').sort((a,b) => (a.path==='click'?0:1)-(b.path==='click'?0:1)
    || time(sources.find(s=>s.key===a.source_key).at)-time(sources.find(s=>s.key===b.source_key).at))) {
    const key = resultKey(r);
    if (alreadyRecorded.has(key)) {r.state='already_accepted';r.reasons.push('result_already_recorded');r.preview=null;continue;}
    if (winner.has(key)) {r.state='duplicate_result';r.reasons.push('another_source_selected');r.preview=null;} else winner.set(key,r);
  }
  return {mode:'watch_only',upload_enabled:false,now,sources,results,
    manual_review:sources.filter(s=>s.state==='manual_review'),pending:sources.filter(s=>s.state==='pending'),excluded:sources.filter(s=>s.state==='excluded')};
}
