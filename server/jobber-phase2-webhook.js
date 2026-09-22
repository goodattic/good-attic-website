import { _private as leadHelpers } from "../functions/api/leads.js";
import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { verifyJobberWebhookSignature } from "./jobber-appointment-webhook.js";
import { collectJobberLifecycle } from "./google-ads-outcome-collection.js";
import { createJobberPhase2Reader } from "./jobber-phase2-reader.js";
import { normalizeJobberWebhook } from "./google-ads-outcome-watcher.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleJobberPhase2Webhook({ request, env }) {
  const raw = await request.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ ok: false, code: "invalid_json" }, 400); }
  const event = normalizeJobberWebhook(payload);
  if (!event.ok) return json({ ok: false, code: event.reason }, event.reason === "account_not_enabled" ? 202 : 400);
  const route = getJobberOAuthRoute(event.market_key, "website");
  const secret = env[route.clientSecretEnvKey] || env.JOBBER_CLIENT_SECRET;
  if (!await verifyJobberWebhookSignature(raw, request.headers.get("X-Jobber-Hmac-SHA256"), secret)) return json({ ok: false, code: "invalid_signature" }, 401);
  const reader = createJobberPhase2Reader({
    tokenForMarket: async market => (await leadHelpers.refreshJobberAccessToken(env, getJobberOAuthRoute(market, "website"))).accessToken,
    fetchImpl: env.fetchImpl || globalThis.fetch,
  });
  try {
    const result = await collectJobberLifecycle({ database: env.ANGI_ROUTER_DB, payload, readObject: reader.readObject });
    return json({ ok: true, mode: "shadow", event: { topic: event.topic, market: event.market_key, item_id: event.item_id }, outcome_count: result.outcome_count || 0, writes: result.writes || [] }, 202);
  } catch (error) {
    return json({ ok: false, mode: "shadow", code: String(error?.code || "jobber_phase2_read_failed").slice(0, 100) }, 503);
  }
}

export const _private = { json };
