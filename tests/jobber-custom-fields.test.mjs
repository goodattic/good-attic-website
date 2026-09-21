import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  _private,
  applyClientCustomFields,
  buildClientCustomFieldValues,
  campaignFromLead,
  parseCustomFieldDefinitions,
} from "../server/jobber-custom-fields.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const LEAD = {
  market_key: "ut",
  source_label: "Google Ads",
  source_url: "https://goodattic.energy/salt-lake-city-ut/?utm_campaign=slc_insulation",
};

const DEFINITIONS_ENV = {
  EXTERNAL_API_WRITES_ENABLED: "true",
  JOBBER_CUSTOM_FIELD_DEFINITIONS_UT: "Original Lead ID=def-lead;Original Source=def-source;Campaign=def-campaign",
};

test("parses the configured definition map", () => {
  const definitions = parseCustomFieldDefinitions(DEFINITIONS_ENV.JOBBER_CUSTOM_FIELD_DEFINITIONS_UT);
  assert.equal(definitions.get("Original Lead ID"), "def-lead");
  assert.equal(definitions.get("Original Source"), "def-source");
  assert.equal(definitions.get("Campaign"), "def-campaign");
  assert.equal(parseCustomFieldDefinitions("").size, 0);
  assert.equal(parseCustomFieldDefinitions("Broken;=nope;Campaign=def-campaign").size, 1);
});

test("builds reporting values without personal contact data", () => {
  assert.deepEqual(buildClientCustomFieldValues(LEAD, "request-1"), [
    ["Original Lead ID", "jobber-request:request-1"],
    ["Original Source", "Google Ads"],
    ["Campaign", "slc_insulation"],
  ]);
  assert.equal(campaignFromLead({ source_url: "not a url" }), "");
  assert.deepEqual(buildClientCustomFieldValues({}, ""), [
    ["Original Lead ID", ""],
    ["Original Source", ""],
    ["Campaign", ""],
  ]);
  for (const [name] of buildClientCustomFieldValues(LEAD, "request-1")) {
    assert.ok(_private.CUSTOM_FIELD_NAMES.includes(name), name);
  }
});

test("skips in preview before contacting Jobber", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const result = await applyClientCustomFields({
    EXTERNAL_API_WRITES_ENABLED: "false",
    ...DEFINITIONS_ENV,
  }, "token", "client-1", LEAD, "request-1");
  assert.equal(result.reason, "external_api_writes_disabled");
  assert.equal(called, false);
});

test("skips when definitions are not configured for the market", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const result = await applyClientCustomFields({
    EXTERNAL_API_WRITES_ENABLED: "true",
  }, "token", "client-1", LEAD, "request-1");
  assert.equal(result.reason, "definitions_not_configured");
  assert.equal(called, false);
});

test("applies only the mappable values through clientUpdate", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      data: {
        clientUpdate: {
          client: { id: "client-1" },
          userErrors: [],
        },
      },
    }), { status: 200 });
  };
  const partialEnv = {
    ...DEFINITIONS_ENV,
    JOBBER_CUSTOM_FIELD_DEFINITIONS_UT: "Original Lead ID=def-lead;Original Source=def-source",
  };
  const result = await applyClientCustomFields(partialEnv, "token", "client-1", LEAD, "request-1");
  assert.equal(result.ok, true);
  assert.equal(result.applied, 2);
  assert.deepEqual(result.unmatched, ["Campaign"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.getjobber.com/api/graphql");
  assert.match(calls[0].body.query, /mutation GoodAtticClientCustomFields/);
  assert.deepEqual(calls[0].body.variables.attributes, [
    { definitionId: "def-lead", valueText: "jobber-request:request-1" },
    { definitionId: "def-source", valueText: "Google Ads" },
  ]);
});

test("never throws on Jobber rejection or a network failure", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      clientUpdate: {
        client: null,
        userErrors: [{ message: "Custom field does not apply to client", path: [] }],
      },
    },
  }), { status: 200 });
  const rejected = await applyClientCustomFields(DEFINITIONS_ENV, "token", "client-1", LEAD, "request-1");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "jobber_rejected");
  assert.equal(rejected.userErrors.length, 1);

  globalThis.fetch = async () => {
    throw new Error("boom");
  };
  const failed = await applyClientCustomFields(DEFINITIONS_ENV, "token", "client-1", LEAD, "request-1");
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "network_error");
});
