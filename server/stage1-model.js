export const SINCE = '2026-07-01T00:00:00.000Z';
export const MARKETS = { ut: { account: '2498432', key: 'utah', slug: 'slc' }, mo_stl: { account: '2498453', key: 'stl', slug: 'stl' }, mo_kc: { account: '1919824', key: 'kc', slug: 'kc' } };
export const ACTIONS = { appointment_set: '7741195421', assessment_completed: '7754270379', sold_job: '7754270382' };
export const numericId = id => { const raw=String(id || ''); try { const decoded=atob(raw); return decoded.startsWith('gid://Jobber/') ? decoded.split('/').pop() : raw; } catch { return raw; } };
export const accountMarket = id => Object.keys(MARKETS).find(m => MARKETS[m].account === numericId(id));
export function clickIdentifier(lead = {}) {
  for (const key of ['gclid', 'gbraid', 'wbraid']) if (typeof lead[key] === 'string' && lead[key].trim()) return { [key]: lead[key].trim() };
  return {};
}
export function utcTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00:00');
}
export function eventId(market, stage, id) {
  if (!MARKETS[market] || !id) throw Error('invalid_event_identity');
  const label = { appointment_set: 'appointment', assessment_completed: 'assessment', sold_job: 'sold' }[stage];
  if (!label) throw Error('invalid_event_stage');
  return `gae-${MARKETS[market].slug}-${label}-${numericId(id)}`;
}
// Business observations are separate from eligibility: missing IDs/times/links
// remain visible in the shadow ledger, but never become sendable payloads.
export function deriveEvents(market, type, object, lead, scheduledAt, now = new Date().toISOString()) {
  const events = [];
  const requestId = type === 'request' ? object.id : object.request?.id || object.quote?.request?.id || null;
  if (type === 'request' && object.assessment) {
    const a = object.assessment;
    if (a.startAt && a.endAt) events.push({ stage: 'appointment_set', objectId: object.id, time: scheduledAt, windowTime: scheduledAt || a.startAt, value: 0, assessmentId: a.id });
    if (a.isComplete) events.push({ stage: 'assessment_completed', objectId: object.id, time: a.completedAt, windowTime: a.completedAt, value: 0, assessmentId: a.id });
  }
  const q = type === 'quote' ? object : type === 'job' ? object.quote : null;
  if (q && (q.lastTransitioned?.approvedAt || q.lastTransitioned?.convertedAt || ['approved', 'converted'].includes(String(q.quoteStatus).toLowerCase()) || type === 'job')) {
    events.push({ stage: 'sold_job', objectId: q.id, time: q.lastTransitioned?.approvedAt, windowTime: q.lastTransitioned?.approvedAt || q.lastTransitioned?.convertedAt || q.createdAt, value: q.amounts?.total, quoteId: q.id, jobId: type === 'job' ? object.id : null });
  } else if (type === 'job' && !q) {
    events.push({ stage: 'sold_job', objectId: `job-${numericId(object.id)}`, time: null, windowTime: object.createdAt, value: null, jobId: object.id, noQuote: true });
  }
  return events.filter(e => !e.windowTime || Date.parse(e.windowTime) >= Date.parse(SINCE)).map(e => {
    const reasons = [];
    if (!requestId) reasons.push('missing_request_link');
    if(type==='job'&&object.request?.id&&object.quote?.request?.id&&object.request.id!==object.quote.request.id)reasons.push('conflicting_job_quote_request_links');
    if (!lead) reasons.push('missing_original_website_lead');
    const identifier = clickIdentifier(lead || {});
    if (!Object.keys(identifier).length) reasons.push('missing_click_id');
    if (lead?.conflict) reasons.push('conflicting_lead_attribution');
    if (!utcTime(e.time)) reasons.push(e.stage === 'appointment_set' ? 'appointment_booking_time_unavailable' : e.stage === 'sold_job' ? 'quote_approval_time_unavailable' : 'assessment_completion_time_unavailable');
    if (e.noQuote) reasons.push('missing_approved_quote');
    if (e.value == null || !Number.isFinite(Number(e.value)) || Number(e.value) < 0) reasons.push('approved_quote_value_unavailable');
    if (e.time && Date.parse(e.time) > Date.parse(now)) reasons.push('conversion_time_in_future');
    if (lead?.inquiry_at && e.time && Date.parse(e.time) < Date.parse(lead.inquiry_at)) reasons.push('outcome_before_website_submission_review');
    const id = eventId(market, e.stage, e.objectId);
    const payload = reasons.length ? null : { conversionAction: `customers/4800890529/conversionActions/${ACTIONS[e.stage]}`, conversionDateTime: utcTime(e.time), conversionValue: Number(e.value), currencyCode: 'USD', orderId: id, ...identifier };
    return { id, market, stage: e.stage, requestId, clientId: object.client?.id || null, assessmentId: e.assessmentId || null, quoteId: e.quoteId || null, jobId: e.jobId || null, time: e.time || null, windowTime: e.windowTime || now, valueMicros: e.value == null ? null : Math.round(Number(e.value) * 1e6), identifier, payload, reasons, leadId: lead?.lead_id || null };
  });
}

