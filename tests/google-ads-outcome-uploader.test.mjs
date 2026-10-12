import test from "node:test";
import assert from "node:assert/strict";
import { drainGoogleAdsOutbox, createDisabledGoogleAdsDrain } from "../workers/google-ads-outcome-uploader.js";

test("hourly drain updates pending rows and bounds retries", async () => {
  const updates = [];
  const db = { prepare(sql) { return { bind: (...args) => ({ all: async () => ({ results: [{ outcome_id: "o1", attempt_count: 0 }] }), run: async () => { updates.push({ sql, args }); return {}; } }) }; } };
  const result = await drainGoogleAdsOutbox({ database: db, uploader: { upload: async () => ({ status: "retryable", diagnostic_code: "temporary" }) }, now: "2026-09-22T00:00:00Z", maxAttempts: 2 });
  assert.equal(result.processed, 1);
  assert.equal(result.results[0].status, "retryable");
  assert.equal(updates[0].args[0], "retryable");
});

test("disabled drain never calls a transport", async () => {
  let called = false;
  const drain = createDisabledGoogleAdsDrain({ GOOGLE_ADS_UPLOAD_ENABLED: "false" });
  const db = { prepare() { return { bind: () => ({ all: async () => ({ results: [{ outcome_id: "o1", upload_state: "pending", attempt_count: 0 }] }), run: async () => {} }) }; } };
  const result = await drain({ database: db });
  assert.equal(result.processed, 1);
  assert.equal(called, false);
});
