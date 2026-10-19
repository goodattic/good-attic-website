import {
  buildOutcomeCandidate,
  normalizeE164,
  persistOutcomeCandidate,
} from "./stage3c-outcome-watcher.js";

export const QUALIFIED_CALL_ACTION_ID = "7742989654";
export const MATCH_WINDOW_SECONDS = 120;
export const GOOGLE_COUNTED_CALL_SECONDS = 60;
export const JOBBER_LOOKBACK_SECONDS = 60 * 60;
export const JOBBER_LOOKAHEAD_SECONDS = 7 * 24 * 60 * 60;
export const MARKET_LINES = Object.freeze({
  ut: "+13853364442",
  mo_stl: "+13149312620",
  mo_kc: "+18164340308",
});
export const JOBBER_ACCOUNTS = Object.freeze({ ut: "2498432", mo_stl: "2498453", mo_kc: "1919824" });

function text(value, max = 500) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function areaCode(phone) {
  const normalized = normalizeE164(phone || "");
  return normalized?.slice(2, 5) || null;
}

export function marketForDestination(destination) {
  const number = normalizeE164(destination || "");
  return Object.entries(MARKET_LINES).find(([, line]) => line === number)?.[0] || null;
}

export function googleCallKey(call = {}, callerPhone) {
  const campaign = text(call.campaign_id || call.campaign || "unknown", 120);
  const start = text(call.start_call_date_time || call.startCallDateTime, 80);
  const caller = normalizeE164(callerPhone || "") || `area-${text(call.caller_area_code, 8)}`;
  return `${campaign}:${start}:${caller}`;
}

export function googleCallEligible(call = {}) {
  const status = text(call.call_status || call.callStatus, 40).toLowerCase();
  const duration = Number(call.call_duration_seconds ?? call.callDurationSeconds);
  return ["missed", "no_answer", "no-answer"].includes(status)
    || (Number.isFinite(duration) && duration < GOOGLE_COUNTED_CALL_SECONDS);
}

export function matchQuoCallToGoogleCall(googleCall = {}, quoCalls = []) {
  const googleAt = timestamp(googleCall.start_call_date_time || googleCall.startCallDateTime);
  const targetMarket = text(googleCall.market_key) || marketForDestination(googleCall.destination_number);
  const googleArea = text(googleCall.caller_area_code, 8).replace(/\D/g, "") || null;
  if (googleAt == null || !targetMarket || !googleArea) return { ok: false, reason: "google_call_missing_match_fields" };
  const candidates = quoCalls.map((call) => {
    const quoAt = timestamp(call.call_started_at_utc || call.call_started_at_original);
    const quoArea = areaCode(call.caller_phone);
    const destinationMarket = marketForDestination(call.destination_number) || text(call.market_key);
    const delta = quoAt == null ? Infinity : Math.abs(quoAt - googleAt) / 1000;
    return { call, delta, quoArea, destinationMarket };
  }).filter((candidate) => candidate.destinationMarket === targetMarket && candidate.quoArea === googleArea && candidate.delta <= MATCH_WINDOW_SECONDS && text(candidate.call.direction || "incoming").toLowerCase() === "incoming")
    .sort((a, b) => a.delta - b.delta);
  if (!candidates.length) return { ok: false, reason: "no_matching_quo_call" };
  if (new Set(candidates.map(c => c.call.caller_phone)).size > 1) return { ok: false, reason: "ambiguous_quo_call" };
  return { ok: true, call: candidates[0].call, delta_seconds: candidates[0].delta, ambiguous: candidates.length > 1 };
}

