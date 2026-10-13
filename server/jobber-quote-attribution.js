import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { _private as leadHelpers } from "../functions/api/leads.js";
import { canonicalJobberId } from "./acknowledgement-source.js";
import {
  _private as customFieldHelpers,
  applyGoogleCallQuoteDemotion,
  applyGoogleCallQuoteReplay,
  applyQuoteCustomFields,
} from "./jobber-custom-fields.js";

const MAX_RESOLVER_BODY_BYTES = 32 * 1024;
const QUOTE_ATTRIBUTION_EVENT_NAME = "jobber.quote_attribution.v1";
const ATTRIBUTION_CLAIM_LEASE_MS = 2 * 60 * 1000;
const CALL_REPLAY_BATCH_SIZE = 3;
const CALL_REPLAY_CLAIM_LEASE_MS = 2 * 60 * 1000;
const HISTORY_BACKFILL_BATCH_SIZE = 3;
const HISTORY_BACKFILL_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const ENABLED_MARKETS = new Set(["ut", "mo_stl"]);

const ROUTES_BY_ACCOUNT_ID = new Map(
  [...ENABLED_MARKETS].map((marketKey) => {
    const route = getJobberOAuthRoute(marketKey, "website");
    return [route.expectedAccountId, route];
  }),
);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function campaignMarket(name) {
  const markers = [["ut", /\| UT \|/], ["mo_stl", /\| MO-STL \|/], ["mo_kc", /\| MO-KC \|/]]
    .filter(([, pattern]) => pattern.test(name || ""));
  return markers.length === 1 ? markers[0][0] : null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function constantTimeEqualBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function bearerAuthorized(request, expectedSecret) {
  const secret = clean(expectedSecret, 1000);
  const provided = clean(request.headers.get("Authorization"), 1200).match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!secret || !provided) return false;
  const [expectedDigest, providedDigest] = await Promise.all([sha256(secret), sha256(provided)]);
  return constantTimeEqualBytes(expectedDigest, providedDigest);
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function allowlistedQuoteIds(env, marketKey) {
  const variable = marketKey === "ut"
    ? env.JOBBER_QUOTE_TEST_ALLOWLIST_UT
    : marketKey === "mo_stl"
      ? env.JOBBER_QUOTE_TEST_ALLOWLIST_STL
      : "";
  return new Set(String(variable || "").split(",").map((value) => clean(value, 500)).filter(Boolean));
}

function quoteAllowedInCurrentMode(env, marketKey, quoteId) {
  if (clean(env.JOBBER_QUOTE_TEST_MODE, 20).toLowerCase() !== "true") return true;
  return allowlistedQuoteIds(env, marketKey).has(clean(quoteId, 500));
}

async function findLead(database, requestId) {
  return database.prepare(`
    /* jobber_quote_attribution:find_lead */
    SELECT lead_id, market_key, jobber_account_id, jobber_request_id,
      original_source, campaign, landing_page
    FROM closed_loop_leads
    WHERE jobber_request_id = ?
    LIMIT 1
  `).bind(requestId).first();
}

async function verifiedGoogleCallMatch(database, call, marketKey) {
  let result;
  try {
    result = await database.prepare(`
      SELECT google_resource, market_key, campaign_name, caller_area_code,
        call_started_at_utc, diagnostic_code
      FROM google_call_match_shadow
      WHERE quo_call_id = ? AND match_state = 'matched' LIMIT 2
    `).bind(call.quo_call_id).all();
  } catch (error) {
    if (!/no such table.*google_call_match_shadow/i.test(String(error))) throw error;
    return null;
  }
  const matches = result?.results || [];
  if (matches.length !== 1) return null;
  const match = matches[0];
  const callAt = Date.parse(call.call_started_at_utc);
  const googleAt = Date.parse(match.call_started_at_utc);
  if (match.market_key !== marketKey || match.diagnostic_code !== null
    || campaignMarket(match.campaign_name) !== marketKey
    || !/^customers\/4800890529\/callViews\/[^/\s]+$/.test(match.google_resource || "")
    || match.caller_area_code !== call.caller_phone?.slice(2, 5)
    || !Number.isFinite(callAt) || !Number.isFinite(googleAt)
    || Math.abs(googleAt - callAt) > 120_000) return null;
  return { campaign: match.campaign_name, google_resource: match.google_resource };
}

// A Quo call is not a website form submission and does not carry a click ID.
// Keep its source separate, and use a reviewed Request link only when staff
// booked the same inquiry on a second Jobber Request.
async function findCallLead(database, { accountId, marketKey, requestId, clientId }) {
  const direct = await database.prepare(`
    SELECT * FROM quo_call_attributions
    WHERE account_id = ? AND market = ? AND jobber_request_id = ?
      AND jobber_client_id = ? AND direction = 'incoming'
    ORDER BY call_started_at_utc ASC LIMIT 2
  `).bind(accountId, marketKey === "ut" ? "utah" : "stl", requestId, clientId).all();
  const directRows = direct?.results || [];
  if (directRows.length > 1) return null;
  let call = directRows[0] || null;
  let originalRequestId = requestId;
  // Only the current reviewed target can receive call attribution. A later
  // correction retires the prior target without rewriting its audit record.
  let linked;
  try {
    linked = await database.prepare(`
      SELECT * FROM call_request_lineage_active_links
      WHERE account_id = ? AND market_key = ? AND operational_request_id = ?
        AND client_id = ? LIMIT 2
    `).bind(accountId, marketKey, requestId, clientId).all();
  } catch (error) {
    if (!/no such (table|view).*call_request_lineage_active_links/i.test(String(error))) throw error;
    linked = { results: [] };
  }
  const links = linked?.results || [];
  if (links.length > 1 || (call && links.length && links[0].quo_call_id !== call.quo_call_id)) return null;
  if (call) {
    let active;
    try {
      active = await database.prepare(`
        SELECT operational_request_id, client_id FROM call_request_lineage_active_links
        WHERE account_id = ? AND quo_call_id = ? LIMIT 2
      `).bind(accountId, call.quo_call_id).all();
    } catch (error) {
      if (!/no such (table|view).*call_request_lineage_active_links/i.test(String(error))) throw error;
      active = { results: [] };
    }
    const targets = active?.results || [];
    if (targets.length > 1 || (targets.length === 1
      && (targets[0].operational_request_id !== requestId || targets[0].client_id !== clientId))) return null;
  }
  if (!call) {
    if (links.length !== 1) return null;
    const link = links[0];
    originalRequestId = canonicalJobberId(link.original_request_id, "Request");
    if (!originalRequestId || originalRequestId === requestId) return null;
    const source = await database.prepare(`
      SELECT * FROM quo_call_attributions
      WHERE account_id = ? AND quo_call_id = ? AND jobber_request_id = ?
        AND jobber_client_id = ? AND direction = 'incoming' LIMIT 2
    `).bind(accountId, link.quo_call_id, originalRequestId, clientId).all();
    const sourceRows = source?.results || [];
    if (sourceRows.length !== 1 || sourceRows[0].call_started_at_utc !== link.call_started_at_utc) return null;
    call = sourceRows[0];
  }
  if (call?.account_id !== accountId || call?.jobber_client_id !== clientId
    || (marketKey === "ut" ? call.market !== "utah" : call.market !== "stl")
    || !/^AC[A-Za-z0-9_-]{1,160}$/.test(call.quo_call_id || "")) return null;
  const googleMatch = await verifiedGoogleCallMatch(database, call, marketKey);
  return {
    lead_id: `quo-call:${call.quo_call_id}`, market_key: marketKey,
    jobber_account_id: accountId, jobber_request_id: requestId,
    original_request_id: originalRequestId,
    original_source: googleMatch ? "Google Ads call" : "Quo inbound call",
    campaign: googleMatch?.campaign || null,
    google_resource: googleMatch?.google_resource || null,
    landing_page: null,
  };
}

async function hasWebsiteLeadForRequests(database, marketKey, requestId, originalRequestId = requestId) {
  const found = await database.prepare(`
    SELECT 1 AS present FROM closed_loop_leads
      WHERE jobber_request_id IN (?, ?)
    UNION ALL
    SELECT 1 AS present FROM closed_loop_stage1_leads
      WHERE market_key = ? AND request_id IN (?, ?)
    LIMIT 1
  `).bind(requestId, originalRequestId, marketKey, requestId, originalRequestId).first();
  return Boolean(found);
}

async function findHistoricalCallQuoteCandidates(database, nowMs) {
  const rows = await database.prepare(`
    SELECT c.market_key, c.object_id AS quote_id, c.account_id,
      c.operational_request_id AS request_id, o.client_id,
      CASE WHEN c.link_decision_id IS NULL THEN c.direct_max_call_id
        ELSE l.quo_call_id END AS quo_call_id
    FROM call_origin_shadow_object_checks c
    JOIN closed_loop_stage1_objects o
      ON o.market_key = c.market_key AND o.object_type = 'quote'
      AND o.object_id = c.object_id AND o.request_id = c.operational_request_id
    LEFT JOIN call_request_lineage_active_links l
      ON l.account_id = c.account_id AND l.market_key = c.market_key
      AND l.operational_request_id = c.operational_request_id
      AND l.client_id = o.client_id AND l.decision_id = c.link_decision_id
    LEFT JOIN quote_call_history_backfill b ON b.quote_id = c.object_id
    LEFT JOIN closed_loop_quote_attributions a ON a.quote_id = c.object_id
    WHERE c.object_type = 'quote' AND c.check_status = 'resolved'
      AND o.client_id IS NOT NULL
      AND CAST(strftime('%s', o.source_created_at) AS INTEGER) <= ?
      AND ((c.link_decision_id IS NULL AND c.direct_call_count = 1
          AND c.direct_max_call_id IS NOT NULL)
        OR (c.link_decision_id IS NOT NULL AND c.direct_call_count = 0
          AND l.quo_call_id IS NOT NULL))
      AND (a.quote_id IS NULL OR (b.quote_id IS NOT NULL
        AND a.status IN ('pending', 'retryable')
        AND a.lead_id = ('quo-call:' || CASE WHEN c.link_decision_id IS NULL
          THEN c.direct_max_call_id ELSE l.quo_call_id END)
        AND a.market_key = c.market_key
        AND a.jobber_request_id = c.operational_request_id
        AND (a.claim_token IS NULL OR a.claim_expires_at <= ?)))
      AND NOT EXISTS (SELECT 1 FROM closed_loop_leads w
        WHERE w.jobber_request_id IN (o.request_id, COALESCE(l.original_request_id, o.request_id)))
      AND NOT EXISTS (SELECT 1 FROM closed_loop_stage1_leads w
        WHERE w.market_key = c.market_key
          AND w.request_id IN (o.request_id, COALESCE(l.original_request_id, o.request_id)))
      AND (b.quote_id IS NULL OR (b.state IN ('pending', 'retryable')
        AND b.account_id = c.account_id AND b.market_key = c.market_key
        AND b.request_id = c.operational_request_id AND b.client_id = o.client_id
        AND b.quo_call_id = CASE WHEN c.link_decision_id IS NULL
          THEN c.direct_max_call_id ELSE l.quo_call_id END
        AND (b.next_attempt_at IS NULL OR b.next_attempt_at <= ?)
        AND (b.claim_token IS NULL OR b.claim_expires_at <= ?)))
    ORDER BY o.source_created_at ASC, c.object_id ASC LIMIT 12
  `).bind(Math.floor((nowMs - HISTORY_BACKFILL_MIN_AGE_MS) / 1000),
    nowMs, nowMs, nowMs).all();
  return rows?.results || [];
}

async function claimHistoricalCallQuote(database, candidate, nowMs) {
  const now = new Date(nowMs).toISOString();
  await database.prepare(`
    INSERT OR IGNORE INTO quote_call_history_backfill (
      quote_id, market_key, account_id, request_id, client_id, quo_call_id,
      state, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).bind(candidate.quote_id, candidate.market_key, candidate.account_id,
    candidate.request_id, candidate.client_id, candidate.quo_call_id, now, now).run();
  const token = crypto.randomUUID();
  const result = await database.prepare(`
    UPDATE quote_call_history_backfill
    SET state = 'pending', claim_token = ?, claim_expires_at = ?, attempt_count = attempt_count + 1,
      updated_at = ?
    WHERE quote_id = ? AND market_key = ? AND account_id = ?
      AND request_id = ? AND client_id = ? AND quo_call_id = ?
      AND state IN ('pending', 'retryable')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (claim_token IS NULL OR claim_expires_at <= ?)
  `).bind(token, nowMs + ATTRIBUTION_CLAIM_LEASE_MS, now, candidate.quote_id,
    candidate.market_key, candidate.account_id, candidate.request_id,
    candidate.client_id, candidate.quo_call_id, nowMs, nowMs).run();
  return changes(result) === 1 ? token : null;
}

async function finishHistoricalCallQuote(database, candidate, token, outcome) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const result = await database.prepare(`
    UPDATE quote_call_history_backfill
    SET state = ?, claim_token = NULL, claim_expires_at = NULL,
      next_attempt_at = ?, result_status = ?, diagnostic_code = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('applied', 'held') THEN ? ELSE completed_at END
    WHERE quote_id = ? AND claim_token = ?
  `).bind(outcome.state, outcome.state === 'retryable' ? nowMs + 30 * 60 * 1000 : null,
    clean(outcome.resultStatus, 80) || null, clean(outcome.reason, 120) || null, now,
    outcome.state, now, candidate.quote_id, token).run();
  return changes(result) === 1;
}

async function backfillHistoricalCallQuote(env, candidate) {
  const secret = clean(env.JOBBER_QUOTE_BROKER_SECRET, 1000);
  const request = new Request('https://goodattic.energy/api/jobber/quote-resolve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: candidate.account_id, market_key: candidate.market_key,
      quote_id: candidate.quote_id, historical_call_backfill: true,
      expected_request_id: candidate.request_id, expected_client_id: candidate.client_id,
      expected_quo_call_id: candidate.quo_call_id }),
  });
  const response = await resolveQuoteAttribution({ request, env });
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (response.ok && ['applied', 'skipped'].includes(result.status)) {
    return { state: 'applied', resultStatus: result.status, reason: result.reason || '' };
  }
  if (response.ok && ['held', 'manual_review'].includes(result.status)) {
    return { state: 'held', resultStatus: result.status, reason: result.reason || '' };
  }
  return { state: 'retryable', resultStatus: result.status || '',
    reason: result.code || result.reason || 'quote_resolver_failed' };
}

export async function backfillHistoricalCallQuotes({ request, env }) {
  if (!await bearerAuthorized(request, env.JOBBER_QUOTE_BROKER_SECRET)) {
    return jsonResponse({ ok: false, code: 'unauthorized' }, 401);
  }
  if (env.JOBBER_QUOTE_HISTORY_BACKFILL_ENABLED !== 'true') {
    return jsonResponse({ ok: true, status: 'skipped', reason: 'history_backfill_disabled' });
  }
  if (env.EXTERNAL_API_WRITES_ENABLED !== 'true') {
    return jsonResponse({ ok: true, status: 'skipped', reason: 'external_api_writes_disabled' });
  }
  const database = env.ANGI_ROUTER_DB;
  if (!database?.prepare) return jsonResponse({ ok: false, code: 'jobber_authoritative_database_unavailable' }, 503);
  try {
    const nowMs = Date.now();
    const candidates = (await findHistoricalCallQuoteCandidates(database, nowMs))
      .filter((candidate) => quoteAllowedInCurrentMode(env, candidate.market_key, candidate.quote_id))
      .slice(0, HISTORY_BACKFILL_BATCH_SIZE);
    const counts = { applied: 0, held: 0, retryable: 0 };
    for (const candidate of candidates) {
      const route = ROUTES_BY_ACCOUNT_ID.get(candidate.account_id);
      if (!route || route.marketKey !== candidate.market_key || !/^AC[A-Za-z0-9_-]{1,160}$/.test(candidate.quo_call_id || '')) continue;
      const token = await claimHistoricalCallQuote(database, candidate, nowMs);
      if (!token) continue;
      let outcome;
      try { outcome = await backfillHistoricalCallQuote(env, candidate); }
      catch { outcome = { state: 'retryable', reason: 'history_backfill_failed' }; }
      if (!await finishHistoricalCallQuote(database, candidate, token, outcome)) {
        return jsonResponse({ ok: false, code: 'history_backfill_claim_lost' }, 503);
      }
      counts[outcome.state] += 1;
    }
    return jsonResponse({ ok: true, status: 'completed', ...counts });
  } catch {
    return jsonResponse({ ok: false, code: 'history_backfill_unavailable' }, 503);
  }
}

async function findMatchedCallQuoteReplayCandidates(database, nowMs) {
  const rows = await database.prepare(`
    SELECT c.quote_id, c.lead_id, c.market_key, c.jobber_request_id,
      q.account_id, m.quo_call_id, m.google_resource
    FROM closed_loop_quote_attributions c
    JOIN google_call_match_shadow m ON c.lead_id = ('quo-call:' || m.quo_call_id)
    JOIN quo_call_attributions q ON q.quo_call_id = m.quo_call_id
    LEFT JOIN quote_google_call_replays r ON r.quote_id = c.quote_id
    WHERE c.status IN ('applied', 'skipped')
      AND m.match_state = 'matched' AND m.diagnostic_code IS NULL
      AND m.market_key = c.market_key AND q.direction = 'incoming'
      AND ((c.market_key = 'ut' AND q.market = 'utah')
        OR (c.market_key = 'mo_stl' AND q.market = 'stl'))
      AND (r.quote_id IS NULL OR (r.state IN ('pending', 'retryable')
        AND r.google_resource = m.google_resource
        AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ?)
        AND (r.claim_token IS NULL OR r.claim_expires_at <= ?)))
    ORDER BY c.created_at ASC, c.quote_id ASC LIMIT 12
  `).bind(nowMs, nowMs).all();
  return rows?.results || [];
}

async function claimGoogleCallQuoteReplay(database, candidate, nowMs) {
  const now = new Date(nowMs).toISOString();
  await database.prepare(`
    INSERT OR IGNORE INTO quote_google_call_replays (
      quote_id, quo_call_id, google_resource, state, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', 0, ?, ?)
  `).bind(candidate.quote_id, candidate.quo_call_id, candidate.google_resource, now, now).run();
  const token = crypto.randomUUID();
  const claimed = await database.prepare(`
    UPDATE quote_google_call_replays SET claim_token = ?, claim_expires_at = ?,
      attempt_count = attempt_count + 1, updated_at = ?
    WHERE quote_id = ? AND quo_call_id = ? AND google_resource = ?
      AND state IN ('pending', 'retryable')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (claim_token IS NULL OR claim_expires_at <= ?)
  `).bind(token, nowMs + CALL_REPLAY_CLAIM_LEASE_MS, now,
    candidate.quote_id, candidate.quo_call_id, candidate.google_resource, nowMs, nowMs).run();
  return changes(claimed) === 1 ? token : null;
}

async function finishGoogleCallQuoteReplay(database, candidate, token, outcome) {
  const { state, reason = "", campaign = null, promotionWriteVerified = false } = outcome;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const nextAttemptAt = state === "retryable" ? nowMs + 30 * 60 * 1000 : null;
  const updated = await database.prepare(`
    UPDATE quote_google_call_replays
    SET state = ?, claim_token = NULL, claim_expires_at = NULL,
      next_attempt_at = ?, last_error_code = ?, updated_at = ?,
      campaign_written = CASE WHEN ? = 'applied' THEN ? ELSE campaign_written END,
      promotion_write_verified = CASE WHEN ? = 'applied' THEN ? ELSE promotion_write_verified END,
      completed_at = CASE WHEN ? IN ('applied', 'held') THEN ? ELSE completed_at END
    WHERE quote_id = ? AND claim_token = ?
  `).bind(state, nextAttemptAt, clean(reason, 120) || null, now,
    state, state === "applied" ? clean(campaign, 200) || null : null,
    state, promotionWriteVerified ? 1 : 0,
    state, now, candidate.quote_id, token).run();
  return changes(updated) === 1;
}

async function replayMatchedCallQuote(env, database, candidate) {
  const route = ROUTES_BY_ACCOUNT_ID.get(candidate.account_id);
  if (!route || route.marketKey !== candidate.market_key
    || candidate.lead_id !== `quo-call:${candidate.quo_call_id}`) {
    return { state: "held", reason: "account_or_lead_mismatch" };
  }
  const token = await leadHelpers.refreshJobberAccessToken(env, route);
  const quoteResult = await customFieldHelpers.jobberGraphql(
    env, token.accessToken, customFieldHelpers.QUOTE_CONTEXT_QUERY, { id: candidate.quote_id },
  );
  if (!quoteResult.response.ok || quoteResult.data?.errors?.length) {
    return { state: "retryable", reason: classifyGraphqlFailure(quoteResult) };
  }
  const quote = quoteResult.data?.data?.quote;
  if (!quote?.id) return { state: "retryable", reason: "quote_not_found" };
  const requestId = clean(quote.request?.id, 500);
  const clientId = canonicalJobberId(quote.request?.client?.id, "Client");
  if (quote.id !== candidate.quote_id || requestId !== candidate.jobber_request_id || !clientId) {
    return { state: "held", reason: "quote_lineage_changed" };
  }
  const lead = await findCallLead(database, {
    accountId: candidate.account_id, marketKey: candidate.market_key, requestId, clientId,
  });
  if (!lead || lead.lead_id !== candidate.lead_id || !lead.campaign
    || lead.google_resource !== candidate.google_resource) {
    return { state: "retryable", reason: "google_match_not_current" };
  }
  const applied = await applyGoogleCallQuoteReplay(
    env, token.accessToken, quote, lead.original_request_id || requestId, lead.campaign,
  );
  if (applied.ok) return { state: "applied", reason: applied.alreadyApplied ? "already_applied" : "",
    campaign: lead.campaign, promotionWriteVerified: !applied.alreadyApplied };
  if (applied.skipped && ["quote_fields_changed", "original_lead_field_mismatch", "quote_lineage_changed"].includes(applied.reason)) {
    return { state: "held", reason: applied.reason };
  }
  return { state: "retryable", reason: applied.reason || "jobber_rejected" };
}

async function recordInitialGoogleCallQuoteWrite(database, quoteId, lead, applied) {
  if (!applied?.ok || !lead?.google_resource || !lead?.lead_id?.startsWith("quo-call:")) return;
  const written = new Set(applied.appliedFields || []);
  if (!written.has("Original Source") || !written.has("Campaign")) return;
  const now = new Date().toISOString();
  await database.prepare(`
    INSERT OR IGNORE INTO quote_google_call_replays (
      quote_id, quo_call_id, google_resource, state, attempt_count,
      campaign_written, promotion_write_verified, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, 'applied', 1, ?, 1, ?, ?, ?)
  `).bind(quoteId, lead.lead_id.slice("quo-call:".length), lead.google_resource,
    clean(lead.campaign, 200), now, now, now).run();
}

async function findGoogleCallDemotionCandidates(database, nowMs) {
  const rows = await database.prepare(`
    SELECT r.quote_id, r.quo_call_id, r.google_resource, r.campaign_written,
      c.lead_id, c.market_key, c.jobber_request_id, q.account_id,
      COALESCE(m.diagnostic_code, CASE WHEN m.google_resource IS NULL
        THEN 'google_match_missing' ELSE 'google_match_changed' END) AS diagnostic_code
    FROM quote_google_call_replays r
    JOIN closed_loop_quote_attributions c ON c.quote_id = r.quote_id
    JOIN quo_call_attributions q ON q.quo_call_id = r.quo_call_id
    LEFT JOIN google_call_match_shadow m ON m.google_resource = r.google_resource
    LEFT JOIN quote_google_call_demotions d ON d.quote_id = r.quote_id
    WHERE r.state = 'applied' AND r.promotion_write_verified = 1
      AND r.campaign_written IS NOT NULL AND c.status IN ('applied', 'skipped')
      AND c.lead_id = ('quo-call:' || r.quo_call_id) AND q.direction = 'incoming'
      AND ((c.market_key = 'ut' AND q.market = 'utah')
        OR (c.market_key = 'mo_stl' AND q.market = 'stl'))
      AND (m.google_resource IS NULL OR m.match_state <> 'matched'
        OR m.diagnostic_code IS NOT NULL OR m.quo_call_id <> r.quo_call_id
        OR m.market_key <> c.market_key
        OR substr(m.campaign_name, 1, 200) <> r.campaign_written)
      AND (d.quote_id IS NULL OR (d.state IN ('pending', 'retryable')
        AND d.google_resource = r.google_resource
        AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?)
        AND (d.claim_token IS NULL OR d.claim_expires_at <= ?)))
    ORDER BY r.completed_at ASC, r.quote_id ASC LIMIT 12
  `).bind(nowMs, nowMs).all();
  return rows?.results || [];
}

async function claimGoogleCallDemotion(database, candidate, nowMs) {
  const now = new Date(nowMs).toISOString();
  await database.prepare(`
    INSERT OR IGNORE INTO quote_google_call_demotions (
      quote_id, quo_call_id, google_resource, campaign_written, state,
      diagnostic_code, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?)
  `).bind(candidate.quote_id, candidate.quo_call_id, candidate.google_resource,
    candidate.campaign_written, clean(candidate.diagnostic_code, 120), now, now).run();
  const token = crypto.randomUUID();
  const claimed = await database.prepare(`
    UPDATE quote_google_call_demotions
    SET claim_token = ?, claim_expires_at = ?, attempt_count = attempt_count + 1,
      diagnostic_code = ?, updated_at = ?
    WHERE quote_id = ? AND quo_call_id = ? AND google_resource = ?
      AND campaign_written = ? AND state IN ('pending', 'retryable')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (claim_token IS NULL OR claim_expires_at <= ?)
  `).bind(token, nowMs + CALL_REPLAY_CLAIM_LEASE_MS,
    clean(candidate.diagnostic_code, 120), now, candidate.quote_id,
    candidate.quo_call_id, candidate.google_resource, candidate.campaign_written,
    nowMs, nowMs).run();
  return changes(claimed) === 1 ? token : null;
}

async function finishGoogleCallDemotion(database, candidate, token, outcome) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const nextAttemptAt = outcome.state === "retryable" ? nowMs + 30 * 60 * 1000 : null;
  const updated = await database.prepare(`
    UPDATE quote_google_call_demotions
    SET state = ?, claim_token = NULL, claim_expires_at = NULL,
      next_attempt_at = ?, last_error_code = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('reverted', 'held') THEN ? ELSE completed_at END
    WHERE quote_id = ? AND claim_token = ?
  `).bind(outcome.state, nextAttemptAt, clean(outcome.reason, 120) || null,
    now, outcome.state, now, candidate.quote_id, token).run();
  return changes(updated) === 1;
}

async function demoteGoogleCallQuote(env, database, candidate) {
  const route = ROUTES_BY_ACCOUNT_ID.get(candidate.account_id);
  if (!route || route.marketKey !== candidate.market_key
    || candidate.lead_id !== `quo-call:${candidate.quo_call_id}`) {
    return { state: "held", reason: "account_or_lead_mismatch" };
  }
  const match = await database.prepare(`
    SELECT match_state, diagnostic_code, quo_call_id, market_key, campaign_name
    FROM google_call_match_shadow WHERE google_resource = ?
  `).bind(candidate.google_resource).first();
  if (match?.match_state === "matched" && match.diagnostic_code === null
    && match.quo_call_id === candidate.quo_call_id && match.market_key === candidate.market_key
    && clean(match.campaign_name, 200) === candidate.campaign_written) {
    return { state: "retryable", reason: "google_match_restored" };
  }
  const token = await leadHelpers.refreshJobberAccessToken(env, route);
  const quoteResult = await customFieldHelpers.jobberGraphql(
    env, token.accessToken, customFieldHelpers.QUOTE_CONTEXT_QUERY, { id: candidate.quote_id },
  );
  if (!quoteResult.response.ok || quoteResult.data?.errors?.length) {
    return { state: "retryable", reason: classifyGraphqlFailure(quoteResult) };
  }
  const quote = quoteResult.data?.data?.quote;
  if (!quote?.id) return { state: "retryable", reason: "quote_not_found" };
  const requestId = clean(quote.request?.id, 500);
  const clientId = canonicalJobberId(quote.request?.client?.id, "Client");
  if (quote.id !== candidate.quote_id || requestId !== candidate.jobber_request_id || !clientId) {
    return { state: "held", reason: "quote_lineage_changed" };
  }
  const lead = await findCallLead(database, {
    accountId: candidate.account_id, marketKey: candidate.market_key, requestId, clientId,
  });
  if (!lead || lead.lead_id !== candidate.lead_id || lead.jobber_request_id !== requestId) {
    return { state: "held", reason: "call_lineage_changed" };
  }
  const applied = await applyGoogleCallQuoteDemotion(
    env, token.accessToken, quote, lead.original_request_id || requestId,
    candidate.campaign_written,
  );
  if (applied.ok) return { state: "reverted", reason: applied.alreadyReverted ? "already_reverted" : "" };
  if (applied.skipped && ["quote_fields_changed", "original_lead_field_mismatch", "quote_lineage_changed"].includes(applied.reason)) {
    return { state: "held", reason: applied.reason };
  }
  return { state: "retryable", reason: applied.reason || "jobber_rejected" };
}

export async function replayMatchedCallQuotes({ request, env }) {
  if (!await bearerAuthorized(request, env.JOBBER_QUOTE_BROKER_SECRET)) {
    return jsonResponse({ ok: false, code: "unauthorized" }, 401);
  }
  const database = env.ANGI_ROUTER_DB;
  if (!database?.prepare) return jsonResponse({ ok: false, code: "jobber_authoritative_database_unavailable" }, 503);
  if (env.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return jsonResponse({ ok: true, status: "skipped", reason: "external_api_writes_disabled" });
  }
  try {
    const nowMs = Date.now();
    const demotions = (await findGoogleCallDemotionCandidates(database, nowMs))
      .filter((candidate) => quoteAllowedInCurrentMode(env, candidate.market_key, candidate.quote_id))
      .slice(0, CALL_REPLAY_BATCH_SIZE);
    const counts = { applied: 0, held: 0, retryable: 0,
      reverted: 0, demotion_held: 0, demotion_retryable: 0 };
    for (const candidate of demotions) {
      const token = await claimGoogleCallDemotion(database, candidate, nowMs);
      if (!token) continue;
      let outcome;
      try {
        outcome = await demoteGoogleCallQuote(env, database, candidate);
      } catch (error) {
        outcome = { state: "retryable", reason: clean(error?.details?.code, 120) || "demotion_failed" };
      }
      if (!await finishGoogleCallDemotion(database, candidate, token, outcome)) {
        return jsonResponse({ ok: false, code: "demotion_claim_lost" }, 503);
      }
      counts[outcome.state === "reverted" ? "reverted" : `demotion_${outcome.state}`] += 1;
    }
    const candidates = (await findMatchedCallQuoteReplayCandidates(database, nowMs))
      .filter((candidate) => quoteAllowedInCurrentMode(env, candidate.market_key, candidate.quote_id))
      .slice(0, Math.max(0, CALL_REPLAY_BATCH_SIZE - demotions.length));
    for (const candidate of candidates) {
      const token = await claimGoogleCallQuoteReplay(database, candidate, nowMs);
      if (!token) continue;
      let outcome;
      try {
        outcome = await replayMatchedCallQuote(env, database, candidate);
      } catch (error) {
        outcome = { state: "retryable", reason: clean(error?.details?.code, 120) || "replay_failed" };
      }
      if (!await finishGoogleCallQuoteReplay(database, candidate, token, outcome)) {
        return jsonResponse({ ok: false, code: "replay_claim_lost" }, 503);
      }
      counts[outcome.state] += 1;
    }
    return jsonResponse({ ok: true, status: "completed", ...counts });
  } catch {
    return jsonResponse({ ok: false, code: "call_replay_unavailable" }, 503);
  }
}

async function beginAttribution(database, quoteId, lead) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const claimToken = crypto.randomUUID();
  await database.prepare(`
    /* jobber_quote_attribution:insert */
    INSERT OR IGNORE INTO closed_loop_quote_attributions (
      quote_id, lead_id, market_key, jobber_request_id, status,
      attempt_count, last_error_code, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)
  `).bind(quoteId, lead.lead_id, lead.market_key, lead.jobber_request_id, now, now).run();
  const current = await database.prepare(`
    /* jobber_quote_attribution:select */
    SELECT quote_id, status, attempt_count, claim_token, claim_expires_at
    FROM closed_loop_quote_attributions
    WHERE quote_id = ?
    LIMIT 1
  `).bind(quoteId).first();
  if (["applied", "skipped", "manual_review"].includes(current?.status)) return current;
  const claimed = await database.prepare(`
    /* jobber_quote_attribution:claim */
    UPDATE closed_loop_quote_attributions
    SET status = 'pending', claim_token = ?, claim_expires_at = ?, attempt_count = attempt_count + 1,
      last_error_code = NULL, updated_at = ?
    WHERE quote_id = ?
      AND status IN ('pending', 'retryable')
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR claim_expires_at <= ?)
  `).bind(claimToken, nowMs + ATTRIBUTION_CLAIM_LEASE_MS, now, quoteId, nowMs).run();
  if (changes(claimed) !== 1) {
    return { ...current, quote_id: quoteId, claimed: false };
  }
  return {
    ...current,
    quote_id: quoteId,
    status: "pending",
    claimed: true,
    claimToken,
  };
}

async function finishAttribution(database, quoteId, claimToken, status, errorCode = "") {
  const now = new Date().toISOString();
  const result = await database.prepare(`
    /* jobber_quote_attribution:finish */
    UPDATE closed_loop_quote_attributions
    SET status = ?, claim_token = NULL, claim_expires_at = NULL,
      last_error_code = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('applied', 'skipped', 'manual_review') THEN ? ELSE completed_at END
    WHERE quote_id = ? AND status = 'pending' AND claim_token = ?
  `).bind(status, clean(errorCode, 120) || null, now, status, now, quoteId, claimToken).run();
  return changes(result) === 1;
}

function leadForCustomFields(record) {
  return {
    market_key: record?.market_key,
    source_label: record?.original_source,
    campaign: record?.campaign,
    source_url: record?.landing_page,
  };
}

export function quoteLeadLinkStatus(quote, lead, route, accountId) {
  const requestId = clean(quote?.request?.id, 500);
  if (!requestId) return { ok: false, status: "missing_request", requestId: "" };
  if (!lead || lead.market_key !== route?.marketKey || (lead.jobber_account_id && lead.jobber_account_id !== accountId)) {
    return { ok: false, status: "missing_request", requestId };
  }
  return { ok: true, status: "linked", requestId };
}

function classifyGraphqlFailure(result) {
  const message = JSON.stringify(result?.data?.errors || result?.data || {}).toLowerCase();
  if ([401, 403].includes(Number(result?.response?.status)) || /permission|scope|unauthori[sz]|forbidden/.test(message)) {
    return "permission_denied";
  }
  return Number(result?.response?.status) >= 500 ? "jobber_unavailable" : "jobber_rejected";
}

export function buildQuoteQueueEvent({ accountId, quoteId, occurredAt }) {
  const route = ROUTES_BY_ACCOUNT_ID.get(clean(accountId, 500));
  const itemId = clean(quoteId, 500);
  if (!route || !itemId) return null;
  return {
    schema_version: 1,
    source: "jobber",
    topic: "QUOTE_CREATE",
    event_name: QUOTE_ATTRIBUTION_EVENT_NAME,
    account_id: route.expectedAccountId,
    quote_id: itemId,
    occurred_at: clean(occurredAt, 80) || new Date().toISOString(),
    market_key: route.marketKey,
  };
}

export function parseQuoteWebhook(rawBody) {
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return { ok: false, status: 400, code: "invalid_json" }; }
  const event = payload?.data?.webHookEvent;
  const topic = clean(event?.topic, 80).toUpperCase();
  const accountId = clean(event?.accountId, 500);
  const quoteId = clean(event?.itemId, 500);
  if (topic !== "QUOTE_CREATE") return { ok: false, status: 202, code: "unsupported_topic" };
  if (!accountId || !quoteId) return { ok: false, status: 400, code: "incomplete_event" };
  const queued = buildQuoteQueueEvent({
    accountId,
    quoteId,
    occurredAt: event?.occurredAt || event?.occuredAt,
  });
  if (!queued) return { ok: false, status: 202, code: "unknown_account" };
  return { ok: true, event: queued };
}

export async function resolveQuoteAttribution({ request, env }) {
  if (!await bearerAuthorized(request, env.JOBBER_QUOTE_BROKER_SECRET)) {
    return jsonResponse({ ok: false, code: "unauthorized" }, 401);
  }
  const database = env.ANGI_ROUTER_DB;
  if (!database || typeof database.prepare !== "function") {
    return jsonResponse({ ok: false, code: "jobber_authoritative_database_unavailable" }, 503);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_RESOLVER_BODY_BYTES) {
    return jsonResponse({ ok: false, code: "payload_too_large" }, 413);
  }
  let input;
  try { input = JSON.parse(rawBody); } catch { return jsonResponse({ ok: false, code: "invalid_json" }, 400); }
  const accountId = clean(input?.account_id, 500);
  const quoteId = clean(input?.quote_id, 500);
  const route = ROUTES_BY_ACCOUNT_ID.get(accountId);
  const historical = input?.historical_call_backfill === true;
  if (!route || !quoteId || (input?.market_key && clean(input.market_key, 40) !== route.marketKey)) {
    return jsonResponse({ ok: false, code: "market_account_mismatch" }, 409);
  }
  if (historical && (env.JOBBER_QUOTE_HISTORY_BACKFILL_ENABLED !== "true"
    || !canonicalJobberId(input?.expected_request_id, "Request")
    || !canonicalJobberId(input?.expected_client_id, "Client")
    || !/^AC[A-Za-z0-9_-]{1,160}$/.test(input?.expected_quo_call_id || ""))) {
    return jsonResponse({ ok: false, code: "invalid_history_backfill" }, 409);
  }
  if (!quoteAllowedInCurrentMode(env, route.marketKey, quoteId)) {
    return jsonResponse({ ok: true, status: "skipped", reason: "quote_not_allowlisted", quote_id: quoteId });
  }
  if (env.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return jsonResponse({ ok: true, status: "skipped", reason: "external_api_writes_disabled" });
  }

  try {
    const token = await leadHelpers.refreshJobberAccessToken(env, route);
    const quoteResult = await customFieldHelpers.jobberGraphql(
      env,
      token.accessToken,
      customFieldHelpers.QUOTE_CONTEXT_QUERY,
      { id: quoteId },
    );
    if (!quoteResult.response.ok || quoteResult.data?.errors?.length) {
      return jsonResponse({ ok: false, code: classifyGraphqlFailure(quoteResult) }, 503);
    }
    const quote = quoteResult.data?.data?.quote;
    if (!quote?.id) return jsonResponse({ ok: true, status: "quote_not_found" });
    const requestId = clean(quote.request?.id, 500);
    if (!requestId) return jsonResponse({ ok: true, status: "missing_request", quote_id: quote.id });
    const clientId = canonicalJobberId(quote.request?.client?.id, "Client");
    if (historical && (quote.id !== quoteId || requestId !== input.expected_request_id
      || clientId !== input.expected_client_id)) {
      return jsonResponse({ ok: true, status: "held", reason: "quote_lineage_changed", quote_id: quoteId });
    }
    const lead = await findLead(database, requestId)
      || (clientId ? await findCallLead(database, { accountId, marketKey: route.marketKey, requestId, clientId }) : null);
    if (historical && (!lead || lead.lead_id !== `quo-call:${input.expected_quo_call_id}`
      || lead.jobber_request_id !== requestId)) {
      return jsonResponse({ ok: true, status: "held", reason: "call_lineage_changed", quote_id: quoteId });
    }
    if (historical && await hasWebsiteLeadForRequests(database, route.marketKey,
      requestId, lead.original_request_id || requestId)) {
      return jsonResponse({ ok: true, status: "held", reason: "website_precedence", quote_id: quoteId });
    }
    const link = quoteLeadLinkStatus(quote, lead, route, accountId);
    if (!link.ok) {
      return jsonResponse({ ok: true, status: "missing_request", quote_id: quote.id, jobber_request_id: requestId });
    }

    const checkpoint = await beginAttribution(database, quote.id, lead);
    if (["applied", "skipped", "manual_review"].includes(checkpoint.status)) {
      return jsonResponse({ ok: true, status: checkpoint.status, quote_id: quote.id, jobber_request_id: requestId });
    }
    if (!checkpoint.claimed) {
      return jsonResponse({ ok: false, status: "claim_busy", quote_id: quote.id, jobber_request_id: requestId }, 503);
    }
    const applied = await applyQuoteCustomFields(
      env,
      token.accessToken,
      quote,
      leadForCustomFields(lead),
      lead.original_request_id || requestId,
      historical ? { strictExistingValues: true, requireBlankPaidFields: true } : {},
    );
    if (historical && applied.reason === "quote_fields_conflict") {
      const finished = await finishAttribution(database, quote.id, checkpoint.claimToken,
        "manual_review", applied.reason);
      if (!finished) return jsonResponse({ ok: false, status: "claim_lost" }, 503);
      return jsonResponse({ ok: true, status: "manual_review", reason: applied.reason,
        quote_id: quote.id, jobber_request_id: requestId });
    }
    if (!applied.ok && !applied.skipped) {
      const finished = await finishAttribution(database, quote.id, checkpoint.claimToken, "retryable", applied.reason);
      if (!finished) return jsonResponse({ ok: false, status: "claim_lost" }, 503);
      const status = applied.reason === "permission_denied" ? 503 : 502;
      return jsonResponse({ ok: false, status: "quote_attribution_failed", quote_id: quote.id, jobber_request_id: requestId, ...applied }, status);
    }
    await recordInitialGoogleCallQuoteWrite(database, quote.id, lead, applied);
    const finished = await finishAttribution(
      database,
      quote.id,
      checkpoint.claimToken,
      applied.ok ? "applied" : "skipped",
      applied.reason,
    );
    if (!finished) return jsonResponse({ ok: false, status: "claim_lost" }, 503);
    return jsonResponse({
      ok: true,
      status: applied.ok ? "applied" : "skipped",
      quote_id: quote.id,
      jobber_request_id: requestId,
      result: applied,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      code: clean(error?.details?.code, 120) || "quote_attribution_failed",
    }, 503);
  }
}

export const _private = {
  ATTRIBUTION_CLAIM_LEASE_MS,
  ENABLED_MARKETS,
  MAX_RESOLVER_BODY_BYTES,
  QUOTE_ATTRIBUTION_EVENT_NAME,
  ROUTES_BY_ACCOUNT_ID,
  bearerAuthorized,
  changes,
  classifyGraphqlFailure,
  findLead,
  findCallLead,
  hasWebsiteLeadForRequests,
  findHistoricalCallQuoteCandidates,
  claimHistoricalCallQuote,
  finishHistoricalCallQuote,
  backfillHistoricalCallQuote,
  backfillHistoricalCallQuotes,
  verifiedGoogleCallMatch,
  findMatchedCallQuoteReplayCandidates,
  claimGoogleCallQuoteReplay,
  finishGoogleCallQuoteReplay,
  replayMatchedCallQuote,
  recordInitialGoogleCallQuoteWrite,
  findGoogleCallDemotionCandidates,
  claimGoogleCallDemotion,
  finishGoogleCallDemotion,
  demoteGoogleCallQuote,
  beginAttribution,
  finishAttribution,
  leadForCustomFields,
  allowlistedQuoteIds,
  quoteLeadLinkStatus,
  quoteAllowedInCurrentMode,
  resolveQuoteAttribution,
};
