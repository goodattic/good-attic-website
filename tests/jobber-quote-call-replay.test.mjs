import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { _private as quoteAttribution, replayMatchedCallQuotes } from "../server/jobber-quote-attribution.js";

const originalFetch = globalThis.fetch;
const databases = [];
const ACCOUNT = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==";
const gid = (type, number) => btoa(`gid://Jobber/${type}/${number}`);

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(readFileSync(new URL("../migrations/0006_closed_loop_quote_attribution.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0007_atomic_quote_attribution_claims.sql", import.meta.url), "utf8"));
  sqlite.exec(`CREATE TABLE quo_call_attributions (
    account_id TEXT, market TEXT, quo_call_id TEXT, jobber_request_id TEXT,
    jobber_client_id TEXT, direction TEXT, call_started_at_utc TEXT, caller_phone TEXT
  ); CREATE TABLE google_call_match_shadow (
    google_resource TEXT, market_key TEXT, campaign_name TEXT,
    caller_area_code TEXT, call_started_at_utc TEXT, diagnostic_code TEXT,
    quo_call_id TEXT, match_state TEXT
  ); CREATE TABLE angi_router_jobber_auth (
    account_key TEXT, access_token TEXT, access_expires_at INTEGER, refresh_token TEXT,
    refresh_revision INTEGER, refresh_status TEXT, refresh_lease_token TEXT,
    refresh_lease_expires_at INTEGER, last_error_code TEXT
  )`);
  sqlite.exec(readFileSync(new URL("../migrations/0026_quote_google_call_replay.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0027_quote_google_call_demotion.sql", import.meta.url), "utf8"));
  const requestId = gid("Request", 101), clientId = gid("Client", 202);
  sqlite.prepare(`INSERT INTO quo_call_attributions VALUES (?,?,?,?,?,?,?,?)`).run(
    ACCOUNT, "utah", "ACreplay1", requestId, clientId, "incoming", "2026-10-12T19:45:45.000Z", "+16142166149",
  );
  sqlite.prepare(`INSERT INTO closed_loop_quote_attributions
    (quote_id, lead_id, market_key, jobber_request_id, status, attempt_count, created_at, updated_at)
    VALUES (?,?,?,?, 'applied', 1, ?, ?)`).run(
    "quote-1", "quo-call:ACreplay1", "ut", requestId,
    "2026-10-12T20:00:00.000Z", "2026-10-12T20:00:00.000Z",
  );
  sqlite.prepare(`INSERT INTO google_call_match_shadow VALUES (?,?,?,?,?,?,?,?)`).run(
    "customers/4800890529/callViews/123", "ut", "Search | UT | Attic", "614",
    "2026-10-12T19:46:20.000Z", null, "ACreplay1", "matched",
  );
  sqlite.prepare(`INSERT INTO angi_router_jobber_auth
    (account_key,access_token,access_expires_at,refresh_revision,refresh_status)
    VALUES (?,?,?,?,?)`).run("utah", "test-token", Date.now() + 3_600_000, 1, "ready");
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
  }; } }; } };
  const request = new Request("https://example.test/api/jobber/quote-call-replay", {
    method: "POST", headers: { Authorization: "Bearer broker-secret" }, body: "{}",
  });
  return { sqlite, d1, request, requestId, clientId };
}

