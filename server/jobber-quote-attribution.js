import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { _private as leadHelpers } from "../functions/api/leads.js";
import {
  _private as customFieldHelpers,
  applyQuoteCustomFields,
} from "./jobber-custom-fields.js";

const MAX_RESOLVER_BODY_BYTES = 32 * 1024;
const QUOTE_ATTRIBUTION_EVENT_NAME = "jobber.quote_attribution.v1";
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

async function beginAttribution(database, quoteId, lead) {
  const now = new Date().toISOString();
  await database.prepare(`
    /* jobber_quote_attribution:insert */
    INSERT OR IGNORE INTO closed_loop_quote_attributions (
      quote_id, lead_id, market_key, jobber_request_id, status,
      attempt_count, last_error_code, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)
  `).bind(quoteId, lead.lead_id, lead.market_key, lead.jobber_request_id, now, now).run();
  const current = await database.prepare(`
    /* jobber_quote_attribution:select */
    SELECT quote_id, status, attempt_count
    FROM closed_loop_quote_attributions
    WHERE quote_id = ?
    LIMIT 1
  `).bind(quoteId).first();
  if (["applied", "skipped", "manual_review"].includes(current?.status)) return current;
  await database.prepare(`
    /* jobber_quote_attribution:claim */
    UPDATE closed_loop_quote_attributions
    SET status = 'pending', attempt_count = attempt_count + 1,
      last_error_code = NULL, updated_at = ?
    WHERE quote_id = ?
  `).bind(now, quoteId).run();
  return { ...current, quote_id: quoteId, status: "pending" };
}

async function finishAttribution(database, quoteId, status, errorCode = "") {
  const now = new Date().toISOString();
  await database.prepare(`
    /* jobber_quote_attribution:finish */
    UPDATE closed_loop_quote_attributions
    SET status = ?, last_error_code = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('applied', 'skipped', 'manual_review') THEN ? ELSE completed_at END
    WHERE quote_id = ?
  `).bind(status, clean(errorCode, 120) || null, now, status, now, quoteId).run();
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
  if (!route || !quoteId || (input?.market_key && clean(input.market_key, 40) !== route.marketKey)) {
    return jsonResponse({ ok: false, code: "market_account_mismatch" }, 409);
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
    const lead = await findLead(database, requestId);
    const link = quoteLeadLinkStatus(quote, lead, route, accountId);
    if (!link.ok) {
      return jsonResponse({ ok: true, status: "missing_request", quote_id: quote.id, jobber_request_id: requestId });
    }

    const checkpoint = await beginAttribution(database, quote.id, lead);
    if (["applied", "skipped", "manual_review"].includes(checkpoint.status)) {
      return jsonResponse({ ok: true, status: checkpoint.status, quote_id: quote.id, jobber_request_id: requestId });
    }
    const applied = await applyQuoteCustomFields(
      env,
      token.accessToken,
      quote,
      leadForCustomFields(lead),
      requestId,
    );
    if (!applied.ok && !applied.skipped) {
      await finishAttribution(database, quote.id, "retryable", applied.reason);
      const status = applied.reason === "permission_denied" ? 503 : 502;
      return jsonResponse({ ok: false, status: "quote_attribution_failed", quote_id: quote.id, jobber_request_id: requestId, ...applied }, status);
    }
    await finishAttribution(database, quote.id, applied.ok ? "applied" : "skipped", applied.reason);
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
  ENABLED_MARKETS,
  MAX_RESOLVER_BODY_BYTES,
  QUOTE_ATTRIBUTION_EVENT_NAME,
  ROUTES_BY_ACCOUNT_ID,
  bearerAuthorized,
  changes,
  classifyGraphqlFailure,
  findLead,
  beginAttribution,
  finishAttribution,
  leadForCustomFields,
  quoteLeadLinkStatus,
};
