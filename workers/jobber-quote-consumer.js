const QUOTE_ATTRIBUTION_EVENT_NAME = "jobber.quote_attribution.v1";
const BASE_RETRY_DELAY_SECONDS = 60;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;
const DEFAULT_RESOLVER_URL = "https://goodattic.energy/api/jobber/quote-resolve";
const DEFAULT_AUTH_HEALTH_URL = "https://goodattic.energy/api/jobber/oauth/health-check";

const MARKET_BY_ACCOUNT_ID = new Map([
  ["Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==", "ut"],
  ["Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==", "mo_stl"],
]);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function retryDelaySeconds(message) {
  const attempts = Math.max(1, Math.min(10, Number(message?.attempts) || 1));
  return Math.min(MAX_RETRY_DELAY_SECONDS, BASE_RETRY_DELAY_SECONDS * (2 ** (attempts - 1)));
}

function retryMessage(message) {
  message.retry({ delaySeconds: retryDelaySeconds(message) });
}

function allowlistedQuoteIds(env, marketKey) {
  const variable = marketKey === "ut"
    ? env.JOBBER_QUOTE_TEST_ALLOWLIST_UT
    : marketKey === "mo_stl"
      ? env.JOBBER_QUOTE_TEST_ALLOWLIST_STL
      : "";
  return new Set(String(variable || "").split(",").map((value) => clean(value, 500)).filter(Boolean));
}

function quoteAllowedInCurrentMode(env, body) {
  if (clean(env.JOBBER_QUOTE_TEST_MODE, 20).toLowerCase() !== "true") return true;
  return allowlistedQuoteIds(env, body.market_key).has(clean(body.quote_id, 500));
}

function validMessage(body) {
  const accountId = clean(body?.account_id, 500);
  const quoteId = clean(body?.quote_id, 500);
  return body?.schema_version === 1
    && body?.source === "jobber"
    && body?.topic === "QUOTE_CREATE"
    && body?.event_name === QUOTE_ATTRIBUTION_EVENT_NAME
    && Boolean(accountId && quoteId)
    && Boolean(MARKET_BY_ACCOUNT_ID.get(accountId))
    && MARKET_BY_ACCOUNT_ID.get(accountId) === clean(body?.market_key, 40);
}

async function resolveQuote(env, body) {
  const resolverUrl = clean(env.JOBBER_QUOTE_RESOLVER_URL || DEFAULT_RESOLVER_URL, 2000);
  const secret = clean(env.JOBBER_QUOTE_BROKER_SECRET, 2000);
  if (!secret) throw new Error("resolver_secret_not_configured");
  let response;
  try {
    response = await fetch(resolverUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${body.account_id}:${body.quote_id}`,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("resolver_transport_failure");
  }
  let result = null;
  try { result = await response.json(); } catch { /* retry below */ }
  if (!response.ok || !result?.ok) throw new Error(`resolver_http_${response.status || 0}`);
  if (["applied", "skipped"].includes(result.status)) return result;
  if (["missing_request", "quote_not_found"].includes(result.status)) {
    throw new Error(`resolver_pending_${result.status}`);
  }
  throw new Error("resolver_unexpected_status");
}

async function processMessage(message, env) {
  if (!validMessage(message.body)) {
    message.ack();
    return;
  }
  if (!quoteAllowedInCurrentMode(env, message.body)) {
    message.ack();
    return;
  }
  try {
    await resolveQuote(env, message.body);
    message.ack();
  } catch {
    retryMessage(message);
  }
}

async function runAuthorizationHealth(env) {
  const healthUrl = clean(env.JOBBER_AUTH_HEALTH_URL || DEFAULT_AUTH_HEALTH_URL, 2000);
  const secret = clean(env.JOBBER_AUTH_HEALTH_SECRET, 2000);
  if (!secret) throw new Error("auth_health_secret_not_configured");
  const response = await fetch(healthUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  let result = null;
  try { result = await response.json(); } catch { /* report the HTTP status below */ }
  if (!response.ok || !result?.ok) {
    throw new Error(`auth_health_http_${response.status || 0}`);
  }
  return result;
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) await processMessage(message, env);
  },
  async scheduled(_controller, env) {
    try {
      await runAuthorizationHealth(env);
    } catch (error) {
      console.error("Jobber source authorization health check failed.", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  },
};

export const _private = {
  BASE_RETRY_DELAY_SECONDS,
  DEFAULT_AUTH_HEALTH_URL,
  DEFAULT_RESOLVER_URL,
  MARKET_BY_ACCOUNT_ID,
  MAX_RETRY_DELAY_SECONDS,
  QUOTE_ATTRIBUTION_EVENT_NAME,
  allowlistedQuoteIds,
  processMessage,
  quoteAllowedInCurrentMode,
  resolveQuote,
  retryDelaySeconds,
  runAuthorizationHealth,
  validMessage,
};
