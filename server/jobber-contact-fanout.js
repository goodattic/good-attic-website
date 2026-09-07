import {
  handleJobberAppointmentWebhook,
  parseJobberAppointmentWebhook,
  verifyJobberWebhookSignature,
  _private as appointmentPrivate,
} from "./jobber-appointment-webhook.js";

const MAX_BODY_BYTES = 64 * 1024;
const CONTACT_DEADLINE_MS = 700;
const CONTACT_URL = "https://contact-sync/webhooks/jobber";

function unavailable() {
  return Response.json({ ok: false, code: "contact_sync_fanout_incomplete" }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": "30" },
  });
}

async function readBoundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function cleanSecret(value) {
  return ["string", "number", "bigint"].includes(typeof value)
    ? String(value).trim().slice(0, 1000) : "";
}

async function shouldForward(rawText, request, env) {
  const parsed = parseJobberAppointmentWebhook(rawText);
  if (!parsed.ok) return false;
  const route = appointmentPrivate.MARKET_BY_ACCOUNT_ID.get(parsed.event.account_id);
  const candidates = [...new Set([
    route ? cleanSecret(env[route.clientSecretEnvKey]) : "",
    cleanSecret(env.JOBBER_CLIENT_SECRET),
  ].filter(Boolean))];
  const valid = await Promise.all(candidates.map((secret) => verifyJobberWebhookSignature(
    rawText, request.headers.get("X-Jobber-Hmac-SHA256"), secret,
  )));
  return valid.some(Boolean);
}

async function forwardContact({ request, env }, body, timers) {
  const service = env.CONTACT_SYNC_SERVICE;
  if (!service || typeof service.fetch !== "function") return false;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = timers.setTimeout(() => {
      controller.abort();
      resolve(false);
    }, CONTACT_DEADLINE_MS);
  });
  const headers = new Headers();
  for (const name of ["Content-Type", "X-Jobber-Hmac-SHA256"]) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  try {
    const delivery = Promise.resolve().then(async () => {
      const response = await service.fetch(new Request(CONTACT_URL, {
        method: "POST", headers, body, signal: controller.signal,
      }));
      return response?.status === 202;
    }).catch(() => false);
    return await Promise.race([delivery, timeout]);
  } finally {
    timers.clearTimeout(timer);
  }
}

export async function handleJobberContactFanout(context, dependencies = {}) {
  const original = dependencies.appointmentHandler || handleJobberAppointmentWebhook;
  if (context.env.CONTACT_SYNC_REQUEST_FANOUT_ENABLED !== "true") return original(context);

  let body;
  try {
    body = await readBoundedBody(context.request);
  } catch {
    return unavailable();
  }
  if (!body) return Response.json({ ok: false, code: "payload_too_large" }, {
    status: 413, headers: { "Cache-Control": "no-store" },
  });
  const originalContext = {
    ...context,
    request: new Request(context.request, { body }),
  };
  // Reuse the current receiver's account/topic/signature rules. Unsupported,
  // unknown and unauthenticated payloads keep that receiver's exact response.
  if (!await shouldForward(new TextDecoder().decode(body), originalContext.request, context.env)) {
    return original(originalContext);
  }

  const timers = {
    setTimeout: dependencies.setTimeout || ((...args) => globalThis.setTimeout(...args)),
    clearTimeout: dependencies.clearTimeout || ((...args) => globalThis.clearTimeout(...args)),
  };
  // Neither branch depends on the other's success. A partial success triggers
  // Jobber's normal retry; both consumers retain their existing deduplication.
  const appointment = Promise.resolve().then(() => original(originalContext)).catch(() => unavailable());
  const contact = forwardContact(originalContext, body, timers).catch(() => false);
  const [appointmentResponse, contactAccepted] = await Promise.all([appointment, contact]);
  if (appointmentResponse.status >= 400 && appointmentResponse.status < 500) return appointmentResponse;
  if (appointmentResponse.status === 202) {
    const originalResult = await appointmentResponse.clone().json().catch(() => null);
    if (originalResult?.accepted === false) return appointmentResponse;
  }
  if (appointmentResponse.status !== 202 || !contactAccepted) return unavailable();
  return appointmentResponse;
}

export const _private = { MAX_BODY_BYTES, CONTACT_DEADLINE_MS, CONTACT_URL };
