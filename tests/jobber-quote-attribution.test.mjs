import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  _private as quote,
  buildQuoteQueueEvent,
  parseQuoteWebhook,
  quoteLeadLinkStatus,
} from "../server/jobber-quote-attribution.js";
import {
  applyQuoteCustomFields,
  buildQuoteCustomFieldAttributes,
  filterQuoteCustomFieldConfigurations,
  resolveCustomFieldDefinitions,
} from "../server/jobber-custom-fields.js";

const originalFetch = globalThis.fetch;
const UTAH_ACCOUNT_ID = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==";
const STL_ACCOUNT_ID = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==";

afterEach(() => { globalThis.fetch = originalFetch; });

const LEAD = {
  market_key: "ut",
  source_label: "Google Ads",
  campaign: "ut_attic",
  source_url: "https://goodattic.energy/salt-lake-city-ut/",
};

test("resolves the three account-scoped field identifiers programmatically", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      customFieldConfigurations: {
        nodes: [
          { __typename: "CustomFieldConfigurationText", id: "ut-lead", name: "Original Lead ID", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
          { __typename: "CustomFieldConfigurationText", id: "ut-source", name: "Original Source", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
          { __typename: "CustomFieldConfigurationText", id: "ut-campaign", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
          { __typename: "CustomFieldConfigurationText", id: "job-lead", name: "Original Lead ID", valueType: "TEXT", appliesTo: "ALL_JOBS", readOnly: false },
          { __typename: "CustomFieldConfigurationDropdown", id: "ut-source-dropdown", name: "Original Source", valueType: "DROPDOWN", appliesTo: "ALL_QUOTES", readOnly: false },
          { __typename: "CustomFieldConfigurationText", id: "ut-readonly", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: true },
          { __typename: "CustomFieldConfigurationText", id: "other", name: "Unrelated", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
        ],
      },
    },
  }));
  const result = await resolveCustomFieldDefinitions({}, "token");
  assert.equal(result.ok, true);
  assert.deepEqual([...result.definitions], [
    ["Original Lead ID", "ut-lead"],
    ["Original Source", "ut-source"],
    ["Campaign", "ut-campaign"],
  ]);
});

test("accepts only writable text fields that apply to Quotes", () => {
  const configurations = [
    { __typename: "CustomFieldConfigurationText", id: "quote-text", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: false },
    { __typename: "CustomFieldConfigurationText", id: "job-text", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_JOBS", readOnly: false },
    { __typename: "CustomFieldConfigurationDropdown", id: "quote-dropdown", name: "Campaign", valueType: "DROPDOWN", appliesTo: "ALL_QUOTES", readOnly: false },
    { __typename: "CustomFieldConfigurationText", id: "quote-readonly", name: "Campaign", valueType: "TEXT", appliesTo: "ALL_QUOTES", readOnly: true },
  ];
  assert.deepEqual(filterQuoteCustomFieldConfigurations(configurations).map(({ id }) => id), ["quote-text"]);
});

test("does not overwrite a staff-corrected value and omits a missing campaign", () => {
  const definitions = new Map([
    ["Original Lead ID", "lead-id"],
    ["Original Source", "source-id"],
    ["Campaign", "campaign-id"],
  ]);
  const result = buildQuoteCustomFieldAttributes(
    definitions,
    { ...LEAD, campaign: "" },
    "request-1",
    [{
      valueText: "Staff corrected",
      customFieldConfiguration: { id: "source-id", name: "Original Source" },
    }],
  );
  assert.deepEqual(result.attributes, [{
    customFieldConfigurationId: "lead-id",
    valueText: "jobber-request:request-1",
  }]);
  assert.deepEqual(result.skippedExisting, ["Original Source"]);
  assert.deepEqual(result.missingValues, ["Campaign"]);
});

test("duplicate webhook deliveries produce one stable queue event per quote", () => {
  const body = JSON.stringify({ data: { webHookEvent: {
    topic: "QUOTE_CREATE",
    accountId: STL_ACCOUNT_ID,
    itemId: "quote-1",
    occurredAt: "2026-09-21T18:00:00Z",
  } } });
  const first = parseQuoteWebhook(body);
  const second = parseQuoteWebhook(body);
  assert.deepEqual(first, second);
  assert.equal(first.event.market_key, "mo_stl");
  assert.equal(first.event.event_name, quote.QUOTE_ATTRIBUTION_EVENT_NAME);
  assert.equal(buildQuoteQueueEvent({ accountId: UTAH_ACCOUNT_ID, quoteId: "quote-2", occurredAt: "2026-09-21T18:00:00Z" }).market_key, "ut");
  assert.equal(buildQuoteQueueEvent({ accountId: "kansas-city", quoteId: "quote-3" }), null);
});

test("a quote with no originating Request is held without guessing", () => {
  const route = quote.ROUTES_BY_ACCOUNT_ID.get(UTAH_ACCOUNT_ID);
  assert.deepEqual(
    quoteLeadLinkStatus({ id: "quote-1" }, null, route, UTAH_ACCOUNT_ID),
    { ok: false, status: "missing_request", requestId: "" },
  );
  assert.deepEqual(
    quoteLeadLinkStatus({ id: "quote-1", request: { id: "request-1" } }, null, route, UTAH_ACCOUNT_ID),
    { ok: false, status: "missing_request", requestId: "request-1" },
  );
});

test("a Utah ledger row cannot be used for St. Louis", () => {
  const route = quote.ROUTES_BY_ACCOUNT_ID.get(STL_ACCOUNT_ID);
  const result = quoteLeadLinkStatus(
    { id: "quote-1", request: { id: "request-1" } },
    { market_key: "ut", jobber_account_id: UTAH_ACCOUNT_ID },
    route,
    STL_ACCOUNT_ID,
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "missing_request");
});

test("permission failures are reported without attempting a quote write", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ errors: [{ message: "Missing required scope for custom field configurations" }] }), { status: 403 });
  };
  const result = await applyQuoteCustomFields(
    { EXTERNAL_API_WRITES_ENABLED: "true" },
    "token",
    { id: "quote-1", customFields: [] },
    LEAD,
    "request-1",
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "permission_denied");
  assert.equal(calls, 1);
});

