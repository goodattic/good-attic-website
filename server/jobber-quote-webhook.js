import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { verifyJobberWebhookSignature } from "./jobber-appointment-webhook.js";
import { parseQuoteWebhook } from "./jobber-quote-attribution.js";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const RESOLVE_DELAY_SECONDS = 2;

const ROUTES_BY_ACCOUNT_ID = new Map(
  ["ut", "mo_stl"].map((marketKey) => {
    const route = getJobberOAuthRoute(marketKey, "website");
    return [route.expectedAccountId, route];
  }),
);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export async function handleJobberQuoteWebhook({ request, env }) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return jsonResponse({ ok: false, code: "payload_too_large" }, 413);
  }
  let accountId = "";
  try { accountId = clean(JSON.parse(rawBody)?.data?.webHookEvent?.accountId, 500); } catch { /* parser below returns invalid_json */ }
  const route = ROUTES_BY_ACCOUNT_ID.get(accountId);
  const candidateSecrets = [...new Set([
    route ? clean(env[route.clientSecretEnvKey], 1000) : "",
    clean(env.JOBBER_CLIENT_SECRET, 1000),
  ].filter(Boolean))];
  const valid = (await Promise.all(candidateSecrets.map((secret) => (
    verifyJobberWebhookSignature(
      rawBody,
      request.headers.get("X-Jobber-Hmac-SHA256"),
      secret,
    )
  )))).some(Boolean);
  if (!valid) return jsonResponse({ ok: false, code: "invalid_signature" }, 401);

  const parsed = parseQuoteWebhook(rawBody);
  if (!parsed.ok) return jsonResponse({ ok: parsed.status === 202, accepted: false, code: parsed.code }, parsed.status);
  const queue = env.JOBBER_QUOTE_QUEUE;
  if (!queue || typeof queue.send !== "function") {
    return jsonResponse({ ok: false, code: "quote_queue_unavailable" }, 503, { "Retry-After": "30" });
  }
  try {
    await queue.send(parsed.event, { delaySeconds: RESOLVE_DELAY_SECONDS });
  } catch {
    return jsonResponse({ ok: false, code: "quote_enqueue_failed" }, 503, { "Retry-After": "30" });
  }
  return jsonResponse({ ok: true, accepted: true }, 202);
}

export const _private = {
  MAX_WEBHOOK_BODY_BYTES,
  RESOLVE_DELAY_SECONDS,
  ROUTES_BY_ACCOUNT_ID,
};