export function matchJobberLead({ callerPhone, googleCallAt, marketKey, records = [] } = {}) {
  const caller = normalizeE164(callerPhone || "");
  const callAt = timestamp(googleCallAt);
  if (!caller || callAt == null || !marketKey) return { ok: false, reason: "jobber_match_fields_missing" };
  const matches = records.filter((record) => {
    if (text(record.market_key) && text(record.market_key) !== marketKey) return false;
    if (normalizeE164(record.phone || record.caller_phone || record.client_phone || "") !== caller) return false;
    const created = timestamp(record.created_at || record.createdAt || record.request_created_at);
    if (created == null || created < callAt - JOBBER_LOOKBACK_SECONDS * 1000 || created > callAt + JOBBER_LOOKAHEAD_SECONDS * 1000) return false;
    if (record.deleted === true || record.is_duplicate === true || record.junk === true) return false;
    if (record.existing_customer === true || record.prior_completed_work === true) return false;
    return true;
  }).sort((a, b) => timestamp(a.created_at || a.createdAt) - timestamp(b.created_at || b.createdAt));
  if (!matches.length) return { ok: false, reason: "no_new_jobber_lead" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous_jobber_lead", records: matches };
  return { ok: true, record: matches[0] };
}

export function buildQualifiedPhoneCandidate({ googleCall, quoCall, jobberRecord } = {}) {
  const marketKey = text(googleCall?.market_key) || marketForDestination(googleCall?.destination_number) || text(quoCall?.market_key);
  const googleStart = googleCall?.start_call_date_time || googleCall?.startCallDateTime;
  const requestId = text(jobberRecord?.jobber_request_id || jobberRecord?.request_id || jobberRecord?.id) || null;
  const result = buildOutcomeCandidate({
    event_name: "qualified_lead",
    market_key: marketKey,
    google_call_key: googleCallKey(googleCall, quoCall?.caller_phone),
    google_account_id: "4800890529",
    google_conversion_action: QUALIFIED_CALL_ACTION_ID,
    jobber_request_id: requestId,
    jobber_client_id: jobberRecord?.jobber_client_id || jobberRecord?.client_id,
    milestone_at: jobberRecord?.created_at || jobberRecord?.createdAt,
    conversion_at: jobberRecord?.created_at || jobberRecord?.createdAt,
    quoCall: { ...quoCall, call_started_at_original: googleStart, call_started_at_utc: new Date(timestamp(googleStart)).toISOString() },
    value_micros: 0,
    consent_status: "unknown",
    allow_market: true,
  });
  if (!result.ok) return result;
  return { ok: true, candidate: { ...result.candidate, google_call_key: googleCallKey(googleCall, quoCall?.caller_phone), upload_state: "held", diagnostic_code: "shadow_only" } };
}

export async function collectQualifiedPhoneCalls({ database, googleCalls = [], quoCalls = [], jobberRecordsByMarket = {} } = {}) {
  const rows = [];
  for (const googleCall of googleCalls) {
    if (!googleCallEligible(googleCall)) { rows.push({ google_call: googleCall, matched_quo: false, reason: "google_call_already_counted" }); continue; }
    const quo = matchQuoCallToGoogleCall(googleCall, quoCalls);
    if (!quo.ok) { rows.push({ google_call: googleCall, matched_quo: false, reason: quo.reason }); continue; }
    const marketKey = text(googleCall.market_key) || marketForDestination(googleCall.destination_number) || quo.call.market_key;
    const jobber = matchJobberLead({ callerPhone: quo.call.caller_phone, googleCallAt: googleCall.start_call_date_time, marketKey, records: jobberRecordsByMarket[marketKey] || [] });
    if (!jobber.ok) { rows.push({ google_call: googleCall, market_key: marketKey, matched_quo: true, quo_call_id: quo.call.quo_call_id, matched_jobber: false, reason: jobber.reason }); continue; }
    const candidate = buildQualifiedPhoneCandidate({ googleCall: { ...googleCall, market_key: marketKey }, quoCall: quo.call, jobberRecord: jobber.record });
    if (!candidate.ok) { rows.push({ google_call: googleCall, market_key: marketKey, matched_quo: true, matched_jobber: true, reason: candidate.reason }); continue; }
    const write = database ? await persistOutcomeCandidate(database, candidate.candidate) : { ok: true, inserted: false };
    rows.push({ google_call: googleCall, market_key: marketKey, matched_quo: true, matched_jobber: true, candidate: candidate.candidate, write });
  }
  return { ok: true, mode: "shadow", upload_enabled: false, rows };
}
