import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, test } from "node:test";

import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { onRequestPost, _private } from "../functions/api/internal/fieldflow-attribution-backfill.js";

const SUBMISSION_ID = "12345678-1234-4234-8234-123456789abc";
const OTHER_ID = "87654321-4321-4321-8321-cba987654321";
const REQUEST_ID = "Z2lkOi8vSm9iYmVyL1JlcXVlc3QvMTIz";
const CLIENT_ID = "Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM=";
const INQUIRY_AT = "2026-09-25T18:20:00.000Z";
const BACKFILL_TOKEN = "backfill-token-with-at-least-32-random-characters";
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

function digest(value) {
  return createHash("sha256").update(value.toLowerCase()).digest("hex");
}

function fixture({
  market = "ut",
  submissionId = SUBMISSION_ID,
  source = "Organic Online",
  sourceDetail = "organic_online",
  gclid = null,
  proof = true,
  transaction = null,
  approved = [SUBMISSION_ID],
  excluded = [],
  sendEnabled = false,
} = {}) {
  const account = getJobberOAuthRoute(market, "website").expectedAccountId;
  const body = {
    mode: "dry_run",
    submission_id: submissionId,
    market_key: market,
    jobber_account_id: account,
    jobber_request_id: REQUEST_ID,
  };
  const calls = [];
  const database = {
    prepare(sql) {
      calls.push({ kind: "prepare", sql });
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error("unexpected database write");
      return {
        bind(...args) {
          calls.push({ kind: "bind", args });
          return {
            async first() {
              if (sql.includes("FROM acknowledgement_sources")) {
                if (!proof) return null;
                assert.deepEqual(args, [
                  account, REQUEST_ID, market, `website:${submissionId.toLowerCase()}`,
                  "2026-09-23T00:00:00Z",
                ]);
                return { client_id: CLIENT_ID, source_created_at: INQUIRY_AT };
              }
              if (sql.includes("FROM website_form_conversions")) {
                assert.deepEqual(args, [submissionId]);
                return transaction;
              }
              if (sql.includes("FROM closed_loop_leads")) {
                assert.deepEqual(args, [
                  submissionId, market, account, REQUEST_ID, CLIENT_ID,
                  INQUIRY_AT, "2026-09-23T00:00:00Z",
                ]);
                return {
                  inquiry_at: INQUIRY_AT,
                  original_source: source,
                  source_detail: sourceDetail,
                  gclid,
                  gbraid: null,
                  wbraid: null,
                };
              }
              throw new Error("unexpected query");
            },
          };
        },
      };
    },
  };
  const env = {
    ANGI_ROUTER_DB: database,
    FIELDFLOW_BACKFILL_TOKEN: BACKFILL_TOKEN,
    FIELDFLOW_BACKFILL_APPROVED_SHA256: approved.map(digest).join(","),
    FIELDFLOW_BACKFILL_EXCLUDED_SHA256: excluded.map(digest).join(","),
    FIELDFLOW_BACKFILL_SEND_ENABLED: sendEnabled ? "true" : "false",
    EXTERNAL_API_WRITES_ENABLED: "true",
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/api/integrations/highlevel/lead-attribution",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-receiver-token",
    FIELDFLOW_ATTRIBUTION_TOKEN_STL: "stl-receiver-token",
    FIELDFLOW_ATTRIBUTION_TOKEN_KC: "kc-receiver-token",
  };
  async function invoke({ mode = "dry_run", token = BACKFILL_TOKEN, bodyChanges = {} } = {}) {
    const request = new Request("https://goodattic.example.test/api/internal/fieldflow-attribution-backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, mode, ...bodyChanges }),
    });
    const result = await onRequestPost({ request, env });
    return { result, json: await result.json() };
  }
  return { env, body, calls, invoke };
}

test("dry run validates a proved website row without D1 or HTTP writes", async () => {
  const context = fixture({ source: "Google Ads", sourceDetail: "google_ads", gclid: "CLICK_PRIVATE" });
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("unexpected fetch"); };
  const { result, json } = await context.invoke();
  assert.equal(result.status, 200);
  assert.deepEqual(json, {
    ok: true, code: "ready", market: "ut", source_kind: "Google Ads", click_id_present: true,
  });
  assert.equal(fetched, false);
  assert.equal(context.calls.some((call) => call.kind === "run"), false);
  assert.doesNotMatch(JSON.stringify(json), /CLICK_PRIVATE|12345678|Z2lk/);
});

test("send calls only Fieldflow once and leaves the website ledger untouched", async () => {
  const context = fixture({ source: "Google Ads", sourceDetail: "google_ads", gclid: "CLICK_PRIVATE", sendEnabled: true, excluded: [OTHER_ID] });
  const fetched = [];
  globalThis.fetch = async (url, options) => {
    fetched.push({ url, options });
    return new Response(null, { status: 202 });
  };
  const { result, json } = await context.invoke({ mode: "send" });
  assert.equal(result.status, 200);
  assert.equal(json.code, "created");
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, "https://fieldflow.example.test/api/integrations/highlevel/lead-attribution/slc");
  assert.equal(fetched[0].options.headers.Authorization, "Bearer slc-receiver-token");
  assert.deepEqual(JSON.parse(fetched[0].options.body), {
    schema_version: "2026-07-31",
    jobber_account_id: context.body.jobber_account_id,
    jobber_request_id: REQUEST_ID,
    submission_id: SUBMISSION_ID,
    occurred_at: INQUIRY_AT,
    lead_source: "Google Ads",
    source_key: "google",
    source_detail: "google_ads",
    source_reason: "verified_website_ledger_backfill",
    gclid: "CLICK_PRIVATE",
  });
  assert.equal(context.calls.some((call) => call.kind !== "prepare" && call.kind !== "bind"), false);
  assert.doesNotMatch(JSON.stringify(json), /CLICK_PRIVATE|12345678|Z2lk/);
});

