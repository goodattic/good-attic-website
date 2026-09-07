import assert from "node:assert/strict";
import { test } from "node:test";
import { handleJobberContactFanout, _private } from "../server/jobber-contact-fanout.js";
import { onRequestPost } from "../functions/api/jobber/webhooks/appointment-scheduled.js";

const ACCOUNT = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==";
const SECRET = "test-website-app-secret";
function payload(overrides = {}) {
  return JSON.stringify({ data: { webHookEvent: {
    topic: "REQUEST_CREATE", appId: "website-app", accountId: ACCOUNT,
    itemId: btoa("gid://Jobber/Request/123"), occurredAt: "2026-09-07T23:00:00Z", ...overrides,
  } } });
}
async function signature(raw, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))));
}
async function context({ raw = payload(), env = {}, signedBy = SECRET, headers = {} } = {}) {
  return {
    request: new Request("https://goodattic.energy/api/jobber/webhooks/appointment-scheduled", {
      method: "POST", body: raw,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Jobber-Hmac-SHA256": await signature(raw, signedBy), ...headers },
    }),
    env: { CONTACT_SYNC_REQUEST_FANOUT_ENABLED: "true", JOBBER_CLIENT_SECRET: SECRET, ...env },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("disabled fan-out calls the original handler with the untouched context", async () => {
  for (const flag of [undefined, "false", false, true, "TRUE", ""]) {
    const ctx = await context({ env: { CONTACT_SYNC_REQUEST_FANOUT_ENABLED: flag } });
    const expected = new Response("original-response", { status: 202 });
    let called = 0;
    const response = await handleJobberContactFanout(ctx, { appointmentHandler(input) {
      called += 1;
      assert.equal(input, ctx);
      assert.equal(input.request.bodyUsed, false);
      return expected;
    } });
    assert.equal(response, expected);
    assert.equal(called, 1);
  }
});

test("enabled Pages route preserves exact body bytes and forwards only the two allowed headers", async () => {
  const raw = `  ${payload().slice(0, -1)}, "extra": "café ☃" }\n`;
  let originalEvents = 0;
  let forwarded;
  const ctx = await context({ raw, headers: { Authorization: "Bearer never-forward", Cookie: "secret-cookie", "X-Internal-Secret": "private" }, env: {
    JOBBER_APPOINTMENT_QUEUE: { async send(event, options) { originalEvents += 1; assert.equal(event.topic, "REQUEST_CREATE"); assert.equal(options.delaySeconds, 2); } },
    CONTACT_SYNC_SERVICE: { async fetch(request) { forwarded = request; return new Response(null, { status: 202 }); } },
  } });
  const expectedSignature = ctx.request.headers.get("X-Jobber-Hmac-SHA256");
  const response = await onRequestPost(ctx);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, accepted: true });
  assert.equal(originalEvents, 1);
  assert.equal(forwarded.url, _private.CONTACT_URL);
  assert.equal(forwarded.method, "POST");
  assert.deepEqual([...forwarded.headers.keys()].sort(), ["content-type", "x-jobber-hmac-sha256"]);
  assert.equal(forwarded.headers.get("X-Jobber-Hmac-SHA256"), expectedSignature);
  assert.equal(forwarded.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), new TextEncoder().encode(raw));
});

test("appointment enqueue and contact capture start independently before either completes", { timeout: 2000 }, async () => {
  const queueStarted = deferred(); const serviceStarted = deferred();
  const releaseQueue = deferred(); const releaseService = deferred();
  const ctx = await context({ env: {
    JOBBER_APPOINTMENT_QUEUE: { async send() { queueStarted.resolve(); await releaseQueue.promise; } },
    CONTACT_SYNC_SERVICE: { async fetch() { serviceStarted.resolve(); await releaseService.promise; return new Response(null, { status: 202 }); } },
  } });
  const result = handleJobberContactFanout(ctx);
  await Promise.all([queueStarted.promise, serviceStarted.promise]);
  releaseQueue.resolve(); releaseService.resolve();
  assert.equal((await result).status, 202);
});

for (const failure of ["missing", "throw", 400, 401, 429, 500, 503]) {
  test(`contact ${failure} still enqueues the appointment and requests provider retry`, async () => {
    let enqueued = 0;
    const service = failure === "missing" ? undefined : { async fetch() {
      if (failure === "throw") throw Error("secret must not escape");
      return new Response(null, { status: failure });
    } };
    const ctx = await context({ env: {
      JOBBER_APPOINTMENT_QUEUE: { async send() { enqueued += 1; } }, CONTACT_SYNC_SERVICE: service,
    } });
    const response = await handleJobberContactFanout(ctx);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.deepEqual(await response.json(), { ok: false, code: "contact_sync_fanout_incomplete" });
    assert.equal(enqueued, 1);
  });
}

for (const failure of ["missing", "throw"]) {
  test(`appointment queue ${failure} still captures the contact and requests retry`, async () => {
    let captured = 0;
    const ctx = await context({ env: {
      JOBBER_APPOINTMENT_QUEUE: failure === "missing" ? undefined : { async send() { throw Error("queue unavailable"); } },
      CONTACT_SYNC_SERVICE: { async fetch() { captured += 1; return new Response(null, { status: 202 }); } },
    } });
    const response = await handleJobberContactFanout(ctx);
    assert.equal(response.status, 503);
    assert.equal(captured, 1);
  });
}

