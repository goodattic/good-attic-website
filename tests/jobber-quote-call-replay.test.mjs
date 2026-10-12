import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { replayMatchedCallQuotes } from "../server/jobber-quote-attribution.js";

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
  assert.deepEqual(await response.json(), { ok: true, status: "completed", applied: 1, held: 0, retryable: 0 },
    JSON.stringify(sqlite.prepare("SELECT * FROM quote_google_call_replays").all()));
  assert.deepEqual(mutationCalls[0].attributes.customFields, [
    { customFieldConfigurationId: "source-id", valueText: "Google Ads call" },
    { customFieldConfigurationId: "campaign-id", valueText: "Search | UT | Attic" },
  ]);
  assert.equal(sqlite.prepare("SELECT state FROM quote_google_call_replays WHERE quote_id = 'quote-1'").get().state, "applied");
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
  assert.deepEqual(await response.json(), { ok: true, status: "completed", applied: 0, held: 0, retryable: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM quote_google_call_replays").get().n, 0);
});
