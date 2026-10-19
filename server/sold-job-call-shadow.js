import { canonicalJobberId } from './acknowledgement-source.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';
import { marketForDestination } from './google-qualified-phone-collector.js';
import { campaignMarket, denverTime } from './qualified-phone-runtime.js';
import { operationalRequestId } from './call-origin-stage3c-shadow.js';

export const SOLD_JOB_CALL_ACTION_ID = '7788072382';
export const SOLD_JOB_CALL_CUSTOMER_ID = '4800890529';
const WINDOW_MS = 90 * 86400000;
const MATCH_WINDOW_MS = 120000;
const id = (value, type) => canonicalJobberId(value, type);
const iso = value => Number.isFinite(Date.parse(value || '')) ? new Date(value).toISOString() : null;
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const first = async (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const validPhone = value => /^\+1\d{10}$/.test(value || '');
const unique = values => [...new Set(values)];

/** Google CallConversion has no orderId. The local candidate key provides dedupe. */
export function formatSoldJobCallValidationPayload(candidate) {
  if (candidate?.state !== 'shadow_ready' || candidate?.consent_status !== 'granted'
    || !candidate?.consent_evidence_ref || !validPhone(candidate.caller_phone)
    || !candidate?.google_resource?.startsWith(`customers/${SOLD_JOB_CALL_CUSTOMER_ID}/callViews/`)
    || !Number.isSafeInteger(candidate.value_micros) || candidate.value_micros <= 0
    || !iso(candidate.call_started_at_utc) || !iso(candidate.google_call_started_at_utc)
    || !iso(candidate.quote_approved_at)
    || Date.parse(candidate.quote_approved_at) <= Date.parse(candidate.call_started_at_utc)
    || Date.parse(candidate.quote_approved_at) <= Date.parse(candidate.google_call_started_at_utc)) {
    throw Error('sold_job_call_payload_unverified');
  }
  const conversion = {
    conversionAction: `customers/${SOLD_JOB_CALL_CUSTOMER_ID}/conversionActions/${SOLD_JOB_CALL_ACTION_ID}`,
    callerId: candidate.caller_phone,
    callStartDateTime: denverTime(candidate.google_call_started_at_utc),
    conversionDateTime: denverTime(candidate.quote_approved_at),
    conversionValue: candidate.value_micros / 1e6,
    currencyCode: 'USD',
    consent: { adUserData: 'GRANTED' },
  };
  return { customerId: SOLD_JOB_CALL_CUSTOMER_ID, partialFailure: true,
    validateOnly: true, conversions: [conversion] };
}

/** Only a verified call-origin quote observation can become a candidate. */
export function buildSoldJobCallShadowCandidate({ shadowEvent, objectRow, quoCall,
  googleMatches = [], lineageLink = null, websiteClickRows = [], consent = {},
  approvedQuoteCountForCall = 1,
  now = new Date().toISOString() } = {}) {
  const event = shadowEvent || {};
  const accountId = id(event.account_id, 'Account');
  const quoteId = id(event.quote_id, 'Quote');
  if (!accountId || !quoteId || !event.event_id || event.event_name !== 'quote_approved') {
    return { ok: false, reason: 'quote_shadow_event_identity_missing' };
  }
  const market = event.market_key;
  const route = getJobberOAuthRoute(market, 'website');
  const identityReasons = [];
  const uploadReasons = [];
  const add = (list, condition, reason) => { if (!condition) list.push(reason); };
  const callAt = iso(quoCall?.call_started_at_utc);
  const approvedAt = iso(event.occurred_at);
  const originalRequest = id(event.original_request_id, 'Request');
  const operationalRequest = id(event.operational_request_id, 'Request');
  const clientId = id(event.client_id, 'Client');
  add(identityReasons, route?.expectedAccountId === accountId, 'jobber_account_mismatch');
  add(identityReasons, Boolean(originalRequest && operationalRequest && clientId), 'request_or_client_id_missing');
  add(identityReasons, event.evidence_kind === (lineageLink
    ? 'verified_lineage' : 'original_request'), 'call_lineage_kind_conflict');
  add(identityReasons, quoCall?.account_id === accountId && quoCall?.quo_call_id === event.quo_call_id
    && id(quoCall?.jobber_request_id, 'Request') === originalRequest
    && id(quoCall?.jobber_client_id, 'Client') === clientId
    && (quoCall?.market === 'utah' && market === 'ut' || quoCall?.market === 'stl' && market === 'mo_stl')
    && quoCall?.direction === 'incoming' && validPhone(quoCall?.caller_phone)
    && marketForDestination(quoCall?.destination_number) === market
    && callAt === iso(event.call_started_at_utc), 'quo_call_identity_conflict');
  if (lineageLink) {
    add(identityReasons, lineageLink?.account_id === accountId
      && lineageLink?.quo_call_id === event.quo_call_id
      && id(lineageLink?.original_request_id, 'Request') === originalRequest
      && id(lineageLink?.operational_request_id, 'Request') === operationalRequest
      && id(lineageLink?.client_id, 'Client') === clientId
      && iso(lineageLink?.call_started_at_utc) === callAt
      && lineageLink?.market_key === market && Boolean(lineageLink?.decision_id)
      && lineageLink.decision_id === event.link_decision_id,
    'verified_request_lineage_missing_or_conflicting');
  } else {
    if (event.evidence_kind === 'verified_lineage') {
      identityReasons.push('verified_request_lineage_missing_or_conflicting');
    }
    add(identityReasons, originalRequest === operationalRequest
      && event.evidence_kind === 'original_request'
      && event.link_decision_id == null, 'unverified_request_lineage');
  }

  let object = null;
  try { object = JSON.parse(objectRow?.object_json || ''); } catch { /* held below */ }
  add(identityReasons, objectRow?.market_key === market
    && objectRow?.object_type === event.source_object_type
    && objectRow?.object_id === event.source_object_id && Boolean(object),
  'source_object_snapshot_missing_or_conflicting');
  const quote = event.source_object_type === 'quote' ? object : object?.quote;
  const objectRequest = object ? operationalRequestId(event.source_object_type, object) : null;
  add(identityReasons, objectRequest === operationalRequest
    && id(object?.client?.id, 'Client') === clientId
    && id(quote?.id, 'Quote') === quoteId
    && id(quote?.request?.id, 'Request') === operationalRequest
    && id(quote?.client?.id, 'Client') === clientId,
  'quote_request_client_conflict');
  add(identityReasons, ['approved', 'converted'].includes(String(quote?.quoteStatus || '').toLowerCase()),
    'quote_status_not_approved');
  add(identityReasons, iso(quote?.lastTransitioned?.approvedAt) === approvedAt && Boolean(approvedAt),
    'quote_approval_time_conflict');
  const quoteTotal = Number(quote?.amounts?.total);
  const valueMicros = quote?.amounts?.total != null && Number.isFinite(quoteTotal)
    ? Math.round(quoteTotal * 1e6) : null;
  add(identityReasons, Number.isSafeInteger(valueMicros) && valueMicros > 0,
    'approved_quote_amount_unavailable');
  add(identityReasons, Boolean(callAt && approvedAt && Date.parse(approvedAt) > Date.parse(callAt)),
    'quote_approval_before_call');

  const matched = googleMatches.filter(row => row.match_state === 'matched');
  const match = matched.length === 1 ? matched[0] : null;
  add(identityReasons, matched.length === 1, matched.length > 1
    ? 'multiple_google_call_matches' : 'google_call_match_missing');
  const googleAt = iso(match?.call_started_at_utc);
  add(identityReasons, match?.diagnostic_code == null
    && match?.quo_call_id === event.quo_call_id && match?.market_key === market
    && /^customers\/4800890529\/callViews\/[^/\s]+$/.test(match?.google_resource || '')
    && campaignMarket(match?.campaign_name) === market
    && String(match?.caller_area_code || '') === quoCall?.caller_phone?.slice(2, 5)
    && googleAt && callAt && Math.abs(Date.parse(googleAt) - Date.parse(callAt)) <= MATCH_WINDOW_MS
    && Number(match?.match_delta_seconds) <= 120
    && Number(match?.match_delta_seconds) >= 0,
  'google_call_identity_conflict');
  add(identityReasons, Boolean(googleAt && approvedAt
    && Date.parse(approvedAt) > Date.parse(googleAt)), 'quote_approval_before_google_call');

  const nowAt = Date.parse(now);
  add(uploadReasons, Boolean(approvedAt && Number.isFinite(nowAt)
    && Date.parse(approvedAt) <= nowAt
    && callAt && Date.parse(approvedAt) - Date.parse(callAt) <= WINDOW_MS
    && nowAt - Date.parse(approvedAt) <= WINDOW_MS), 'conversion_outside_action_window');
  add(uploadReasons, !websiteClickRows.some(row => row && ['gclid', 'gbraid', 'wbraid']
    .some(field => Boolean(String(row[field] || '').trim()))), 'website_click_path_exists_review');
  add(uploadReasons, approvedQuoteCountForCall === 1, 'multiple_approved_quotes_for_call_review');
  const consentStatus = consent.status === 'granted' ? 'granted'
    : consent.status === 'denied' ? 'denied' : 'unknown';
  const consentRef = typeof consent.evidence_ref === 'string' ? consent.evidence_ref.trim() : '';
  add(uploadReasons, consentStatus === 'granted' && Boolean(consentRef),
    consentStatus === 'denied' ? 'ad_user_data_consent_denied' : 'ad_user_data_consent_unverified');

  const reasons = unique([...identityReasons, ...uploadReasons]);
  const candidateId = `sold-job-call:${accountId}:${quoteId}`;
  const identityVerified = identityReasons.length === 0;
  const state = reasons.length ? 'held' : 'shadow_ready';
  const evidence = {
    source_event_id: event.event_id, evidence_kind: event.evidence_kind,
    source_object_type: event.source_object_type, source_object_id: event.source_object_id,
    lineage_decision_id: lineageLink?.decision_id || null,
    lineage_revision: lineageLink?.revision ?? null,
    quo_call_id: event.quo_call_id, original_request_id: originalRequest,
    operational_request_id: operationalRequest, client_id: clientId,
    quo_call_started_at_utc: callAt, google_resource: match?.google_resource || null,
    google_campaign_id: match?.campaign_id || null,
    google_match_delta_seconds: match?.match_delta_seconds ?? null,
    quote_status: quote?.quoteStatus || null,
    quote_approved_at: approvedAt, quote_value_micros: valueMicros,
    website_click_path_present: uploadReasons.includes('website_click_path_exists_review'),
    consent_evidence_ref: consentRef || null,
  };
  const candidate = {
    candidate_id: candidateId, source_event_id: event.event_id,
    account_id: accountId, market_key: market, quo_call_id: event.quo_call_id,
    original_request_id: originalRequest, operational_request_id: operationalRequest,
    client_id: clientId, quote_id: quoteId, job_id: event.job_id || null,
    google_resource: match?.google_resource || null,
    caller_phone: quoCall?.caller_phone || null,
    call_started_at_utc: callAt, google_call_started_at_utc: googleAt,
    quote_approved_at: approvedAt, value_micros: valueMicros,
    google_conversion_action: SOLD_JOB_CALL_ACTION_ID,
    identity_verified: identityVerified ? 1 : 0,
    consent_status: consentStatus, consent_evidence_ref: consentRef || null,
    state, hold_reasons_json: JSON.stringify(reasons),
    evidence_json: JSON.stringify(evidence), payload_json: null,
  };
  if (state === 'shadow_ready') candidate.payload_json = JSON.stringify(formatSoldJobCallValidationPayload(candidate));
  return { ok: true, candidate, reasons, evidence };
}

async function observationId(candidate) {
  const content = [candidate.candidate_id, candidate.state, candidate.hold_reasons_json,
    candidate.evidence_json, candidate.payload_json || ''].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return 'sold-call-evidence:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** D1-only reconciliation. It reads existing ledgers and cannot contact Google or Jobber. */
export async function collectSoldJobCallShadow({ database, consentByCall = {}, now = new Date().toISOString() } = {}) {
  if (!database?.prepare) return { ok: false, reason: 'shadow_database_unavailable' };
  const events = await all(database, `SELECT * FROM call_origin_shadow_current_events
    WHERE event_name = 'quote_approved' ORDER BY occurred_at, event_id`);
  const callCounts = new Map();
  for (const event of events) {
    const key = `${event.account_id}:${event.quo_call_id}`;
    callCounts.set(key, (callCounts.get(key) || 0) + 1);
  }
  const stats = { observed: events.length, shadow_ready: 0, held: 0, conflicts: 0 };
  for (const event of events) {
    const [objectRow, quoCall, googleMatches, lineageLink, websiteClickRows] = await Promise.all([
      first(database, `SELECT * FROM closed_loop_stage1_objects
        WHERE market_key = ? AND object_type = ? AND object_id = ?`,
      event.market_key, event.source_object_type, event.source_object_id),
      first(database, `SELECT * FROM quo_call_attributions WHERE account_id = ? AND quo_call_id = ?`,
        event.account_id, event.quo_call_id),
      all(database, `SELECT * FROM google_call_match_shadow WHERE quo_call_id = ?`, event.quo_call_id),
      first(database, `SELECT * FROM call_request_lineage_active_links WHERE account_id = ? AND quo_call_id = ?`,
        event.account_id, event.quo_call_id),
      all(database, `SELECT * FROM closed_loop_stage1_leads WHERE market_key = ?
        AND request_id IN (?, ?)`, event.market_key, event.original_request_id, event.operational_request_id),
    ]);
    const built = buildSoldJobCallShadowCandidate({ shadowEvent: event, objectRow,
      quoCall, googleMatches, lineageLink, websiteClickRows,
      consent: consentByCall[event.quo_call_id],
      approvedQuoteCountForCall: callCounts.get(`${event.account_id}:${event.quo_call_id}`), now });
    if (!built.ok) { stats.conflicts++; continue; }
    const c = built.candidate;
    const stored = await first(database, `SELECT candidate_id, source_event_id, account_id, quo_call_id,
      operational_request_id, client_id FROM sold_job_call_shadow_candidates
      WHERE candidate_id = ?`, c.candidate_id);
    const storedEventCurrent = stored && stored.source_event_id !== c.source_event_id
      ? await first(database, `SELECT event_id FROM call_origin_shadow_current_events WHERE event_id = ?`,
        stored.source_event_id) : null;
    if (stored && (stored.account_id !== c.account_id || stored.quo_call_id !== c.quo_call_id
      || stored.client_id !== c.client_id || storedEventCurrent)) {
      stats.conflicts++; continue;
    }
    const fields = ['candidate_id', 'source_event_id', 'account_id', 'market_key',
      'quo_call_id', 'original_request_id', 'operational_request_id', 'client_id',
      'quote_id', 'job_id', 'google_resource', 'quote_approved_at', 'value_micros',
      'google_conversion_action', 'identity_verified', 'consent_status', 'state',
      'hold_reasons_json', 'evidence_json', 'payload_json'];
    await database.prepare(`INSERT INTO sold_job_call_shadow_candidates
      (${fields.join(', ')}, created_at, updated_at)
      VALUES (${fields.map(() => '?').join(', ')}, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        source_event_id = excluded.source_event_id,
        original_request_id = excluded.original_request_id,
        operational_request_id = excluded.operational_request_id,
        client_id = excluded.client_id,
        job_id = COALESCE(excluded.job_id, sold_job_call_shadow_candidates.job_id),
        google_resource = excluded.google_resource,
        quote_approved_at = excluded.quote_approved_at,
        value_micros = excluded.value_micros,
        identity_verified = excluded.identity_verified,
        consent_status = excluded.consent_status,
        state = excluded.state,
        hold_reasons_json = excluded.hold_reasons_json,
        evidence_json = excluded.evidence_json,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at`)
      .bind(...fields.map(field => c[field]), now, now).run();
    const evidenceId = await observationId(c);
    await database.prepare(`INSERT OR IGNORE INTO sold_job_call_shadow_evidence
      (observation_id, candidate_id, source_event_id, state, hold_reasons_json,
        evidence_json, payload_json, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(evidenceId, c.candidate_id, c.source_event_id, c.state,
        c.hold_reasons_json, c.evidence_json, c.payload_json, now).run();
    stats[c.state]++;
  }
  return { ok: true, mode: 'shadow', upload_enabled: false, ...stats };
}