test("St. Louis sends to its own receiver and an existing row is reported as updated", async () => {
  const context = fixture({ market: "mo_stl", sendEnabled: true, excluded: [OTHER_ID] });
  const fetched = [];
  globalThis.fetch = async (url, options) => {
    fetched.push({ url, options });
    return new Response(null, { status: 200 });
  };
  const { json } = await context.invoke({ mode: "send" });
  assert.equal(json.code, "updated");
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, "https://fieldflow.example.test/api/integrations/highlevel/lead-attribution/stl");
  assert.equal(fetched[0].options.headers.Authorization, "Bearer stl-receiver-token");
});

test("send remains disabled until explicitly enabled after release", async () => {
  const context = fixture({ excluded: [OTHER_ID] });
  globalThis.fetch = async () => { throw new Error("unexpected fetch"); };
  const { result, json } = await context.invoke({ mode: "send" });
  assert.equal(result.status, 503);
  assert.equal(json.code, "send_disabled");
});

test("requires exact bearer auth, an approved hash and a strict request shape", async () => {
  const context = fixture();
  assert.equal((await context.invoke({ token: "wrong" })).json.code, "unauthorized");
  assert.equal((await fixture({ approved: [OTHER_ID] }).invoke()).json.code, "not_approved");
  assert.equal((await fixture({ excluded: [SUBMISSION_ID] }).invoke()).json.code, "excluded");
  assert.equal((await context.invoke({ bodyChanges: { gclid: "INJECTED" } })).json.code, "invalid_request");
  assert.equal(context.calls.length, 0);
});

test("send requires an explicit TEST exclusion list", async () => {
  const context = fixture({ sendEnabled: true });
  globalThis.fetch = async () => { throw new Error("unexpected fetch"); };
  const { json } = await context.invoke({ mode: "send" });
  assert.equal(json.code, "test_exclusions_unavailable");
});

test("holds rows without proof or with conflicted transaction metadata", async () => {
  assert.equal((await fixture({ proof: false }).invoke()).json.code, "website_proof_missing");
  const conflicting = {
    state: "delivery_uncertain", market_key: "ut",
    jobber_account_id: getJobberOAuthRoute("ut", "website").expectedAccountId,
    jobber_request_id: REQUEST_ID, jobber_client_id: CLIENT_ID,
    reconciliation_required: 1,
  };
  assert.equal((await fixture({ transaction: conflicting }).invoke()).json.code, "transaction_conflict");
});

test("maps AI referral for Fieldflow while retaining the original ledger detail", async () => {
  const context = fixture({ sourceDetail: "ai_referral" });
  const { json } = await context.invoke();
  assert.equal(json.code, "ready");
  assert.equal(context.calls.some((call) => call.kind === "run"), false);
  const record = _private.buildReceiverRecord(context.body, {
    inquiry_at: INQUIRY_AT, original_source: "Organic Online", source_detail: "ai_referral",
    gclid: null, gbraid: null, wbraid: null,
  });
  assert.equal(record.source_detail, "organic_online");
});

test("holds Kansas City and unrecognized source combinations", async () => {
  assert.equal((await fixture({ market: "mo_kc" }).invoke()).json.code, "classification_unavailable");
  assert.equal((await fixture({ sourceDetail: "other_unverified" }).invoke()).json.code, "receiver_shape_unsupported");
});

test("receiver failure is reported without returning its body or raw identifiers", async () => {
  const context = fixture({ sendEnabled: true, excluded: [OTHER_ID] });
  globalThis.fetch = async () => new Response("private customer CLICK_PRIVATE", { status: 400 });
  const { result, json } = await context.invoke({ mode: "send" });
  assert.equal(result.status, 502);
  assert.deepEqual(json, { ok: false, code: "receiver_delivery_failed", receiver_status: 400, attempts: 1 });
  assert.doesNotMatch(JSON.stringify(json), /private customer|CLICK_PRIVATE|12345678|Z2lk/);
});

test("constructed replay record passes the actual Fieldflow parser when available", {
  skip: !existsSync(new URL("../../../../../2026-07-23/i-want-to-create-a-dashboard/lib/highlevel/payload.ts", import.meta.url)),
}, async () => {
  const url = new URL("../../../../../2026-07-23/i-want-to-create-a-dashboard/lib/highlevel/payload.ts", import.meta.url);
  const { parseHighLevelAttributionPayload } = await import(url.href);
  const context = fixture({ source: "Google Ads", sourceDetail: "google_ads", gclid: "CLICK_PRIVATE" });
  const record = _private.buildReceiverRecord(context.body, {
    inquiry_at: INQUIRY_AT, original_source: "Google Ads", source_detail: "google_ads",
    gclid: "CLICK_PRIVATE", gbraid: null, wbraid: null,
  });
  const parsed = parseHighLevelAttributionPayload(record, {
    routedJobberAccountId: context.body.jobber_account_id,
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sourceKey, "google");
});
