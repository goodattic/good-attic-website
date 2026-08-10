import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";

const SUPPORTED_TOPICS = new Set(["ASSESSMENT_CREATE", "ASSESSMENT_UPDATE"]);
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const RESOLVE_DELAY_SECONDS = 2;

const MARKET_BY_ACCOUNT_ID = new Map(
  ["ut", "mo_stl", "mo_kc"].map((marketKey) => {
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
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqualBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyJobberWebhookSignature(rawBody, header, secret) {
  const signature = decodeBase64(clean(header, 200));
  const signingSecret = clean(secret, 1000);
  if (!signature || !signingSecret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  ));
  return constantTimeEqualBytes(expected, signature);
}

export function parseJobberAppointmentWebhook(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }

  const event = payload?.data?.webHookEvent;
  const topic = clean(event?.topic, 80).toUpperCase();
  const accountId = clean(event?.accountId, 500);
  const itemId = clean(event?.itemId, 500);
  const occurredAt = clean(event?.occurredAt || event?.occuredAt, 80);

  if (!SUPPORTED_TOPICS.has(topic)) {
    return { ok: false, status: 202, code: "unsupported_topic" };
  }
  if (!accountId || !itemId) {
    return { ok: false, status: 400, code: "incomplete_event" };
  }

  const route = MARKET_BY_ACCOUNT_ID.get(accountId);
  if (!route) {
    return { ok: false, status: 202, code: "unknown_account" };
  }

  return {
    ok: true,
    event: {
      schema_version: 1,
      source: "jobber",
      topic,
      account_id: accountId,
      assessment_id: itemId,
      occurred_at: occurredAt || new Date().toISOString(),
      market_key: route.marketKey,
      market_name: route.accountLabel,
      auth_account_key: route.authAccountKey,
    },
  };
}

export async function handleJobberAppointmentWebhook({ request, env }) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return jsonResponse({ ok: false, code: "payload_too_large" }, 413);
  }

  let untrustedAccountId = "";
  try {
    untrustedAccountId = clean(
      JSON.parse(rawBody)?.data?.webHookEvent?.accountId,
      500,
    );
  } catch {
    // Signature validation still runs before returning an invalid-body response.
  }
  const untrustedRoute = MARKET_BY_ACCOUNT_ID.get(untrustedAccountId);
  const candidateSecrets = [...new Set([
    untrustedRoute ? clean(env[untrustedRoute.clientSecretEnvKey], 1000) : "",
    clean(env.JOBBER_CLIENT_SECRET, 1000),
  ].filter(Boolean))];
  const signatureResults = await Promise.all(candidateSecrets.map((secret) => (
    verifyJobberWebhookSignature(
      rawBody,
      request.headers.get("X-Jobber-Hmac-SHA256"),
      secret,
    )
  )));
  const signatureValid = signatureResults.some(Boolean);
  if (!signatureValid) {
    return jsonResponse({ ok: false, code: "invalid_signature" }, 401);
  }

  const parsed = parseJobberAppointmentWebhook(rawBody);
  if (!parsed.ok) {
    if (parsed.code === "unknown_account") {
      console.warn("Ignored a signed Jobber Assessment webhook from an unapproved account.");
    }
    return jsonResponse(
      { ok: parsed.status === 202, accepted: false, code: parsed.code },
      parsed.status,
    );
  }

  const queue = env.JOBBER_APPOINTMENT_QUEUE;
  if (!queue || typeof queue.send !== "function") {
    return jsonResponse(
      { ok: false, code: "appointment_queue_unavailable" },
      503,
      { "Retry-After": "30" },
    );
  }

  try {
    await queue.send(
      {
        ...parsed.event,
        received_at: new Date().toISOString(),
      },
      { delaySeconds: RESOLVE_DELAY_SECONDS },
    );
  } catch {
    return jsonResponse(
      { ok: false, code: "appointment_enqueue_failed" },
      503,
      { "Retry-After": "30" },
    );
  }

  return jsonResponse({ ok: true, accepted: true }, 202);
}

export const _private = {
  MARKET_BY_ACCOUNT_ID,
  MAX_WEBHOOK_BODY_BYTES,
  RESOLVE_DELAY_SECONDS,
  SUPPORTED_TOPICS,
  constantTimeEqualBytes,
  decodeBase64,
};
