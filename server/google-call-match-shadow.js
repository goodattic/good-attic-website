import { matchQuoCallToGoogleCall } from './google-qualified-phone-collector.js';
import { googleToken, readGoogleCalls } from './qualified-phone-runtime.js';

export const GOOGLE_CALL_MATCH_SHADOW_FLAG = 'GOOGLE_CALL_MATCH_SHADOW_ENABLED';
const CUSTOMER = '4800890529';
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const text = (value, max = 500) => typeof value === 'string' || typeof value === 'number'
  ? String(value).trim().slice(0, max) : '';
const iso = value => Number.isFinite(Date.parse(value || '')) ? new Date(value).toISOString() : null;
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);

function held(row, reason) {
  return { ...row, match_state: 'held', diagnostic_code: reason, quo_call_id: null, match_delta_seconds: null };
}

/** Existing market+area-code+time matcher, with stricter unique-call evidence. */
export function evaluateGoogleCallMatches(googleCalls = [], quoCalls = []) {
  const evaluated = googleCalls.map(call => {
    const resource = text(call.google_resource, 500);
    const start = text(call.start_call_date_time, 80);
    const row = {
      google_resource: resource, campaign_id: text(call.campaign_id, 120) || null,
      campaign_name: text(call.campaign_name, 500) || null,
      market_key: text(call.market_key, 40) || null,
      call_started_at_original: start || null, call_started_at_utc: iso(start),
      call_duration_seconds: call.call_duration_seconds != null && Number.isFinite(Number(call.call_duration_seconds))
        ? Math.max(0, Math.trunc(Number(call.call_duration_seconds))) : null,
      caller_area_code: text(call.caller_area_code, 8).replace(/\D/g, '') || null,
      call_status: text(call.call_status, 40) || null,
      match_state: 'held', diagnostic_code: 'unmatched', quo_call_id: null,
      match_delta_seconds: null,
    };
    if (!/^customers\/4800890529\/callViews\/[^/\s]{1,240}$/.test(resource)) return held(row, 'google_resource_invalid');
    const match = matchQuoCallToGoogleCall(call, quoCalls);
    if (!match.ok) return held(row, match.reason);
    if (match.ambiguous) return held(row, 'multiple_quo_calls_same_caller');
    if (!text(match.call?.quo_call_id, 240)) return held(row, 'quo_call_id_missing');
    return { ...row, match_state: 'matched', diagnostic_code: null,
      quo_call_id: text(match.call.quo_call_id, 240), match_delta_seconds: match.delta_seconds };
  });
  const resourceCounts = new Map();
  const quoCounts = new Map();
  for (const row of evaluated) {
    resourceCounts.set(row.google_resource, (resourceCounts.get(row.google_resource) || 0) + 1);
    if (row.quo_call_id) quoCounts.set(row.quo_call_id, (quoCounts.get(row.quo_call_id) || 0) + 1);
  }
  return evaluated.map(row => resourceCounts.get(row.google_resource) > 1
    ? held(row, 'duplicate_google_resource')
    : row.quo_call_id && quoCounts.get(row.quo_call_id) > 1
      ? held(row, 'multiple_google_calls_for_quo_call') : row);
}

