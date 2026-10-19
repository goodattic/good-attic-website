import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { resolveQuoteAttribution } from "../server/jobber-quote-attribution.js";
import { handleJobberQuoteWebhook } from "../server/jobber-quote-webhook.js";
import { _private as proof, verifiedKcQuoteLeadRow } from "../server/kc-website-quote-proof.js";
import { prepareKcNonpaidSource, completeKcNonpaidSource } from "../server/kc-website-nonpaid-source.js";

const ACCOUNT = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==";
const REQUEST = btoa("gid://Jobber/Request/41001");
const CLIENT = btoa("gid://Jobber/Client/51001");
const OTHER_CLIENT = btoa("gid://Jobber/Client/51002");
const QUOTE = btoa("gid://Jobber/Quote/61001");
const SUBMISSION = "feadbeef-1000-4000-8000-000000000001";
const CLICK = "test-click-12345";
const SOURCE_AT = "2026-10-19T18:00:00.000Z";
const CONVERSION_AT = "2026-10-19T18:01:00.000Z";
const LANDING = `https://goodattic.energy/kansas-city-mo/?gclid=${CLICK}&utm_campaign=kc_attic`;
const originalFetch = globalThis.fetch;
const databases = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const database of databases.splice(0)) database.close();
});

function databaseWithPaidLead() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE angi_router_jobber_auth (
      account_key TEXT, access_token TEXT, access_expires_at INTEGER,
      refresh_token TEXT, refresh_revision INTEGER, refresh_status TEXT,
      refresh_lease_token TEXT, refresh_lease_expires_at INTEGER, last_error_code TEXT
    );
    CREATE TABLE closed_loop_leads (
      lead_id TEXT, submission_id TEXT, market_key TEXT, jobber_account_id TEXT,
      jobber_request_id TEXT, jobber_client_id TEXT, original_source TEXT,
      source_detail TEXT, campaign TEXT, landing_page TEXT,
      gclid TEXT, gbraid TEXT, wbraid TEXT, inquiry_at TEXT
    );
    CREATE TABLE website_google_source_proofs (
      submission_id TEXT, market_key TEXT, account_id TEXT, jobber_request_id TEXT,
      jobber_client_id TEXT, source_lead_id TEXT, source_key TEXT, source_detail TEXT,
      source_reason TEXT, evidence_json TEXT, state TEXT, jobber_source_app TEXT,
      fallback_reason TEXT
    );
    CREATE TABLE kc_website_nonpaid_source_attestations (
      submission_id TEXT PRIMARY KEY, market_key TEXT, source_key TEXT,
      source_label TEXT, source_detail TEXT, source_reason TEXT,
      source_created_at TEXT, state TEXT, account_id TEXT,
      jobber_request_id TEXT, jobber_client_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE website_form_conversions (
      submission_id TEXT, transaction_id TEXT, market_key TEXT, jobber_account_id TEXT,
      jobber_request_id TEXT, jobber_client_id TEXT, state TEXT,
      reconciliation_required INTEGER, conversion_at TEXT
    );
    CREATE TABLE acknowledgement_sources (
      account_id TEXT, request_id TEXT, market_key TEXT, client_id TEXT,
      source_kind TEXT, source_lead_id TEXT, source_created_at TEXT
    );
    CREATE TABLE closed_loop_quote_attributions (
      quote_id TEXT PRIMARY KEY, lead_id TEXT, market_key TEXT, jobber_request_id TEXT,
      status TEXT, attempt_count INTEGER, last_error_code TEXT, created_at TEXT,
      updated_at TEXT, completed_at TEXT, claim_token TEXT, claim_expires_at INTEGER
    );
  `);
  sqlite.prepare(`INSERT INTO angi_router_jobber_auth
    (account_key, access_token, access_expires_at, refresh_revision, refresh_status)
    VALUES ('kc', 'website-token', ?, 0, 'ready')`).run(Date.now() + 3_600_000);
  sqlite.prepare(`INSERT INTO angi_router_jobber_auth
    (account_key, access_token, access_expires_at, refresh_revision, refresh_status)
    VALUES ('kc_google', 'wrong-google-token', ?, 0, 'ready')`).run(Date.now() + 3_600_000);
  sqlite.prepare(`INSERT INTO closed_loop_leads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `jobber-request:${REQUEST}`, SUBMISSION, "mo_kc", ACCOUNT,
    REQUEST, CLIENT, "Google Ads", "google_ads", "kc_attic", LANDING,
    CLICK, null, null, SOURCE_AT,
  );
  const evidence = JSON.stringify({ schema_version: 1, source_key: "google",
    source_detail: "google_ads", source_reason: "gclid",
    verified_signals: { gclid: CLICK },
    attribution: { attribution_captured_at: SOURCE_AT, ad_landing_page: LANDING } });
  sqlite.prepare(`INSERT INTO website_google_source_proofs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    SUBMISSION, "mo_kc", ACCOUNT, REQUEST, CLIENT,
    `website:${SUBMISSION}`, "google", "google_ads", "gclid", evidence,
    "completed", "website", "google_app_unavailable",
  );
  sqlite.prepare(`INSERT INTO website_form_conversions VALUES (?,?,?,?,?,?,?,?,?)`).run(
    SUBMISSION, SUBMISSION, "mo_kc", ACCOUNT, REQUEST, CLIENT,
    "completed", 0, CONVERSION_AT,
  );
  sqlite.prepare(`INSERT INTO acknowledgement_sources VALUES (?,?,?,?,?,?,?)`).run(
    ACCOUNT, REQUEST, "mo_kc", CLIENT, "website", `website:${SUBMISSION}`, SOURCE_AT,
  );
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
  }; } }; } };
  return { sqlite, d1 };
}

function quotedJobberFetch({ clientId = CLIENT, fields = [], duplicateDefinition = false,
  secondClientId = clientId, secondFields = fields, mutationQuoteId = QUOTE,
  onConfigurations = null, mutateAfterWrite = null } = {}) {
  const writes = [];
  const requests = [];
  let contextReads = 0;
  let currentFields = fields;
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    requests.push({ query, variables, authorization: options.headers.Authorization });
    assert.equal(options.headers.Authorization, "bearer website-token");
    if (query.includes("GoodAtticQuoteContext")) {
      contextReads += 1;
      if (contextReads === 2) currentFields = secondFields;
      return Response.json({ data: { quote: { id: QUOTE,
        request: { id: REQUEST,
          client: { id: contextReads === 1 ? clientId : secondClientId } },
        customFields: currentFields } } });
    }
    if (query.includes("GoodAtticCustomFieldConfigurations")) {
      onConfigurations?.();
      const names = ["Original Lead ID", "Original Source", "Campaign"];
      const nodes = names.map((name, index) => ({ __typename: "CustomFieldConfigurationText",
        id: `kc-field-${index}`, name, valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false }));
      if (duplicateDefinition) nodes.push({ ...nodes[1], id: "kc-source-duplicate" });
      return Response.json({ data: { customFieldConfigurations: {
        pageInfo: { hasNextPage: false }, nodes,
      } } });
    }
    if (query.includes("GoodAtticQuoteCustomFields")) {
      writes.push(variables);
      currentFields = [...currentFields, ...variables.attributes.customFields.map((field) => ({
        valueText: field.valueText,
        customFieldConfiguration: { id: field.customFieldConfigurationId },
      }))];
      if (mutateAfterWrite) currentFields = mutateAfterWrite(currentFields);
      return Response.json({ data: { quoteEdit: { quote: { id: mutationQuoteId }, userErrors: [] } } });
    }
    throw new Error("unexpected Jobber query");
  };
  return { writes, requests, contextReads: () => contextReads };
}

function event(overrides = {}) {
  return { schema_version: 1, source: "jobber", topic: "QUOTE_CREATE",
    event_name: "jobber.quote_attribution.v1", account_id: ACCOUNT,
    market_key: "mo_kc", quote_id: QUOTE, occurred_at: CONVERSION_AT,
    ...overrides };
}

async function resolve(d1, overrides = {}) {
  const request = new Request("https://goodattic.energy/api/jobber/quote-resolve", {
    method: "POST", headers: { Authorization: "Bearer broker-secret" },
    body: JSON.stringify(event(overrides)),
  });
  const response = await resolveQuoteAttribution({ request, env: {
    ANGI_ROUTER_DB: d1, JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
    EXTERNAL_API_WRITES_ENABLED: "true",
  } });
  return { httpStatus: response.status, body: await response.json() };
}

test("KC paid website Quote writes three verified fields with the Website Leads token", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch();
  const result = await resolve(d1);
  assert.equal(result.body.status, "applied");
  assert.equal(jobber.writes.length, 1);
  assert.deepEqual(jobber.writes[0].attributes.customFields, [
    { customFieldConfigurationId: "kc-field-0", valueText: `jobber-request:${REQUEST}` },
    { customFieldConfigurationId: "kc-field-1", valueText: "Google Ads" },
    { customFieldConfigurationId: "kc-field-2", valueText: "kc_attic" },
  ]);
  assert.equal(sqlite.prepare("SELECT status FROM closed_loop_quote_attributions").get().status, "applied");
});

test("manual and Quo-only KC Requests cannot fall back to call attribution", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  sqlite.exec(`DELETE FROM closed_loop_leads;
    DELETE FROM website_google_source_proofs;
    DELETE FROM acknowledgement_sources;
    DELETE FROM website_form_conversions;`);
  const jobber = quotedJobberFetch();
  const result = await resolve(d1);
  assert.equal(result.body.status, "missing_request");
  assert.equal(jobber.writes.length, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM closed_loop_quote_attributions").get().n, 0);
});

test("organic KC website form writes its verified source and Request ID", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  sqlite.exec("DELETE FROM closed_loop_leads; DELETE FROM website_google_source_proofs;");
  sqlite.prepare(`INSERT INTO kc_website_nonpaid_source_attestations VALUES
    (?, 'mo_kc', 'website', 'Organic Online', 'organic_online',
      'non_google_attribution', ?, 'completed', ?, ?, ?, ?, ?)`)
    .run(SUBMISSION, SOURCE_AT, ACCOUNT, REQUEST, CLIENT, SOURCE_AT, CONVERSION_AT);
  const jobber = quotedJobberFetch();
  const result = await resolve(d1);
  assert.equal(result.body.status, "applied");
  assert.deepEqual(jobber.writes[0].attributes.customFields, [
    { customFieldConfigurationId: "kc-field-0", valueText: `jobber-request:${REQUEST}` },
    { customFieldConfigurationId: "kc-field-1", valueText: "Organic Online" },
  ]);
});

test("missing paid proof after a paid Request cannot become generic Website", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  sqlite.exec("DELETE FROM website_google_source_proofs");
  const jobber = quotedJobberFetch();
  const result = await resolve(d1);
  assert.equal(result.body.status, "held");
  assert.equal(result.body.reason, "kc_website_source_conflict");
  assert.equal(jobber.writes.length, 0);
});

test("non-paid source attestation reuses first server time on a safe pre-write retry", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  sqlite.exec("DELETE FROM website_google_source_proofs");
  const lead = { submission_id: SUBMISSION, market_key: "mo_kc",
    source_key: "website", source_label: "Organic Online",
    source_detail: "organic_online", source_reason: "non_google_attribution",
    submitted_at: SOURCE_AT };
  const first = await prepareKcNonpaidSource(d1, lead);
  const retry = await prepareKcNonpaidSource(d1,
    { ...lead, submitted_at: "2026-10-19T18:10:00.000Z" });
  assert.equal(retry.source_created_at, first.source_created_at);
  await completeKcNonpaidSource(d1, { ...lead, submitted_at: retry.source_created_at },
    { account_id: ACCOUNT, market_key: "mo_kc", request_id: REQUEST, client_id: CLIENT });
  assert.equal(sqlite.prepare(`SELECT state FROM kc_website_nonpaid_source_attestations
    WHERE submission_id = ?`).get(SUBMISSION).state, "completed");
});

test("KC Quote must match the paid website Request and Client", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ clientId: OTHER_CLIENT });
  const result = await resolve(d1);
  assert.equal(result.body.status, "held");
  assert.equal(jobber.writes.length, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM closed_loop_quote_attributions").get().n, 0);
});

test("incomplete form, receipt, or Google source proof holds KC Quote before a write", async () => {
  for (const [sql, status] of [
    ["UPDATE website_form_conversions SET reconciliation_required = 1", "held"],
    ["UPDATE website_google_source_proofs SET state = 'write_started'", "missing_request"],
    ["DELETE FROM acknowledgement_sources", "missing_request"],
    ["UPDATE acknowledgement_sources SET source_created_at = '2026-10-19T17:00:00Z'", "held"],
    ["UPDATE website_google_source_proofs SET evidence_json = '{}'", "held"],
    ["UPDATE closed_loop_leads SET gclid = 'spoofed-click-123'", "held"],
  ]) {
    const { sqlite, d1 } = databaseWithPaidLead();
    sqlite.exec(sql);
    const jobber = quotedJobberFetch();
    const result = await resolve(d1);
    assert.equal(result.body.status, status, sql);
    assert.equal(jobber.writes.length, 0, sql);
  }
});

test("a new paid proof cannot be labeled as generic Website during ledger delay", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  sqlite.exec("DELETE FROM closed_loop_leads");
  const jobber = quotedJobberFetch();
  const result = await resolve(d1);
  assert.equal(result.body.status, "missing_request");
  assert.equal(jobber.writes.length, 0);
});

test("duplicate KC Quote configuration names fail closed before quoteEdit", async () => {
  const { d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ duplicateDefinition: true });
  const result = await resolve(d1);
  assert.equal(result.body.status, "quote_attribution_failed");
  assert.equal(result.body.reason, "definitions_ambiguous");
  assert.equal(jobber.writes.length, 0);
});

test("staff-entered divergent values cause manual review without overwriting", async () => {
  const { d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ fields: [{ valueText: "Staff source",
    customFieldConfiguration: { id: "kc-field-1", name: "Original Source" } }] });
  const result = await resolve(d1);
  assert.equal(result.body.status, "manual_review");
  assert.equal(result.body.reason, "quote_fields_conflict");
  assert.equal(jobber.writes.length, 0);
});

test("KC Quote Client changed during proof check blocks quoteEdit", async () => {
  const { d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ secondClientId: OTHER_CLIENT });
  const result = await resolve(d1);
  assert.equal(result.body.status, "manual_review");
  assert.equal(result.body.reason, "quote_lineage_changed");
  assert.equal(jobber.writes.length, 0);
});

test("staff field changed between Quote reads blocks quoteEdit", async () => {
  const { d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ secondFields: [{ valueText: "Staff source",
    customFieldConfiguration: { id: "kc-field-1", name: "Original Source" } }] });
  const result = await resolve(d1);
  assert.equal(result.body.status, "manual_review");
  assert.equal(result.body.reason, "quote_fields_conflict");
  assert.equal(jobber.writes.length, 0);
});

test("KC source proof changed during definition lookup blocks quoteEdit", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ onConfigurations() {
    sqlite.exec("UPDATE website_google_source_proofs SET state = 'write_started'");
  } });
  const result = await resolve(d1);
  assert.equal(result.body.status, "manual_review");
  assert.equal(result.body.reason, "source_proof_changed");
  assert.equal(jobber.writes.length, 0);
});

test("KC readback verifies a previously matching field as well as new fields", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  const jobber = quotedJobberFetch({ fields: [{ valueText: "Google Ads",
    customFieldConfiguration: { id: "kc-field-1", name: "Original Source" } }],
  mutateAfterWrite(fields) { return fields.map((field) =>
    field.customFieldConfiguration?.id === "kc-field-1"
      ? { ...field, valueText: "Staff changed" } : field); } });
  const result = await resolve(d1);
  assert.equal(result.body.reason, "quote_write_unverified");
  assert.equal(jobber.writes.length, 1);
  assert.equal(sqlite.prepare("SELECT status FROM closed_loop_quote_attributions").get().status,
    "retryable");
});

test("ambiguous Jobber mutation response cannot mark KC Quote applied", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  quotedJobberFetch({ mutationQuoteId: OTHER_CLIENT });
  const result = await resolve(d1);
  assert.equal(result.body.status, "quote_attribution_failed");
  assert.notEqual(sqlite.prepare("SELECT status FROM closed_loop_quote_attributions").get().status,
    "applied");
});

test("KC historical call replay and pre-cutover event never touch Jobber", async () => {
  const { d1 } = databaseWithPaidLead();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected fetch"); };
  assert.equal((await resolve(d1, { historical_call_backfill: true })).body.status, "held");
  assert.equal((await resolve(d1, { occurred_at: "2026-10-18T23:59:59Z" })).body.status, "held");
  assert.equal(calls, 0);
});

test("a conflicting existing Quote attribution claim cannot be reparented", async () => {
  const { sqlite, d1 } = databaseWithPaidLead();
  sqlite.prepare(`INSERT INTO closed_loop_quote_attributions
    (quote_id, lead_id, market_key, jobber_request_id, status, attempt_count, created_at, updated_at)
    VALUES (?, 'other-lead', 'mo_kc', ?, 'pending', 0, ?, ?)`)
    .run(QUOTE, REQUEST, SOURCE_AT, SOURCE_AT);
  const jobber = quotedJobberFetch();
  const result = await resolve(d1);
  assert.equal(result.body.status, "manual_review");
  assert.equal(result.body.reason, "quote_attribution_conflict");
  assert.equal(jobber.writes.length, 0);
});

test("KC Quote webhook accepts the configured shared Website Leads signature", async () => {
  const raw = JSON.stringify({ data: { webHookEvent: {
    topic: "QUOTE_CREATE", accountId: ACCOUNT, itemId: QUOTE, occurredAt: CONVERSION_AT,
  } } });
  const queued = [];
  const makeRequest = (secret) => new Request("https://goodattic.energy/api/jobber/quote-webhook", {
    method: "POST", body: raw,
    headers: { "X-Jobber-Hmac-SHA256": createHmac("sha256", secret).update(raw).digest("base64") },
  });
  const env = { JOBBER_CLIENT_SECRET: "shared-website-secret",
    JOBBER_CLIENT_SECRET_GOOGLE: "google-app-secret",
    JOBBER_QUOTE_QUEUE: { async send(body) { queued.push(body); } } };
  const rejected = await handleJobberQuoteWebhook({ request: makeRequest("google-app-secret"), env });
  assert.equal(rejected.status, 401);
  const accepted = await handleJobberQuoteWebhook({ request: makeRequest("shared-website-secret"), env });
  assert.equal(accepted.status, 202);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].market_key, "mo_kc");
});

test("KC proof validator rejects non-UUID and pre-cutover ledger rows", async () => {
  const { d1 } = databaseWithPaidLead();
  const row = (await d1.prepare(proof.KC_QUOTE_LEAD_SQL).bind(REQUEST).all()).results[0];
  const identity = { accountId: ACCOUNT, requestId: REQUEST, clientId: CLIENT };
  assert.equal(verifiedKcQuoteLeadRow(row, identity), true);
  assert.equal(verifiedKcQuoteLeadRow({ ...row, submission_id: "manual-import" }, identity), false);
  assert.equal(verifiedKcQuoteLeadRow({ ...row, inquiry_at: "2026-10-18T18:00:00.000Z",
    source_created_at: "2026-10-18T18:00:00.000Z" }, identity), false);
});
