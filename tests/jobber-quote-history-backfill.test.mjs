import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { _private as quote, backfillHistoricalCallQuotes } from "../server/jobber-quote-attribution.js";

const originalFetch = globalThis.fetch;
const databases = [];
const ACCOUNT = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==";
const gid = (type, number) => btoa(`gid://Jobber/${type}/${number}`);
const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  for (const name of [
    "0005_closed_loop_tracking.sql", "0006_closed_loop_quote_attribution.sql",
    "0007_atomic_quote_attribution_claims.sql", "0026_quote_google_call_replay.sql",
    "0028_quote_call_history_backfill.sql",
  ]) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  sqlite.exec(`
    CREATE TABLE closed_loop_stage1_leads (market_key TEXT, request_id TEXT, lead_id TEXT);
    CREATE TABLE closed_loop_stage1_objects (market_key TEXT, object_type TEXT,
      object_id TEXT, request_id TEXT, client_id TEXT, source_created_at TEXT);
    CREATE TABLE call_origin_shadow_object_checks (market_key TEXT, object_type TEXT,
      object_id TEXT, account_id TEXT, operational_request_id TEXT, link_decision_id TEXT,
      direct_call_count INTEGER, direct_max_call_id TEXT, check_status TEXT);
    CREATE TABLE quo_call_attributions (account_id TEXT, market TEXT, quo_call_id TEXT,
      jobber_request_id TEXT, jobber_client_id TEXT, direction TEXT,
      call_started_at_utc TEXT, caller_phone TEXT);
    CREATE TABLE call_request_lineage_active_links (account_id TEXT, market_key TEXT,
      quo_call_id TEXT, original_request_id TEXT, operational_request_id TEXT,
      client_id TEXT, call_started_at_utc TEXT, decision_id TEXT);
    CREATE TABLE angi_router_jobber_auth (account_key TEXT, access_token TEXT,
      access_expires_at INTEGER, refresh_token TEXT, refresh_revision INTEGER,
      refresh_status TEXT, refresh_lease_token TEXT, refresh_lease_expires_at INTEGER,
      last_error_code TEXT);
  `);
  sqlite.prepare(`INSERT INTO angi_router_jobber_auth
    (account_key, access_token, access_expires_at, refresh_revision, refresh_status)
    VALUES (?, ?, ?, 1, 'ready')`).run("utah", "test-token", Date.now() + 3_600_000);
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
  }; } }; } };
  const request = new Request("https://example.test/api/jobber/quote-history-backfill", {
    method: "POST", headers: { Authorization: "Bearer broker-secret" }, body: "{}",
  });
  const env = { ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    JOBBER_QUOTE_HISTORY_BACKFILL_ENABLED: "true", EXTERNAL_API_WRITES_ENABLED: "true" };
  return { sqlite, d1, request, env };
}

function addDirect(sqlite, n, createdAt = old) {
  const quoteId = gid("Quote", n);
  const requestId = gid("Request", n);
  const clientId = gid("Client", n);
  const callId = `ACdirect${n}`;
  sqlite.prepare(`INSERT INTO closed_loop_stage1_objects VALUES ('ut','quote',?,?,?,?)`)
    .run(quoteId, requestId, clientId, createdAt);
  sqlite.prepare(`INSERT INTO call_origin_shadow_object_checks VALUES
    ('ut','quote',?,?,?,NULL,1,?,'resolved')`)
    .run(quoteId, ACCOUNT, requestId, callId);
  sqlite.prepare(`INSERT INTO quo_call_attributions VALUES
    (?,?,?,?,?,'incoming',?,?)`)
    .run(ACCOUNT, "utah", callId, requestId, clientId, old, "+16142166149");
  return { quoteId, requestId, clientId, callId };
}

