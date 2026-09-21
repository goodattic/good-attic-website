import { getJobberOAuthRoute } from "./config.js";
import { onRequestGet as handleOAuthCallback } from "./callback.js";

const JOBBER_AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .slice(0, 5000)
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
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f4f8f3; color: #173323; }
    main { max-width: 700px; margin: 0 auto; padding: 48px 20px; }
    section { background: #fff; border: 1px solid rgba(23,51,35,.14); border-radius: 8px; padding: 28px; box-shadow: 0 18px 50px rgba(23,51,35,.12); }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { line-height: 1.6; }
    .actions { display: grid; gap: 12px; margin-top: 24px; }
    a { background: #0f5a43; border-radius: 6px; color: #fff; display: block; font-weight: 700; padding: 14px 16px; text-align: center; text-decoration: none; }
  </style>
</head>
<body><main><section>${body}</section></main></body>
</html>`, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
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

async function createState(env, route) {
  const secret = clean(env.JOBBER_OAUTH_SETUP_KEY, 500);
  if (!secret) throw new Error("Jobber authorization setup is unavailable.");
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const body = base64UrlEncodeText(JSON.stringify({
    market: route.marketKey,
    source: route.sourceKey,
    ts: Date.now(),
    nonce: base64UrlEncodeBytes(nonce),
    max_age_ms: STATE_MAX_AGE_MS,
  }));
  return `${body}.${await signStateBody(secret, body)}`;
}

function redirectUri(env, request) {
  return clean(env.JOBBER_REAUTHORIZE_REDIRECT_URI, 500)
    || `${new URL(request.url).origin}/api/jobber/oauth/reauthorize`;
}

function clientId(env, route) {
  return clean(env[route.clientIdEnvKey], 500)
    || clean(env[route.fallbackClientIdEnvKey], 500);
}

function chooser(request) {
  const url = new URL(request.url);
  const base = `${url.origin}${url.pathname}`;
  return htmlResponse(
    "Choose the Jobber account",
    `<h1>Reconnect Good Attic Website Leads</h1>
    <p>Choose the Jobber account currently open. Jobber will ask you to approve the updated quote permissions.</p>
    <div class="actions">
      <a href="${escapeHtml(base)}?market=stl">Good Attic of Saint Louis</a>
      <a href="${escapeHtml(base)}?market=slc">Good Attic Utah</a>
    </div>`,
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = clean(url.searchParams.get("code"), 2000);
  const state = clean(url.searchParams.get("state"), 2000);
  const oauthError = clean(url.searchParams.get("error"), 200);

  if (code || state || oauthError) {
    return handleOAuthCallback({
      ...context,
      env: {
        ...env,
        JOBBER_OAUTH_REDIRECT_URI: redirectUri(env, request),
      },
    });
  }

  const market = clean(url.searchParams.get("market"), 40);
  if (!market) return chooser(request);

  const route = getJobberOAuthRoute(market, "website");
  if (!route || !["slc", "stl"].includes(route.marketKey)) {
    return htmlResponse("Unsupported Jobber account", "<h1>Choose Utah or St. Louis.</h1>", 400);
  }

  try {
    const configuredClientId = clientId(env, route);
    if (!configuredClientId) throw new Error("Jobber client configuration is unavailable.");
    const authorizationUrl = new URL(JOBBER_AUTHORIZE_URL);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", configuredClientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri(env, request));
    authorizationUrl.searchParams.set("state", await createState(env, route));
    return Response.redirect(authorizationUrl.toString(), 302);
  } catch (error) {
    return htmlResponse(
      "Jobber reauthorization could not start",
      `<h1>Jobber reauthorization could not start.</h1><p>${escapeHtml(error instanceof Error ? error.message : "Try again shortly.")}</p>`,
      503,
    );
  }
}

export const _private = { createState, redirectUri };
