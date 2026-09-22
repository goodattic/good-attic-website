import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { _private as consumer } from "../workers/jobber-quote-consumer.js";

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

const EVENT = {
  schema_version: 1,
  source: "jobber",
  topic: "QUOTE_CREATE",
  event_name: "jobber.quote_attribution.v1",
  account_id: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==",
  quote_id: "quote-1",
  market_key: "ut",
};

function messageWithResult(result) {
  const calls = { ack: 0, retry: 0 };
  return {
    message: {
      body: EVENT,
      ack() { calls.ack += 1; },
      retry() { calls.retry += 1; },
    },
    calls,
    result,
  };
}

test("retries when a Quote has not appeared yet", async () => {
  globalThis.fetch = async () => Response.json({ ok: true, status: "quote_not_found" });
  const { message, calls } = messageWithResult();
  await consumer.processMessage(message, { JOBBER_QUOTE_BROKER_SECRET: "secret" });
  assert.equal(calls.ack, 0);
  assert.equal(calls.retry, 1);
});

test("retries when the originating Request is not visible yet", async () => {
  globalThis.fetch = async () => Response.json({ ok: true, status: "missing_request" });
  const { message, calls } = messageWithResult();
  await consumer.processMessage(message, { JOBBER_QUOTE_BROKER_SECRET: "secret" });
  assert.equal(calls.ack, 0);
  assert.equal(calls.retry, 1);
});

test("acknowledges only terminal resolver statuses", async () => {
  globalThis.fetch = async () => Response.json({ ok: true, status: "applied" });
  const { message, calls } = messageWithResult();
  await consumer.processMessage(message, { JOBBER_QUOTE_BROKER_SECRET: "secret" });
  assert.equal(calls.ack, 1);
  assert.equal(calls.retry, 0);
});

test("test mode acknowledges non-allowlisted Quotes without calling the resolver", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({ ok: true, status: "applied" }); };
  const { message, calls: messageCalls } = messageWithResult();
  await consumer.processMessage(message, {
    JOBBER_QUOTE_BROKER_SECRET: "secret",
    JOBBER_QUOTE_TEST_MODE: "true",
    JOBBER_QUOTE_TEST_ALLOWLIST_UT: "ut-test-quote",
  });
  assert.equal(messageCalls.ack, 1);
  assert.equal(messageCalls.retry, 0);
  assert.equal(calls, 0);
});

test("test mode allows only the configured Quote ID for its market", () => {
  assert.equal(consumer.quoteAllowedInCurrentMode({
    JOBBER_QUOTE_TEST_MODE: "true",
    JOBBER_QUOTE_TEST_ALLOWLIST_UT: "ut-test-quote",
    JOBBER_QUOTE_TEST_ALLOWLIST_STL: "stl-test-quote",
  }, { ...EVENT, quote_id: "ut-test-quote" }), true);
  assert.equal(consumer.quoteAllowedInCurrentMode({
    JOBBER_QUOTE_TEST_MODE: "true",
    JOBBER_QUOTE_TEST_ALLOWLIST_UT: "ut-test-quote",
    JOBBER_QUOTE_TEST_ALLOWLIST_STL: "stl-test-quote",
  }, { ...EVENT, quote_id: "stl-test-quote" }), false);
  assert.equal(consumer.quoteAllowedInCurrentMode({
    JOBBER_QUOTE_TEST_ALLOWLIST_UT: "ut-test-quote",
  }, EVENT), true);
});

test("scheduled authorization health uses the protected Pages endpoint", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, results: [] });
  };
  const result = await consumer.runAuthorizationHealth({
    JOBBER_AUTH_HEALTH_URL: "https://example.test/api/jobber/oauth/health-check",
    JOBBER_AUTH_HEALTH_SECRET: "health-secret",
  });
  assert.equal(result.ok, true);
  assert.equal(request.url, "https://example.test/api/jobber/oauth/health-check");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer health-secret");
});