export function validationRequest(rows) {
  return { partialFailure: true, validateOnly: true, conversions: rows.map(r => {
    const id = clickIdentifier(r);
    if (Object.keys(id).length !== 1 || !utcTime(r.conversion_date_time)) throw Error('invalid_validation_row');
    return { conversionAction: 'customers/4800890529/conversionActions/7754270382', conversionDateTime: utcTime(r.conversion_date_time), conversionValue: Number(r.conversion_value), currencyCode: 'USD', orderId: r.event_id, ...id };
  }) };
}

// There is intentionally no real upload method in this stage.
export async function validateGoogleOnly(rows, env, fetchImpl = fetch) {
  const required = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_OAUTH_CLIENT_ID', 'GOOGLE_ADS_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_OAUTH_REFRESH_TOKEN'];
  const missing = required.filter(k => !env[k]);
  const body = validationRequest(rows);
  if (missing.length) return { mode: 'validate_only', recorded: false, attempted: false, missing, rows: rows.map(r => ({ event_id: r.event_id, result: 'NOT_SENT_MISSING_CREDENTIALS', google_result: null })) };
  const auth = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.GOOGLE_ADS_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_ADS_OAUTH_CLIENT_SECRET, refresh_token: env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN }) });
  const token = await auth.json();
  if (!auth.ok || !token.access_token) return { mode: 'validate_only', recorded: false, attempted: false, oauth_error: token.error || 'oauth_failed', rows: rows.map(r => ({ event_id: r.event_id, result: 'NOT_SENT_OAUTH_FAILED', google_result: null })) };
  const response = await fetchImpl(`https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION || 'v25'}/customers/4800890529:uploadClickConversions`, { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN, 'Content-Type': 'application/json', ...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': env.GOOGLE_ADS_LOGIN_CUSTOMER_ID } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  const errors = (result.partialFailureError?.details || []).flatMap(d => d.errors || []);
  const unindexed=errors.filter(e=>!e.location?.fieldPathElements?.some(p=>p.fieldName==='conversions'&&Number.isInteger(p.index)));
  if(response.ok&&result.partialFailureError&&(!errors.length||unindexed.length))return {mode:'validate_only',recorded:false,attempted:true,http_status:response.status,response:result,rows:rows.map(r=>({event_id:r.event_id,result:'UNINDEXED_VALIDATION_ERROR',google_errors:unindexed,request_error:result.partialFailureError}))};
  return { mode: 'validate_only', recorded: false, attempted: true, http_status: response.status, request_id: response.headers.get('request-id'), response: result, rows: rows.map((r, index) => ({ event_id: r.event_id, result: !response.ok ? 'REQUEST_REJECTED' : errors.some(e => e.location?.fieldPathElements?.some(p => p.fieldName === 'conversions' && p.index === index)) ? 'VALIDATION_ERROR' : 'NO_VALIDATION_ERROR_RETURNED_NOT_A_CLICK_MATCH_CONFIRMATION', google_errors: errors.filter(e => e.location?.fieldPathElements?.some(p => p.fieldName === 'conversions' && p.index === index)), request_error: response.ok ? null : result.error })) };
}
