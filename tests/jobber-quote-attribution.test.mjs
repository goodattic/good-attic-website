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
          { id: "ut-lead", name: "Original Lead ID" },
          { id: "ut-source", name: "Original Source" },
          { id: "ut-campaign", name: "Campaign" },
          { id: "other", name: "Unrelated" },
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