test("preview mode blocks quote writes before resolving fields", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  const result = await applyQuoteCustomFields(
    { EXTERNAL_API_WRITES_ENABLED: "false" },
    "token",
    { id: "quote-1", customFields: [] },
    LEAD,
    "request-1",
  );
  assert.deepEqual(result, { ok: false, skipped: true, reason: "external_api_writes_disabled" });
  assert.equal(calls, 0);
});

test("test mode skips a Quote that is not explicitly allowlisted", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  const request = new Request("https://example.test/api/jobber/quote-resolve", {
    method: "POST",
    headers: { Authorization: "Bearer broker-secret" },
    body: JSON.stringify({
      account_id: UTAH_ACCOUNT_ID,
      market_key: "ut",
      quote_id: "not-the-test-quote",
    }),
  });
  const database = { prepare() { throw new Error("database should not be touched"); } };
  const result = await quote.resolveQuoteAttribution({
    request,
    env: {
      JOBBER_QUOTE_BROKER_SECRET: "broker-secret",
      JOBBER_QUOTE_TEST_MODE: "true",
      JOBBER_QUOTE_TEST_ALLOWLIST_UT: "ut-test-quote",
      ANGI_ROUTER_DB: database,
      EXTERNAL_API_WRITES_ENABLED: "true",
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    ok: true,
    status: "skipped",
    reason: "quote_not_allowlisted",
    quote_id: "not-the-test-quote",
  });
  assert.equal(calls, 0);
});

class AttributionD1 {
  constructor() {
    this.row = null;
  }

  prepare(sql) {
    const database = this;
    if (sql.includes("jobber_quote_attribution:insert")) {
      return { bind(...values) { return { async run() {
        if (!database.row) {
          database.row = {
            quote_id: values[0],
            status: "pending",
            attempt_count: 0,
            claim_token: null,
            claim_expires_at: null,
          };
        }
        return { meta: { changes: 1 } };
      } }; } };
    }
    if (sql.includes("jobber_quote_attribution:select")) {
      return { bind() { return { async first() { return database.row ? { ...database.row } : null; } }; } };
    }
    assert.match(sql, /jobber_quote_attribution:claim/);
    return { bind(...values) { return { async run() {
      const [claimToken, claimExpiresAt] = values;
      const now = values[4];
      const claimable = database.row
        && ["pending", "retryable"].includes(database.row.status)
        && (!database.row.claim_token || database.row.claim_expires_at === null || database.row.claim_expires_at <= now);
      if (!claimable) return { meta: { changes: 0 } };
      database.row.claim_token = claimToken;
      database.row.claim_expires_at = claimExpiresAt;
      database.row.attempt_count += 1;
      return { meta: { changes: 1 } };
    } }; } };
  }
}

test("claims a duplicate Quote atomically so only one worker can write", async () => {
  const database = new AttributionD1();
  const lead = { lead_id: "lead-1", market_key: "ut", jobber_request_id: "request-1" };
  const [first, second] = await Promise.all([
    quote.beginAttribution(database, "quote-1", lead),
    quote.beginAttribution(database, "quote-1", lead),
  ]);
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(first.claimToken, database.row.claim_token);
  assert.equal(database.row.attempt_count, 1);
});
