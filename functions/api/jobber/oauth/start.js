import { getJobberOAuthRoute } from "./config.js";

const JOBBER_AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

function clean(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function escapeHtml(value) {
  return clean(String(value ?? ""), 5000)
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
      main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
      .panel { background: white; border: 1px solid rgba(23, 51, 35, .14); border-radius: 8px; box-shadow: 0 18px 50px rgba(23, 51, 35, .12); padding: 28px; }
      h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.15; }
      p { line-height: 1.6; }
      code { background: #eef4ec; border-radius: 4px; padding: 2px 5px; }
      ul { line-height: 1.7; }
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

function getProvidedSetupKey(request) {
  const url = new URL(request.url);
  const header = clean(request.headers.get("x-jobber-setup-key"), 500);
  const auth = clean(request.headers.get("authorization"), 700);
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return clean(url.searchParams.get("setup_key"), 500) || header || bearer;
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function requireSetupAccess(request, env) {
  const expected = clean(env.JOBBER_OAUTH_SETUP_KEY, 500);
  if (!expected) {
    return {
      ok: false,
      response: htmlResponse(
        "Jobber OAuth setup is not configured",
        "<h1>Jobber OAuth setup is not configured.</h1><p>Add <code>JOBBER_OAUTH_SETUP_KEY</code> before using this setup helper.</p>",
        503,
      ),
    };
  }

  if (!constantTimeEqual(getProvidedSetupKey(request), expected)) {
    return {
      ok: false,
      response: htmlResponse(
        "Jobber OAuth setup is locked",
        "<h1>Jobber OAuth setup is locked.</h1><p>Add the setup key as <code>?setup_key=...</code>, an <code>x-jobber-setup-key</code> header, or a bearer token.</p>",
        401,
      ),
    };
  }

  return { ok: true };
}

function getMarketRoute(value, source = "website") {
  return getJobberOAuthRoute(value, source);
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

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
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

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function createState(env, route) {
  const body = base64UrlEncodeText(JSON.stringify({
    market: route.marketKey,
    source: route.sourceKey,
    ts: Date.now(),
    nonce: randomNonce(),
    max_age_ms: STATE_MAX_AGE_MS,
  }));
  const signature = await signStateBody(clean(env.JOBBER_OAUTH_SETUP_KEY, 500), body);
  return `${body}.${signature}`;
}

export async function onRequestGet({ request, env }) {
  const access = requireSetupAccess(request, env);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const source = clean(url.searchParams.get("source"), 40) || "website";
  const route = getMarketRoute(url.searchParams.get("market"), source);
  if (!route) {
    return htmlResponse(
      "Choose a Jobber market",
      "<h1>Choose a supported Jobber market and source.</h1><p>Use <code>?market=slc</code>, <code>?market=stl</code>, or <code>?market=kc</code>. Add <code>&amp;source=google</code> for Google or use <code>&amp;source=angi</code> with Utah.</p>",
      400,
    );
  }

  const config = getClientConfig(env, route);
  if (!config.clientId || !config.clientSecret) {
    return htmlResponse(
      "Jobber OAuth credentials are missing",
      `<h1>Jobber OAuth credentials are missing.</h1><p>Add <code>${escapeHtml(route.clientIdEnvKey)}</code> and <code>${escapeHtml(route.clientSecretEnvKey)}</code> for the ${escapeHtml(route.sourceLabel)} source app.</p>`,
      503,
    );
  }

  const authorizationUrl = new URL(JOBBER_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", getRedirectUri(env, request));
  authorizationUrl.searchParams.set("state", await createState(env, route));

  return Response.redirect(authorizationUrl.toString(), 302);
}

export const _private = {
  createState,
  getMarketRoute,
  getRedirectUri,
};