function mockJobber(quotes, fieldOverrides = {}) {
  const mutations = [];
  const queries = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.getjobber.com/api/graphql");
    const { query, variables } = JSON.parse(options.body);
    queries.push(query);
    if (query.includes("GoodAtticQuoteContext")) {
      const candidate = quotes.get(variables.id);
      assert.ok(candidate);
      const overrides = fieldOverrides[variables.id] || {};
      return Response.json({ data: { quote: {
        id: candidate.quoteId,
        request: { id: overrides.requestId || candidate.requestId,
          client: { id: overrides.clientId || candidate.clientId } },
        customFields: overrides.customFields || [],
      } } });
    }
    if (query.includes("GoodAtticCustomFieldConfigurations")) return Response.json({ data: {
      customFieldConfigurations: { nodes: [
        { __typename: "CustomFieldConfigurationText", id: "lead-id", name: "Original Lead ID", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        { __typename: "CustomFieldConfigurationText", id: "source-id", name: "Original Source", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        { __typename: "CustomFieldConfigurationText", id: "campaign-id", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
      ] },
    } });
    if (query.includes("GoodAtticQuoteCustomFields")) {
      mutations.push(variables);
      return Response.json({ data: { quoteEdit: { quote: { id: variables.quoteId }, userErrors: [] } } });
    }
    throw new Error("unexpected Jobber query");
  };
  return { mutations, queries };
}

test("the historical cron is opt-in and applies at most three old direct call Quotes per run", async () => {
  const { sqlite, request, env } = fixture();
  const candidates = new Map();
  for (let n = 1; n <= 5; n += 1) {
    const candidate = addDirect(sqlite, n);
    candidates.set(candidate.quoteId, candidate);
  }
  const website = addDirect(sqlite, 6);
  sqlite.prepare(`INSERT INTO closed_loop_stage1_leads VALUES ('ut',?,'website-6')`).run(website.requestId);
  addDirect(sqlite, 7, new Date().toISOString());
  const { mutations } = mockJobber(candidates);
  assert.equal((await quote.findHistoricalCallQuoteCandidates(env.ANGI_ROUTER_DB, Date.now())).length, 5);
  const disabled = await backfillHistoricalCallQuotes({ request, env: { ...env,
    JOBBER_QUOTE_HISTORY_BACKFILL_ENABLED: "false" } });
  assert.equal((await disabled.json()).reason, "history_backfill_disabled");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM quote_call_history_backfill").get().n, 0);
  const first = await backfillHistoricalCallQuotes({ request, env });
  assert.deepEqual(await first.json(), { ok: true, status: "completed", applied: 3, held: 0, retryable: 0 });
  assert.equal(mutations.length, 3);
  for (const mutation of mutations) assert.deepEqual(mutation.attributes.customFields.map((field) => field.valueText), [
    `jobber-request:${candidates.get(mutation.quoteId).requestId}`, "Quo inbound call",
  ]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM closed_loop_quote_attributions").get().n, 3);
  const second = await backfillHistoricalCallQuotes({ request, env });
  assert.equal((await second.json()).applied, 2);
  assert.equal(mutations.length, 5);
  const third = await backfillHistoricalCallQuotes({ request, env });
  assert.equal((await third.json()).applied, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM quote_call_history_backfill").get().n, 5);
});

test("a staff edited Quote is held without any mutation", async () => {
  const { sqlite, request, env } = fixture();
  const candidate = addDirect(sqlite, 11);
  const { mutations } = mockJobber(new Map([[candidate.quoteId, candidate]]), {
    [candidate.quoteId]: { customFields: [{ valueText: "Staff corrected source",
      customFieldConfiguration: { id: "source-id", name: "Original Source" } }] },
  });
  const result = await backfillHistoricalCallQuotes({ request, env });
  assert.equal((await result.json()).held, 1);
  assert.equal(mutations.length, 0);
  const audit = sqlite.prepare(`SELECT state,diagnostic_code FROM quote_call_history_backfill`).get();
  assert.equal(audit.state, "held");
  assert.equal(audit.diagnostic_code, "quote_fields_conflict");
  assert.equal(sqlite.prepare(`SELECT status FROM closed_loop_quote_attributions`).get().status, "manual_review");
});

test("live Jobber Request changes and website precedence block a stale shadow Quote", async () => {
  const { sqlite, request, env } = fixture();
  const changed = addDirect(sqlite, 21);
  const website = addDirect(sqlite, 22);
  sqlite.prepare(`INSERT INTO closed_loop_leads
    (lead_id,submission_id,market_key,jobber_request_id,original_source,inquiry_at,created_at,updated_at)
    VALUES ('website-22','submission-22','ut',?,'Website',?,?,?)`)
    .run(website.requestId, old, old, old);
  const { mutations } = mockJobber(new Map([[changed.quoteId, changed]]), {
    [changed.quoteId]: { requestId: gid("Request", 999) },
  });
  const result = await backfillHistoricalCallQuotes({ request, env });
  assert.equal((await result.json()).held, 1);
  assert.equal(mutations.length, 0);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM closed_loop_quote_attributions`).get().n, 0);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM quote_call_history_backfill`).get().n, 1);
  assert.equal(sqlite.prepare(`SELECT diagnostic_code FROM quote_call_history_backfill`).get().diagnostic_code,
    "quote_lineage_changed");
});

test("a website lead on the original Request blocks a reviewed linked Quote", async () => {
  const { sqlite, request, env } = fixture();
  const quoteId = gid("Quote", 31), originalRequestId = gid("Request", 30);
  const requestId = gid("Request", 31), clientId = gid("Client", 31);
  const callId = "AClinked31";
  sqlite.prepare(`INSERT INTO closed_loop_stage1_objects VALUES ('ut','quote',?,?,?,?)`)
    .run(quoteId, requestId, clientId, old);
  sqlite.prepare(`INSERT INTO call_origin_shadow_object_checks VALUES
    ('ut','quote',?,?,?,'decision-31',0,NULL,'resolved')`).run(quoteId, ACCOUNT, requestId);
  sqlite.prepare(`INSERT INTO quo_call_attributions VALUES (?,?,?,?,?,'incoming',?,?)`)
    .run(ACCOUNT, "utah", callId, originalRequestId, clientId, old, "+16142166149");
  sqlite.prepare(`INSERT INTO call_request_lineage_active_links VALUES (?,?,?,?,?,?,?,?)`)
    .run(ACCOUNT, "ut", callId, originalRequestId, requestId, clientId, old, "decision-31");
  sqlite.prepare(`INSERT INTO closed_loop_stage1_leads VALUES ('ut',?,'website-30')`).run(originalRequestId);
  const { mutations } = mockJobber(new Map());
  const result = await backfillHistoricalCallQuotes({ request, env });
  assert.equal((await result.json()).applied, 0);
  assert.equal(mutations.length, 0);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM quote_call_history_backfill`).get().n, 0);
});

test("a later reviewed Request correction holds a formerly direct call Quote", async () => {
  const { sqlite, request, env } = fixture();
  const candidate = addDirect(sqlite, 41);
  sqlite.prepare(`INSERT INTO call_request_lineage_active_links VALUES (?,?,?,?,?,?,?,?)`)
    .run(ACCOUNT, "ut", candidate.callId, candidate.requestId, gid("Request", 42),
      candidate.clientId, old, "decision-41");
  const { mutations } = mockJobber(new Map([[candidate.quoteId, candidate]]));
  const result = await backfillHistoricalCallQuotes({ request, env });
  assert.equal((await result.json()).held, 1);
  assert.equal(mutations.length, 0);
  assert.equal(sqlite.prepare(`SELECT diagnostic_code FROM quote_call_history_backfill`).get().diagnostic_code,
    "call_lineage_changed");
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM closed_loop_quote_attributions`).get().n, 0);
});
