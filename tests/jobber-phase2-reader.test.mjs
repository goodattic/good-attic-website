import test from "node:test";
import assert from "node:assert/strict";
import { createJobberPhase2Reader } from "../server/jobber-phase2-reader.js";

test("reads a Jobber Request through the market token provider and normalizes connections", async () => {
  const calls = [];
  const reader = createJobberPhase2Reader({ tokenForMarket: async market => { assert.equal(market, "ut"); return "token"; }, fetchImpl: async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ data: { request: { id: "r1", client: { id: "c1" }, assessment: { id: "a1", createdAt: "2026-09-22T00:00:00Z" }, quotes: { nodes: [{ id: "q1" }] }, jobs: { nodes: [{ id: "j1" }] } } } }) }; } });
  const result = await reader.readObject({ market_key: "ut", objectType: "request", id: "r1" });
  assert.equal(result.jobber_request_id, "r1");
  assert.equal(result.quotes[0].id, "q1");
  assert.equal(calls[0].variables.id, "r1");
});

test("paginates read-only backfill IDs and filters by updated time", async () => {
  let page = 0;
  const reader = createJobberPhase2Reader({ tokenForMarket: async () => "token", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { requests: page++ === 0 ? { nodes: [{ id: "old", updatedAt: "2026-08-01T00:00:00Z" }, { id: "new", updatedAt: "2026-09-22T00:00:00Z" }], pageInfo: { hasNextPage: true, endCursor: "cursor" } } : { nodes: [{ id: "new2", updatedAt: "2026-09-23T00:00:00Z" }], pageInfo: { hasNextPage: false } } } }) }) });
  assert.deepEqual(await reader.listObjects({ market_key: "mo_stl", objectType: "request", since: "2026-09-01T00:00:00Z" }), ["new", "new2"]);
});

test("fences unauthorized reads without mutating Jobber", async () => {
  const reader = createJobberPhase2Reader({ tokenForMarket: async () => "token", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(() => reader.readObject({ market_key: "ut", objectType: "request", id: "r1" }), error => error.code === "jobber_unauthorized");
});