async function recordCheck(db, row, runKey, at, suffix = '') {
  await run(db, `INSERT OR IGNORE INTO google_call_match_shadow_checks
    (check_id, run_key, google_resource, match_state, diagnostic_code, quo_call_id, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, `${runKey}:${row.google_resource}${suffix}`,
  runKey, row.google_resource, row.match_state, row.diagnostic_code, row.quo_call_id, at);
}

async function persistMatch(db, candidate, runKey, at) {
  if (!candidate.google_resource) return false;
  let row = candidate;
  const old = await db.prepare('SELECT * FROM google_call_match_shadow WHERE google_resource = ?')
    .bind(row.google_resource).first();
  if (old && ['campaign_id', 'market_key', 'call_started_at_utc', 'caller_area_code']
    .some(key => old[key] !== row[key])) {
    row = held({ ...old, google_resource: candidate.google_resource }, 'google_resource_identity_changed');
  }
  if (old?.quo_call_id && row.quo_call_id && old.quo_call_id !== row.quo_call_id) {
    row = held(row, 'quo_match_changed');
  }
  if (row.quo_call_id) {
    const other = await db.prepare(`SELECT google_resource FROM google_call_match_shadow
      WHERE quo_call_id = ? AND match_state = 'matched' AND google_resource <> ? LIMIT 1`)
      .bind(row.quo_call_id, row.google_resource).first();
    if (other) {
      await run(db, `UPDATE google_call_match_shadow SET match_state = 'held', quo_call_id = NULL,
        match_delta_seconds = NULL, diagnostic_code = 'multiple_google_calls_for_quo_call', last_checked_at = ?
        WHERE google_resource = ?`, at, other.google_resource);
      await recordCheck(db, { google_resource: other.google_resource, match_state: 'held',
        diagnostic_code: 'multiple_google_calls_for_quo_call', quo_call_id: null }, runKey, at, ':demoted');
      row = held(row, 'multiple_google_calls_for_quo_call');
    }
  }
  await run(db, `INSERT INTO google_call_match_shadow (
    google_resource, campaign_id, campaign_name, market_key, call_started_at_original,
    call_started_at_utc, call_duration_seconds, caller_area_code, call_status,
    match_state, diagnostic_code, quo_call_id, match_delta_seconds, first_seen_at, last_checked_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(google_resource) DO UPDATE SET
    call_duration_seconds = excluded.call_duration_seconds, call_status = excluded.call_status,
    match_state = excluded.match_state, diagnostic_code = excluded.diagnostic_code,
    quo_call_id = excluded.quo_call_id, match_delta_seconds = excluded.match_delta_seconds,
    last_checked_at = excluded.last_checked_at`,
  row.google_resource, row.campaign_id, row.campaign_name, row.market_key,
  row.call_started_at_original, row.call_started_at_utc, row.call_duration_seconds,
  row.caller_area_code, row.call_status, row.match_state, row.diagnostic_code,
  row.quo_call_id, row.match_delta_seconds, at, at);
  await recordCheck(db, row, runKey, at);
  return row.match_state === 'matched';
}

/** Independent, shadow-only cycle; it never calls the qualified-phone uploader. */
export async function googleCallMatchShadowCycle(env, {
  scheduledTime = Date.now(), since, fetcher = fetch,
  readToken = googleToken, readCalls = readGoogleCalls,
} = {}) {
  if (env?.[GOOGLE_CALL_MATCH_SHADOW_FLAG] !== 'true') return { disabled: true };
  const db = env.ANGI_ROUTER_DB;
  if (!db?.prepare) return { failed: true, diagnostic_code: 'shadow_database_unavailable' };
  const runKey = `scheduled:${Math.floor(scheduledTime / THREE_HOURS_MS)}`;
  const at = new Date().toISOString();
  const claim = await run(db, `INSERT OR IGNORE INTO google_call_match_shadow_runs
    (run_key, started_at, status) VALUES (?, ?, 'running')`, runKey, at);
  if (changes(claim) !== 1) return { skipped: true };
  try {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(since || '')
      ? since : new Date(scheduledTime - 14 * 86400000).toISOString().slice(0, 10);
    const token = await readToken(env, fetcher);
    const calls = await readCalls(token, start, fetcher);
    const quoStart = new Date(Date.parse(`${start}T00:00:00Z`) - 3 * 60 * 1000).toISOString();
    const quo = await all(db, 'SELECT * FROM quo_call_attributions WHERE call_started_at_utc >= ?', quoStart);
    const evaluated = evaluateGoogleCallMatches(calls, quo);
    let matched = 0;
    for (const row of evaluated) if (await persistMatch(db, row, runKey, at)) matched++;
    await run(db, `UPDATE google_call_match_shadow_runs SET status = 'completed', completed_at = ?,
      google_calls = ?, matched = ?, held = ? WHERE run_key = ?`,
    new Date().toISOString(), evaluated.length, matched, evaluated.length - matched, runKey);
    return { completed: true, google_calls: evaluated.length, matched, held: evaluated.length - matched };
  } catch {
    await run(db, `UPDATE google_call_match_shadow_runs SET status = 'failed', completed_at = ?,
      diagnostic_code = 'google_call_shadow_read_failed' WHERE run_key = ?`, new Date().toISOString(), runKey);
    return { failed: true, diagnostic_code: 'google_call_shadow_read_failed' };
  }
}