test("late unique Google match updates one call Quote and checkpoints replay", async () => {
  const { sqlite, d1, request, requestId, clientId } = fixture();
  const mutationCalls = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes("GoodAtticQuoteContext")) return Response.json({ data: { quote: {
      id: "quote-1", request: { id: requestId, client: { id: clientId } },
      customFields: [
        { valueText: `jobber-request:${requestId}`, customFieldConfiguration: { id: "lead-id", name: "Original Lead ID" } },
        { valueText: "Quo inbound call", customFieldConfiguration: { id: "source-id", name: "Original Source" } },
      ],
    } } });
    if (query.includes("GoodAtticCustomFieldConfigurations")) return Response.json({ data: {
      customFieldConfigurations: { nodes: [
        { __typename: "CustomFieldConfigurationText", id: "lead-id", name: "Original Lead ID", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        { __typename: "CustomFieldConfigurationText", id: "source-id", name: "Original Source", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        { __typename: "CustomFieldConfigurationText", id: "campaign-id", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
      ] },
    } });
    if (query.includes("GoodAtticQuoteCustomFields")) {
      mutationCalls.push(variables);
      return Response.json({ data: { quoteEdit: { quote: { id: "quote-1" }, userErrors: [] } } });
    }
    throw new Error("unexpected Jobber query");
  };
  const env = { ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    EXTERNAL_API_WRITES_ENABLED: "true" };
  const response = await replayMatchedCallQuotes({ request, env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "completed", applied: 1, held: 0, retryable: 0,
    reverted: 0, demotion_held: 0, demotion_retryable: 0 },
    JSON.stringify(sqlite.prepare("SELECT * FROM quote_google_call_replays").all()));
  assert.deepEqual(mutationCalls[0].attributes.customFields, [
    { customFieldConfigurationId: "source-id", valueText: "Google Ads call" },
    { customFieldConfigurationId: "campaign-id", valueText: "Search | UT | Attic" },
  ]);
  assert.equal(sqlite.prepare("SELECT state FROM quote_google_call_replays WHERE quote_id = 'quote-1'").get().state, "applied");
  const replayAudit = sqlite.prepare("SELECT campaign_written,promotion_write_verified FROM quote_google_call_replays WHERE quote_id = 'quote-1'").get();
  assert.equal(replayAudit.campaign_written, "Search | UT | Attic");
  assert.equal(replayAudit.promotion_write_verified, 1);
  const again = await replayMatchedCallQuotes({ request, env });
  assert.equal((await again.json()).applied, 0);
  assert.equal(mutationCalls.length, 1);
});

test("an ambiguous Google call match never enters the Quote replay queue", async () => {
  const { sqlite, d1, request } = fixture();
  sqlite.prepare("UPDATE google_call_match_shadow SET match_state = 'held', diagnostic_code = 'ambiguous', quo_call_id = NULL").run();
  globalThis.fetch = async () => { throw new Error("Jobber should not be called"); };
  const response = await replayMatchedCallQuotes({ request, env: {
    ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    EXTERNAL_API_WRITES_ENABLED: "true",
  } });
  assert.deepEqual(await response.json(), { ok: true, status: "completed", applied: 0, held: 0, retryable: 0,
    reverted: 0, demotion_held: 0, demotion_retryable: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM quote_google_call_replays").get().n, 0);
});

test("initial paid Quote fields are demotion-eligible only when both were written", async () => {
  const { sqlite, d1 } = fixture();
  const lead = { lead_id: "quo-call:ACreplay1", google_resource: "customers/4800890529/callViews/123",
    campaign: "Search | UT | Attic" };
  await quoteAttribution.recordInitialGoogleCallQuoteWrite(d1, "quote-1", lead,
    { ok: true, appliedFields: ["Original Lead ID", "Original Source"] });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM quote_google_call_replays").get().n, 0);
  await quoteAttribution.recordInitialGoogleCallQuoteWrite(d1, "quote-1", lead,
    { ok: true, appliedFields: ["Original Source", "Campaign"] });
  const audit = sqlite.prepare("SELECT state,campaign_written,promotion_write_verified FROM quote_google_call_replays").get();
  assert.equal(audit.state, "applied");
  assert.equal(audit.campaign_written, "Search | UT | Attic");
  assert.equal(audit.promotion_write_verified, 1);
});

function recordPromotedQuote(sqlite) {
  sqlite.prepare(`INSERT INTO quote_google_call_replays
    (quote_id, quo_call_id, google_resource, state, attempt_count,
      campaign_written, promotion_write_verified, created_at, updated_at, completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "quote-1", "ACreplay1", "customers/4800890529/callViews/123", "applied", 1,
    "Search | UT | Attic", 1, "2026-10-12T20:00:00.000Z",
    "2026-10-12T20:00:00.000Z", "2026-10-12T20:00:00.000Z",
  );
  sqlite.prepare(`UPDATE google_call_match_shadow SET match_state = 'held',
    diagnostic_code = 'multiple_google_calls_for_quo_call', quo_call_id = NULL`).run();
}

function demotionFetch({ requestId, clientId, source = "Google Ads call", campaign = "Search | UT | Attic" }) {
  const fields = { source, campaign };
  const mutations = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes("GoodAtticQuoteContext")) return Response.json({ data: { quote: {
      id: "quote-1", request: { id: requestId, client: { id: clientId } },
      customFields: [
        { valueText: `jobber-request:${requestId}`, customFieldConfiguration: { id: "lead-id", name: "Original Lead ID" } },
        { valueText: fields.source, customFieldConfiguration: { id: "source-id", name: "Original Source" } },
        { valueText: fields.campaign, customFieldConfiguration: { id: "campaign-id", name: "Campaign" } },
      ],
    } } });
    if (query.includes("GoodAtticCustomFieldConfigurations")) return Response.json({ data: {
      customFieldConfigurations: { nodes: [
        { __typename: "CustomFieldConfigurationText", id: "lead-id", name: "Original Lead ID", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        { __typename: "CustomFieldConfigurationText", id: "source-id", name: "Original Source", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        { __typename: "CustomFieldConfigurationText", id: "campaign-id", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
      ] },
    } });
    if (query.includes("GoodAtticQuoteCustomFields")) {
      mutations.push(variables);
      for (const attribute of variables.attributes.customFields) {
        if (attribute.customFieldConfigurationId === "source-id") fields.source = attribute.valueText;
        if (attribute.customFieldConfigurationId === "campaign-id") fields.campaign = attribute.valueText;
      }
      return Response.json({ data: { quoteEdit: { quote: { id: "quote-1" }, userErrors: [] } } });
    }
    throw new Error("unexpected Jobber query");
  };
  return { fields, mutations };
}

test("a demoted match removes only our exact paid Quote values and records a verified reversal", async () => {
  const { sqlite, d1, request, requestId, clientId } = fixture();
  recordPromotedQuote(sqlite);
  const { fields, mutations } = demotionFetch({ requestId, clientId });
  const env = { ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    EXTERNAL_API_WRITES_ENABLED: "true" };
  const response = await replayMatchedCallQuotes({ request, env });
  assert.deepEqual(await response.json(), { ok: true, status: "completed",
    applied: 0, held: 0, retryable: 0, reverted: 1, demotion_held: 0, demotion_retryable: 0 });
  assert.deepEqual(mutations[0].attributes.customFields, [
    { customFieldConfigurationId: "source-id", valueText: "Quo inbound call" },
    { customFieldConfigurationId: "campaign-id", valueText: "" },
  ]);
  assert.deepEqual(fields, { source: "Quo inbound call", campaign: "" });
  const audit = sqlite.prepare("SELECT state,diagnostic_code FROM quote_google_call_demotions WHERE quote_id = 'quote-1'").get();
  assert.equal(audit.state, "reverted");
  assert.equal(audit.diagnostic_code, "multiple_google_calls_for_quo_call");
  assert.equal(sqlite.prepare("SELECT state FROM quote_google_call_replays WHERE quote_id = 'quote-1'").get().state, "applied");
  const again = await replayMatchedCallQuotes({ request, env });
  assert.equal((await again.json()).reverted, 0);
  assert.equal(mutations.length, 1);
});

test("demotion holds a staff-edited Quote and does not overwrite it", async () => {
  const { sqlite, d1, request, requestId, clientId } = fixture();
  recordPromotedQuote(sqlite);
  const { mutations } = demotionFetch({ requestId, clientId, source: "Staff corrected" });
  const response = await replayMatchedCallQuotes({ request, env: {
    ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    EXTERNAL_API_WRITES_ENABLED: "true",
  } });
  assert.equal((await response.json()).demotion_held, 1);
  assert.equal(mutations.length, 0);
  assert.equal(sqlite.prepare("SELECT last_error_code FROM quote_google_call_demotions WHERE quote_id = 'quote-1'").get().last_error_code,
    "quote_fields_changed");
});

test("a new Google resource does not keep the old paid campaign or auto-promote again", async () => {
  const { sqlite, d1, request, requestId, clientId } = fixture();
  recordPromotedQuote(sqlite);
  sqlite.prepare(`INSERT INTO google_call_match_shadow VALUES (?,?,?,?,?,?,?,?)`).run(
    "customers/4800890529/callViews/456", "ut", "Search | UT | New Campaign", "614",
    "2026-10-12T19:46:25.000Z", null, "ACreplay1", "matched",
  );
  const { fields, mutations } = demotionFetch({ requestId, clientId });
  const response = await replayMatchedCallQuotes({ request, env: {
    ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    EXTERNAL_API_WRITES_ENABLED: "true",
  } });
  assert.equal((await response.json()).reverted, 1);
  assert.deepEqual(fields, { source: "Quo inbound call", campaign: "" });
  assert.equal(mutations.length, 1);
  assert.equal(sqlite.prepare("SELECT state FROM quote_google_call_demotions WHERE quote_id = 'quote-1'").get().state,
    "reverted");
});
