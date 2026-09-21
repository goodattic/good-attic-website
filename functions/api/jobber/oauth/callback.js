import { getJobberOAuthRoute } from "./config.js";
import { filterQuoteCustomFieldConfigurations } from "../../../../server/jobber-custom-fields.js";

const JOBBER_API_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const DEFAULT_JOBBER_GRAPHQL_VERSION = "2025-04-16";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;
const PROCESS_LOCK_LEASE_MS = 4 * 60 * 1000;
const QUOTE_WRITE_PROBE_MUTATION = `
  mutation GoodAtticQuoteWriteProbe($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(quoteId: $quoteId, attributes: $attributes) {
      quote { id }
      userErrors { message path }
    }
  }
`;

class OAuthSetupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "OAuthSetupError";
    this.status = status;
  }
}

function clean(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? "")
    .slice(0, 12000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(title, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f4f8f3; color: #173323; }
      main { max-width: 880px; margin: 0 auto; padding: 48px 20px; }
      .panel { background: white; border: 1px solid rgba(23, 51, 35, .14); border-radius: 8px; box-shadow: 0 18px 50px rgba(23, 51, 35, .12); padding: 28px; }
      h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.15; }
      h2 { margin-top: 26px; font-size: 18px; }
      p, li { line-height: 1.6; }
      code, textarea { background: #eef4ec; border: 1px solid rgba(23, 51, 35, .12); border-radius: 4px; }
      code { padding: 2px 5px; }
      textarea { box-sizing: border-box; color: #173323; display: block; font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; min-height: 108px; padding: 12px; resize: vertical; width: 100%; }
      .muted { color: #587464; }
      .warning { background: #fff9e8; border: 1px solid #ecd392; border-radius: 6px; padding: 12px 14px; }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        ${body}
      </section>
    </main>
  </body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeText(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function signStateBody(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function getMarketRoute(value, source = "website") {
  return getJobberOAuthRoute(value, source);
}

async function verifyState(env, state) {
  const setupKey = clean(env.JOBBER_OAUTH_SETUP_KEY, 500);
  if (!setupKey) throw new OAuthSetupError("Missing JOBBER_OAUTH_SETUP_KEY.", 503);

  const [body, signature] = clean(state, 2000).split(".");
  if (!body || !signature) throw new OAuthSetupError("The OAuth state was missing or malformed.", 400);

  const expectedSignature = await signStateBody(setupKey, body);
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new OAuthSetupError("The OAuth state signature was invalid.", 401);
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecodeText(body));
  } catch {
    throw new OAuthSetupError("The OAuth state payload could not be decoded.", 400);
  }

  if (!payload?.market || !payload?.ts) {
    throw new OAuthSetupError("The OAuth state payload was incomplete.", 400);
  }

  const stateAgeMs = Date.now() - Number(payload.ts);
  if (!Number.isFinite(stateAgeMs) || stateAgeMs < -60_000 || stateAgeMs > STATE_MAX_AGE_MS) {
    throw new OAuthSetupError("The OAuth state has expired. Start the Jobber connection again.", 400);
  }

  const route = getMarketRoute(payload.market, payload.source || "website");
  if (!route) throw new OAuthSetupError("The OAuth state referenced an unknown market.", 400);

  return route;
}

function getClientConfig(env, route) {
  const clientId = clean(env[route.clientIdEnvKey], 500)
    || clean(env[route.fallbackClientIdEnvKey], 500);
  const clientSecret = clean(env[route.clientSecretEnvKey], 1000)
    || clean(env[route.fallbackClientSecretEnvKey], 1000);
  return { clientId, clientSecret };
}

function getRedirectUri(env, request) {
  if (clean(env.JOBBER_OAUTH_REDIRECT_URI, 500)) return clean(env.JOBBER_OAUTH_REDIRECT_URI, 500);
  const url = new URL(request.url);
  return `${url.origin}/api/jobber/oauth/callback`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function scrubTokenResponse(data) {
  if (!data || typeof data !== "object") return data;
  const clone = JSON.parse(JSON.stringify(data));
  if (clone.access_token) clone.access_token = "[redacted]";
  if (clone.refresh_token) clone.refresh_token = "[redacted]";
  return clone;
}

async function exchangeAuthorizationCode(env, route, code, redirectUri) {
  const config = getClientConfig(env, route);
  if (!config.clientId || !config.clientSecret) {
    throw new OAuthSetupError(`Missing Jobber client credentials for ${route.accountLabel}.`, 503);
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await safeJson(response);
  if (!response.ok || !data?.access_token || !data?.refresh_token) {
    throw new OAuthSetupError(`Jobber token exchange failed: ${JSON.stringify(scrubTokenResponse(data))}`, response.status || 502);
  }

  return data;
}

async function queryJobberAccount(env, accessToken) {
  const response = await fetch(JOBBER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": clean(env.JOBBER_GRAPHQL_VERSION, 40) || DEFAULT_JOBBER_GRAPHQL_VERSION,
    },
    body: JSON.stringify({
      query: "query GoodAtticAccountCheck { account { id name } }",
    }),
  });

  const data = await safeJson(response);
  if (!response.ok || data?.errors?.length) {
    return {
      ok: false,
      message: JSON.stringify(data?.errors || data || { status: response.status }),
    };
  }

  return {
    ok: true,
    account: data?.data?.account || null,
  };
}

async function queryJobberQuoteCapabilities(env, accessToken) {
  const response = await fetch(JOBBER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": clean(env.JOBBER_GRAPHQL_VERSION, 40) || DEFAULT_JOBBER_GRAPHQL_VERSION,
    },
    body: JSON.stringify({
      query: `
        query GoodAtticQuoteCapabilities {
          quotes(first: 1) { nodes { id quoteNumber } }
          customFieldConfigurations(first: 50) {
            nodes {
              ... on CustomFieldConfigurationArea { __typename id name valueType appliesTo readOnly }
              ... on CustomFieldConfigurationDropdown { __typename id name valueType appliesTo readOnly }
              ... on CustomFieldConfigurationLink { __typename id name valueType appliesTo readOnly }
              ... on CustomFieldConfigurationNumeric { __typename id name valueType appliesTo readOnly }
              ... on CustomFieldConfigurationText { __typename id name valueType appliesTo readOnly }
              ... on CustomFieldConfigurationTrueFalse { __typename id name valueType appliesTo readOnly }
            }
          }
        }
      `,
    }),
  });
  const data = await safeJson(response);
  if (!response.ok || data?.errors?.length) {
    return { ok: false, quoteRead: false, customFieldRead: false, errors: data?.errors || [] };
  }
  const configurations = data?.data?.customFieldConfigurations?.nodes || [];
  const quoteConfigurations = filterQuoteCustomFieldConfigurations(configurations);
  const names = new Set(quoteConfigurations.map((item) => item?.name).filter(Boolean));
  const requiredNames = ["Original Lead ID", "Original Source", "Campaign"];
  const quote = data?.data?.quotes?.nodes?.[0] || null;
  const write = await verifyJobberQuoteWriteAccess(env, accessToken, quote);
  return {
    ok: requiredNames.every((name) => names.has(name)) && write.ok,
    quoteRead: Boolean(quote?.id),
    customFieldRead: true,
    quoteWrite: write.ok,
    quoteWriteReason: write.reason,
    customFieldNames: requiredNames.filter((name) => names.has(name)),
    missingCustomFieldNames: requiredNames.filter((name) => !names.has(name)),
  };
}

async function verifyJobberQuoteWriteAccess(env, accessToken, quote) {
  if (!quote?.id || !clean(quote.quoteNumber, 500)) {
    return { ok: false, reason: "no_quote_available_for_write_probe" };
  }

  const response = await fetch(JOBBER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": clean(env.JOBBER_GRAPHQL_VERSION, 40) || DEFAULT_JOBBER_GRAPHQL_VERSION,
    },
    body: JSON.stringify({
      query: QUOTE_WRITE_PROBE_MUTATION,
      variables: {
        quoteId: quote.id,
        // Re-submit the existing quote number so this is a real write-scope
        // check without changing customer-visible quote content.
        attributes: { quoteNumber: clean(quote.quoteNumber, 500) },
      },
    }),
  });
  const data = await safeJson(response);
  const userErrors = data?.data?.quoteEdit?.userErrors || [];
  if (!response.ok || data?.errors?.length || userErrors.length || !data?.data?.quoteEdit?.quote?.id) {
    return {
      ok: false,
      reason: "quote_write_probe_failed",
      errors: data?.errors || [],
      userErrors,
    };
  }
  return { ok: true };
}

async function persistRefreshToken(env, route, refreshToken) {
  const tokenStore = env.JOBBER_TOKEN_STORE;
  if (!tokenStore || typeof tokenStore.put !== "function") return false;
  await tokenStore.put(`jobber_refresh_token:${route.refreshTokenEnvKey}`, refreshToken);
  return true;
}

function getAuthAccountKey(route) {
  if (route?.authAccountKey) return route.authAccountKey;
  throw new OAuthSetupError("The Jobber market cannot be checkpointed.", 500);
}

function d1Changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function requireExpectedJobberAccount(route, accountResult) {
  if (!accountResult?.ok || !accountResult?.account?.id) {
    throw new OAuthSetupError(
      `Jobber account verification failed for ${route.accountLabel}. No credentials were saved; start the connection again.`,
      503,
    );
  }

  if (accountResult.account.id !== route.expectedAccountId) {
    throw new OAuthSetupError(
      `The authorized Jobber login is not the expected ${route.accountLabel} account. No credentials were saved.`,
      409,
    );
  }

  return accountResult.account;
}

function requireAuthoritativeDatabase(env) {
  const database = env.ANGI_ROUTER_DB;
  if (!database || typeof database.prepare !== "function") {
    throw new OAuthSetupError(
      "The authoritative Jobber token database is unavailable. No credentials were saved.",
      503,
    );
  }
  return database;
}

async function acquireJobberProcessLock(env, route) {
  const database = requireAuthoritativeDatabase(env);
  const lockName = route.processLockName;
  const leaseToken = crypto.randomUUID();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  try {
    await database
      .prepare(`
        /* jobber_oauth_callback:ensure_process_lock */
        INSERT OR IGNORE INTO angi_router_locks (
          lock_name, lease_token, lease_expires_at, updated_at
        ) VALUES (?, NULL, NULL, ?)
      `)
      .bind(lockName, nowIso)
      .run();

    const acquired = await database
      .prepare(`
        /* jobber_oauth_callback:acquire_process_lock */
        UPDATE angi_router_locks
        SET lease_token = ?, lease_expires_at = ?, updated_at = ?
        WHERE lock_name = ?
          AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
      `)
      .bind(leaseToken, now + PROCESS_LOCK_LEASE_MS, nowIso, lockName, now)
      .run();

    if (d1Changes(acquired) !== 1) {
      throw new OAuthSetupError(
        `The ${route.accountLabel} Jobber authorization checkpoint is busy. Start the connection again shortly.`,
        503,
      );
    }
  } catch (error) {
    if (error instanceof OAuthSetupError) throw error;
    throw new OAuthSetupError(
      "The authoritative Jobber token lock could not be acquired. No credentials were exchanged or saved.",
      503,
    );
  }

  return { lockName, leaseToken };
}

async function releaseJobberProcessLock(env, lock) {
  if (!lock) return;
  const database = env.ANGI_ROUTER_DB;
  if (!database || typeof database.prepare !== "function") return;

  try {
    await database
      .prepare(`
        /* jobber_oauth_callback:release_process_lock */
        UPDATE angi_router_locks
        SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE lock_name = ? AND lease_token = ?
      `)
      .bind(new Date().toISOString(), lock.lockName, lock.leaseToken)
      .run();
  } catch {
    // The short lease expires automatically if D1 is temporarily unavailable.
  }
}

async function persistAuthorizedJobberTokens(env, route, tokenData, accountResult) {
  requireExpectedJobberAccount(route, accountResult);
  const accountKey = getAuthAccountKey(route);
  const expiresInSeconds = Math.max(
    60,
    Math.min(7200, Number(tokenData.expires_in) || 3600),
  );
  const accessExpiresAt = Date.now() + (expiresInSeconds * 1000);
  const database = requireAuthoritativeDatabase(env);

  let checkpointed = false;
  try {
    const result = await database
      .prepare(`
        /* jobber_oauth_callback:upsert_jobber_auth */
        INSERT INTO angi_router_jobber_auth (
          account_key,
          access_token,
          access_expires_at,
          refresh_token,
          refresh_revision,
          refresh_status,
          refresh_lease_token,
          refresh_lease_expires_at,
          last_error_code,
          updated_at
        ) VALUES (?, ?, ?, ?, 1, 'ready', NULL, NULL, NULL, ?)
        ON CONFLICT(account_key) DO UPDATE SET
          access_token = excluded.access_token,
          access_expires_at = excluded.access_expires_at,
          refresh_token = excluded.refresh_token,
          refresh_revision = COALESCE(angi_router_jobber_auth.refresh_revision, 0) + 1,
          refresh_status = 'ready',
          refresh_lease_token = NULL,
          refresh_lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = excluded.updated_at
      `)
      .bind(
        accountKey,
        tokenData.access_token,
        accessExpiresAt,
        tokenData.refresh_token,
        new Date().toISOString(),
      )
      .run();
    checkpointed = d1Changes(result) === 1;
  } catch {
    // A D1 response can be lost after commit. Verify the exact token pair below.
  }

  if (!checkpointed) {
    try {
      const verified = await database
        .prepare(`
          /* jobber_oauth_callback:verify_jobber_auth */
          SELECT
            access_token,
            access_expires_at,
            refresh_token,
            COALESCE(refresh_status, 'ready') AS refresh_status
          FROM angi_router_jobber_auth
          WHERE account_key = ?
        `)
        .bind(accountKey)
        .first();
      checkpointed = verified?.access_token === tokenData.access_token
        && Number(verified.access_expires_at || 0) === accessExpiresAt
        && verified.refresh_token === tokenData.refresh_token
        && verified.refresh_status === "ready";
    } catch {
      checkpointed = false;
    }
  }

  if (!checkpointed) {
    throw new OAuthSetupError(
      "Jobber authorization succeeded, but the authoritative D1 token checkpoint failed. Reconnect before using this account.",
      503,
    );
  }

  let kvPersisted = false;
  try {
    kvPersisted = await persistRefreshToken(env, route, tokenData.refresh_token);
  } catch {
    // D1 is authoritative. A compatibility KV write must never invalidate a
    // successfully checkpointed authorization or invite a second OAuth flow.
  }

  return {
    accountKey,
    accessExpiresAt,
    d1Persisted: true,
    kvPersisted,
  };
}

function renderSuccess(route, accountResult, persistence, capabilities) {
  const account = accountResult.ok && accountResult.account
    ? `${accountResult.account.name || "Unnamed account"} (${accountResult.account.id || "no id returned"})`
    : "Account query did not return account details.";
  const repeatLinks = route.sourceKey === "angi"
    ? `<li>Salt Lake City: <code>/api/jobber/oauth/start?market=slc&amp;source=angi&amp;setup_key=...</code></li>`
    : `<li>Salt Lake City: <code>/api/jobber/oauth/start?market=slc&amp;source=${escapeHtml(route.sourceKey)}&amp;setup_key=...</code></li>
      <li>St. Louis: <code>/api/jobber/oauth/start?market=stl&amp;source=${escapeHtml(route.sourceKey)}&amp;setup_key=...</code></li>
      <li>Kansas City: <code>/api/jobber/oauth/start?market=kc&amp;source=${escapeHtml(route.sourceKey)}&amp;setup_key=...</code></li>`;

  return htmlResponse(
    `${route.sourceLabel} ${route.accountLabel} Jobber connected`,
    `<h1>${escapeHtml(route.sourceLabel)} leads are connected to ${escapeHtml(route.accountLabel)} Jobber.</h1>
    <p>The token pair is now checkpointed in the authoritative D1 record for the <strong>${escapeHtml(route.sourceLabel)}</strong> source app and <strong>${escapeHtml(route.accountLabel)}</strong> account.</p>

    <h2>Confirmed Jobber account</h2>
    <p><code>${escapeHtml(account)}</code></p>
    ${accountResult.ok ? "" : `<p class="warning">The OAuth token exchange succeeded, but the account check query did not complete: ${escapeHtml(accountResult.message)}</p>`}

    <h2>Authoritative checkpoint</h2>
    <p class="muted">D1 persisted: <strong>${persistence.d1Persisted ? "yes" : "no"}</strong></p>
    <p class="muted">Compatibility KV mirror: <strong>${persistence.kvPersisted ? "yes" : "not available"}</strong></p>
    <p class="muted">Quote read access: <strong>${capabilities?.quoteRead ? "yes" : "no"}</strong></p>
    <p class="muted">Custom-field definition read access: <strong>${capabilities?.customFieldRead ? "yes" : "no"}</strong></p>
    <p class="muted">Quote write access: <strong>${capabilities?.quoteWrite ? "yes (verified by a no-change quote update)" : "no"}</strong></p>
    <p class="muted">No refresh token is displayed or copied into a second runtime authority.</p>

    <h2>Repeat for the other markets</h2>
    <ul>
      ${repeatLinks}
    </ul>`,
  );
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const oauthError = clean(url.searchParams.get("error"), 200);
  if (oauthError) {
    return htmlResponse(
      "Jobber authorization was not completed",
      `<h1>Jobber authorization was not completed.</h1><p><code>${escapeHtml(oauthError)}</code></p><p>${escapeHtml(url.searchParams.get("error_description") || "Start the connection again when ready.")}</p>`,
      400,
    );
  }

  const code = clean(url.searchParams.get("code"), 2000);
  const state = clean(url.searchParams.get("state"), 2000);
  if (!code || !state) {
    return htmlResponse(
      "Missing Jobber authorization details",
      "<h1>Missing Jobber authorization details.</h1><p>The callback must include both <code>code</code> and <code>state</code>.</p>",
      400,
    );
  }

  try {
    const route = await verifyState(env, state);
    const lock = await acquireJobberProcessLock(env, route);
    let tokenData;
    let accountResult;
    let capabilities;
    let persistence;
    try {
      tokenData = await exchangeAuthorizationCode(env, route, code, getRedirectUri(env, request));
      accountResult = await queryJobberAccount(env, tokenData.access_token);
      requireExpectedJobberAccount(route, accountResult);
      capabilities = await queryJobberQuoteCapabilities(env, tokenData.access_token);
      if (!capabilities.ok) {
        throw new OAuthSetupError(
          `Expanded quote access is not available for ${route.accountLabel}. Reauthorize with quote read/write and custom-field configuration scopes.`,
          403,
        );
      }
      persistence = await persistAuthorizedJobberTokens(
        env,
        route,
        tokenData,
        accountResult,
      );
    } finally {
      await releaseJobberProcessLock(env, lock);
    }

    return renderSuccess(route, accountResult, persistence, capabilities);
  } catch (error) {
    if (error instanceof OAuthSetupError) {
      return htmlResponse(
        "Jobber OAuth setup failed",
        `<h1>Jobber OAuth setup failed.</h1><p>${escapeHtml(error.message)}</p>`,
        error.status,
      );
    }

    return htmlResponse(
      "Jobber OAuth setup failed",
      "<h1>Jobber OAuth setup failed.</h1><p>An unexpected error occurred while exchanging the authorization code.</p>",
      500,
    );
  }
}

export const _private = {
  getMarketRoute,
  getAuthAccountKey,
  verifyState,
  exchangeAuthorizationCode,
  queryJobberAccount,
  queryJobberQuoteCapabilities,
  verifyJobberQuoteWriteAccess,
  requireExpectedJobberAccount,
  acquireJobberProcessLock,
  releaseJobberProcessLock,
  persistAuthorizedJobberTokens,
};