test("provider retry forwards identical source bytes and the same request identity", async () => {
  const enqueued = []; const capturedBodies = [];
  const env = {
    JOBBER_APPOINTMENT_QUEUE: { async send(event) { enqueued.push(event); } },
    CONTACT_SYNC_SERVICE: { async fetch(request) { capturedBodies.push(await request.text()); return new Response(null, { status: capturedBodies.length === 1 ? 503 : 202 }); } },
  };
  assert.equal((await handleJobberContactFanout(await context({ env }))).status, 503);
  assert.equal((await handleJobberContactFanout(await context({ env }))).status, 202);
  assert.equal(enqueued.length, 2);
  assert.equal(enqueued[0].request_id, enqueued[1].request_id);
  assert.equal(enqueued[0].account_id, enqueued[1].account_id);
  assert.equal(capturedBodies[0], capturedBodies[1]);
});

test("invalid signatures, malformed payloads and ignored events keep original responses without forwarding", async () => {
  let forwarded = 0; let enqueued = 0;
  const env = {
    JOBBER_APPOINTMENT_QUEUE: { async send() { enqueued += 1; } },
    CONTACT_SYNC_SERVICE: { async fetch() { forwarded += 1; throw Error("must not forward"); } },
  };
  for (const [input, status, code] of [
    [{ signedBy: "wrong-secret" }, 401, "invalid_signature"],
    [{ raw: "{invalid" }, 400, "invalid_json"],
    [{ raw: payload({ topic: "CLIENT_CREATE" }) }, 202, "unsupported_topic"],
    [{ raw: payload({ accountId: btoa("gid://Jobber/Account/999") }) }, 202, "unknown_account"],
    [{ raw: payload({ itemId: "" }) }, 400, "incomplete_event"],
  ]) {
    const response = await handleJobberContactFanout(await context({ ...input, env }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
  assert.equal(forwarded, 0);
  assert.equal(enqueued, 0);
});

test("market-specific and shared-fallback signing secrets retain original acceptance", async () => {
  let forwarded = 0;
  for (const signedBy of [SECRET, "utah-app-secret"]) {
    const response = await handleJobberContactFanout(await context({ signedBy, env: {
      JOBBER_CLIENT_SECRET_SLC: "utah-app-secret",
      JOBBER_APPOINTMENT_QUEUE: { async send() {} },
      CONTACT_SYNC_SERVICE: { async fetch() { forwarded += 1; return new Response(null, { status: 202 }); } },
    } }));
    assert.equal(response.status, 202);
  }
  assert.equal(forwarded, 2);
});

test("the 700 ms service deadline aborts and returns retry even if binding ignores cancellation", async () => {
  const timerReady = deferred(); const fetchReady = deferred();
  let timeoutCallback; let forwardedRequest; let cleared = false; let enqueued = 0;
  const ctx = await context({ env: {
    JOBBER_APPOINTMENT_QUEUE: { async send() { enqueued += 1; } },
    CONTACT_SYNC_SERVICE: { fetch(request) { forwardedRequest = request; fetchReady.resolve(); return new Promise(() => {}); } },
  } });
  const responsePromise = handleJobberContactFanout(ctx, {
    setTimeout(callback, delay) { assert.equal(delay, 700); timeoutCallback = callback; timerReady.resolve(); return "fake-timer"; },
    clearTimeout(id) { assert.equal(id, "fake-timer"); cleared = true; },
  });
  await Promise.all([timerReady.promise, fetchReady.promise]);
  assert.equal(forwardedRequest.signal.aborted, false);
  timeoutCallback();
  assert.equal((await responsePromise).status, 503);
  assert.equal(forwardedRequest.signal.aborted, true);
  assert.equal(enqueued, 1);
  assert.equal(cleared, true);
});

test("oversized UTF-8 input is bounded before either downstream sees it", async () => {
  let called = 0;
  const ctx = await context({ raw: "é".repeat(32769), env: {
    CONTACT_SYNC_SERVICE: { async fetch() { called += 1; } },
  } });
  const response = await handleJobberContactFanout(ctx, { appointmentHandler() { called += 1; } });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, code: "payload_too_large" });
  assert.equal(called, 0);
});

test("an unexpected original-handler failure cannot cancel the contact branch", async () => {
  let captured = 0;
  const ctx = await context({ env: { CONTACT_SYNC_SERVICE: { async fetch() { captured += 1; return new Response(null, { status: 202 }); } } } });
  const response = await handleJobberContactFanout(ctx, { appointmentHandler() { throw Error("unexpected original failure"); } });
  assert.equal(response.status, 503);
  assert.equal(captured, 1);
});

test("an original ignored202 remains ignored even when contact capture fails", async () => {
  const ignored = Response.json({ ok: true, accepted: false, code: "ignored_by_original" }, { status: 202 });
  const ctx = await context({ env: { CONTACT_SYNC_SERVICE: { async fetch() { return new Response(null, { status: 503 }); } } } });
  const response = await handleJobberContactFanout(ctx, { appointmentHandler() { return ignored; } });
  assert.equal(response, ignored);
  assert.deepEqual(await response.json(), { ok: true, accepted: false, code: "ignored_by_original" });
});
