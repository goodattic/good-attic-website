import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { afterEach, test } from "node:test";

import { _private as leads } from "../functions/api/leads.js";
import {
  _private as attribution,
  buildAngiAttribution,
  buildWebsiteAttribution,
  submitFieldflowAttribution,
} from "../server/fieldflow-attribution.js";

const originalFetch = globalThis.fetch;
const SLC_ACCOUNT_ID = leads.MARKET_ROUTES.ut.expectedAccountId;
const receiverValidatorUrl = new URL(
  "../../../../../2026-07-23/i-want-to-create-a-dashboard/lib/highlevel/payload.ts",
  import.meta.url,
);

// Receiver fixture from lib/highlevel/payload.ts at c07acf9 (SHA-256
// 96deec077e1a07593a382555ebced71bc3710405af8da90bfe1a09877a419c87).
// The sibling-repository test below also runs the actual validator when present.
const RECEIVER_SNAKE_CASE_RECORD_KEYS = new Set([
  "schema_version", "jobber_account_id", "jobber_request_id",
  "provider_lead_id", "provider_name", "submission_id", "stable_lead_key",
  "occurred_at", "lead_source", "source_key", "source_detail",
  "source_reason", "gclid", "gbraid", "wbraid", "gad_source",
  "utm_source", "utm_medium", "utm_campaign", "referrer", "request_title",
]);

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function websiteLead(source) {
  return leads.buildLead({
    name: "Private Customer",
    phone: "8015551212",
    email: "private@example.com",
    street_address: "123 Private Lane",
    city: "Salt Lake City",
    state: "UT",
    zip: "84101",
    page_market: "ut",
  }, "submission-123", source);
}

function classifiedWebsiteRecord(payload, submissionId, marketKey = "ut") {
  const lead = leads.buildLead({
    name: "Private Customer",
    phone: "8015551212",
    email: "private@example.com",
    page_market: marketKey,
    ...payload,
  }, submissionId, leads.classifyWebsiteLeadSource(payload));
  return buildWebsiteAttribution(payload, lead, {
    account_id: leads.MARKET_ROUTES[marketKey].expectedAccountId,
    request_id: `request-${submissionId}`,
    client_id: `client-${submissionId}`,
  });
}

function websiteContractScenarios() {
  const capturedAt = new Date().toISOString();
  return [
    {
      name: "clicked Google",
      record: classifiedWebsiteRecord({
        ad_landing_page: "https://goodattic.energy/attic-insulation?gclid=Click_123456&utm_source=google&utm_medium=cpc&utm_campaign=fall",
        ad_referrer: "https://www.google.com/search?q=private+query",
        attribution_captured_at: capturedAt,
        self_reported_source: "google_ads",
        service: "Attic insulation",
        consent: "granted",
      }, "clicked-google"),
      source: ["Google Ads", "google", "google_ads", "gclid"],
    },
    {
      name: "no-click Google organic",
      record: classifiedWebsiteRecord({
        ad_landing_page: "https://goodattic.energy/attic-insulation",
        ad_referrer: "https://www.google.com/search?q=private+query",
        attribution_captured_at: capturedAt,
        self_reported_source: "google_ads",
        service: "Attic insulation",
        consent: "unknown",
      }, "organic-google"),
      source: ["Organic Online", "website", "organic_online", "google_referrer"],
    },
    {
      name: "AI referral organic",
      record: classifiedWebsiteRecord({
        ad_landing_page: "https://goodattic.energy/attic-insulation",
        ad_referrer: "https://chatgpt.com/c/private-path?query=private",
        attribution_captured_at: capturedAt,
        service: "Attic insulation",
        consent: "unknown",
      }, "ai-referral", "mo_stl"),
      marketKey: "mo_stl",
      source: ["Organic Online", "website", "ai_referral", "ai_referrer_chatgpt"],
      wireSourceDetail: "organic_online",
    },
  ];
}

class MemoryD1 {
  constructor() {
    this.calls = [];
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        run: async () => {
          this.calls.push({ sql, args });
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

test("builds a canonical, PII-minimized website attribution record", () => {
  const rawPayload = {
    lead_source: "Angi",
    gclid: "",
    ad_landing_page: "https://goodattic.energy/?gclid=Landing_123456&utm_source=google&utm_medium=cpc&utm_campaign=summer",
    ad_referrer: "https://www.google.com/search?q=private+query",
    first_name: "Private",
    email: "private@example.com",
    notes: "Do not forward this",
  };
  const lead = websiteLead({
    key: "google",
    detail: "google_ads",
    label: "Google Ads",
    reason: "gclid",
  });
  const record = buildWebsiteAttribution(rawPayload, lead, {
    request_id: "jobber-request-123",
    client_id: "jobber-client-123",
  });

  assert.deepEqual(record, {
    schema_version: "2026-09-21",
    market_key: "ut",
    jobber_request_id: "jobber-request-123",
    jobber_client_id: "jobber-client-123",
    submission_id: "submission-123",
    occurred_at: lead.submitted_at,
    lead_source: "Google Ads",
    source_key: "google",
    source_detail: "google_ads",
    source_reason: "gclid",
    campaign: "summer",
    service: "Attic insulation assessment",
    landing_page: "https://goodattic.energy/",
    gclid: "Landing_123456",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "summer",
    referrer: "https://www.google.com",
  });
  for (const forbidden of [
    "first_name",
    "last_name",
    "name",
    "phone",
    "email",
    "address",
    "notes",
    "source_url",
  ]) {
    assert.equal(Object.hasOwn(record, forbidden), false, forbidden);
  }
});

test('KC paid-touch Google evidence remains canonical when the latest touch is organic', () => {
  const payload = {
    attribution_captured_at: new Date().toISOString(),
    ad_landing_page: 'https://goodattic.energy/kansas-city-mo/',
    paid_touch_captured_at: new Date().toISOString(),
    paid_touch_landing_page: 'https://goodattic.energy/kansas-city-mo/?gclid=PaidClick_123456&utm_source=google&utm_medium=cpc&utm_campaign=kc-fall',
    paid_touch_referrer: 'https://www.google.com/search?q=attic',
  };
  const lead = leads.buildLead({ name: 'Source Test', state: 'KS', page_market: 'mo_kc' },
    'paid-touch-kc', leads.classifyWebsiteLeadSource(payload));
  assert.equal(lead.source_reason, 'paid_touch_gclid');
  const record = buildWebsiteAttribution(payload, lead, {
    account_id: leads.MARKET_ROUTES.mo_kc.expectedAccountId,
    request_id: 'request-kc', client_id: 'client-kc',
  });
  assert.equal(record.gclid, 'PaidClick_123456');
  assert.equal(record.utm_source, 'google');
  assert.equal(record.utm_medium, 'cpc');
  assert.equal(record.utm_campaign, 'kc-fall');
  assert.equal(record.landing_page, 'https://goodattic.energy/kansas-city-mo/');
  assert.equal(record.source_key, 'google');
});

test("keeps the server-classified Website/Other source over editable form data", () => {
  const lead = websiteLead({
    key: "website",
    detail: "website_other",
    label: "Good Attic Website",
    reason: "website_other",
  });
  const record = buildWebsiteAttribution(
    { lead_source: "Google Ads" },
    lead,
    { request_id: "jobber-request-website" },
  );

  assert.equal(record.lead_source, "Good Attic Website");
  assert.equal(record.source_key, "website");
  assert.equal(record.source_detail, "website_other");
  assert.equal(record.gclid, undefined);
});

test("projects website attribution for Fieldflow while retaining the richer D1 lead", async () => {
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(null, { status: 202 });
  };
  const database = new MemoryD1();
  const env = {
    ANGI_ROUTER_DB: database,
    EXTERNAL_API_WRITES_ENABLED: "true",
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
    FIELDFLOW_ATTRIBUTION_TOKEN_STL: "stl-secret",
  };

  for (const { name, record, source, marketKey = "ut" } of websiteContractScenarios()) {
    assert.deepEqual(
      [record.lead_source, record.source_key, record.source_detail, record.source_reason],
      source,
      name,
    );
    const richRecord = { ...record, self_reported_source: "google_ads", unexpected_field: "discard" };
    const original = structuredClone(richRecord);
    const result = await submitFieldflowAttribution(env, marketKey, richRecord);
    assert.equal(result.ok, true, name);
    assert.deepEqual(richRecord, original, `${name} record must remain intact for D1`);
  }

  assert.equal(database.calls.length, 3);
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    assert.equal(body.schema_version, "2026-07-31");
    assert.ok(Object.keys(body).every((key) => RECEIVER_SNAKE_CASE_RECORD_KEYS.has(key)));
    for (const field of [
      "market_key", "jobber_client_id", "campaign", "service", "landing_page",
      "consent_state", "self_reported_source", "unexpected_field",
    ]) {
      assert.equal(Object.hasOwn(body, field), false, field);
    }
  }
  assert.deepEqual(
    [bodies[0].lead_source, bodies[0].source_key, bodies[0].source_detail, bodies[0].source_reason],
    ["Google Ads", "google", "google_ads", "gclid"],
  );
  assert.equal(bodies[0].gclid, "Click_123456");
  assert.equal(bodies[0].utm_campaign, "fall");
  assert.deepEqual(
    [bodies[1].lead_source, bodies[1].source_key, bodies[1].source_detail, bodies[1].source_reason],
    ["Organic Online", "website", "organic_online", "google_referrer"],
  );
  assert.equal(Object.hasOwn(bodies[1], "gclid"), false);
  assert.deepEqual(
    [bodies[2].lead_source, bodies[2].source_key, bodies[2].source_detail],
    ["Organic Online", "website", "organic_online"],
  );
  assert.equal(bodies[2].referrer, "https://chatgpt.com");
  assert.equal(database.calls[2].args[2], "mo_stl");
  assert.equal(database.calls[2].args[7], "ai_referral", "D1 retains the original AI source detail");

  const clickedD1Args = database.calls[0].args;
  assert.equal(clickedD1Args[2], "ut");
  assert.equal(clickedD1Args[5], "client-clicked-google");
  assert.equal(clickedD1Args[8], "fall");
  assert.equal(clickedD1Args[9], "Attic insulation");
  assert.equal(clickedD1Args[10], "https://goodattic.energy/attic-insulation");
  assert.equal(clickedD1Args[14], "granted");
});

test("website wire records satisfy the actual Fieldflow receiver validator", {
  skip: !existsSync(receiverValidatorUrl),
}, async () => {
  const { parseHighLevelAttributionPayload } = await import(receiverValidatorUrl.href);
  for (const { name, record, source, wireSourceDetail } of websiteContractScenarios()) {
    assert.throws(
      () => parseHighLevelAttributionPayload(record, { routedJobberAccountId: record.jobber_account_id }),
      /unsupported field `market_key`/,
      `${name} rich record is not a valid wire payload`,
    );
    const wire = attribution.buildFieldflowWireRecord(record);
    const [parsed] = parseHighLevelAttributionPayload(wire, {
      routedJobberAccountId: record.jobber_account_id,
    });
    assert.equal(parsed.schemaVersion, "2026-07-31", name);
    assert.deepEqual(
      [parsed.leadSource, parsed.sourceKey, parsed.sourceDetail],
      [source[0], source[1], wireSourceDetail ?? source[2]],
      name,
    );
    assert.equal(parsed.jobberRequestId, record.jobber_request_id, name);
  }
  const [angi] = parseHighLevelAttributionPayload(attribution.buildFieldflowWireRecord(
    buildAngiAttribution({
      leadOid: "635435743",
      spEntityId: "131399442",
      sourceEventAt: "2026-07-31T18:00:00.000Z",
    }, "jobber-request-angi"),
  ), { routedJobberAccountId: SLC_ACCOUNT_ID });
  assert.equal(angi.providerLeadId, "635435743");
});

test("holds unsupported source combinations locally after preserving the D1 record", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 202 });
  };
  const database = new MemoryD1();
  const base = websiteContractScenarios()[0].record;
  const invalidRecords = [
    { ...base, source_detail: "organic_online" },
    { ...base, source_key: "" },
  ];
  for (const record of invalidRecords) {
    const result = await submitFieldflowAttribution({
      ANGI_ROUTER_DB: database,
      EXTERNAL_API_WRITES_ENABLED: "true",
      FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest",
      FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
    }, "ut", record);
    assert.equal(result.reason, "unsupported_attribution_source");
    assert.equal(result.attempts, 0);
    assert.equal(result.ledger.ok, true);
  }
  assert.equal(database.calls.length, 2);
  assert.equal(database.calls[0].args[7], "organic_online");
  assert.equal(fetchCalls, 0);
});

test("builds an Angi record with exact Jobber and provider identifiers", () => {
  const record = buildAngiAttribution({
    leadOid: "635435743",
    spEntityId: "131399442",
    sourceEventAt: "2026-07-31T18:00:00.000Z",
  }, "jobber-request-angi");
  assert.deepEqual(
    record,
    {
      schema_version: "2026-07-31",
      jobber_request_id: "jobber-request-angi",
      provider_lead_id: "635435743",
      provider_name: "Angi",
      submission_id: "angi:131399442:635435743",
      occurred_at: "2026-07-31T18:00:00.000Z",
      lead_source: "Angi",
      source_reason: "server_routed_angi_provider",
      request_title: "[Angi 635435743]",
    },
  );
  assert.deepEqual(attribution.buildFieldflowWireRecord(record), record);
});

test("persists the durable lead and selects the exact Fieldflow endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 202 });
  };
  const database = new MemoryD1();
  const env = {
    ANGI_ROUTER_DB: database,
    EXTERNAL_API_WRITES_ENABLED: "true",
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest/",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
    FIELDFLOW_ATTRIBUTION_TOKEN_STL: "stl-secret",
    FIELDFLOW_ATTRIBUTION_TOKEN_KC: "kc-secret",
  };
  const record = {
    schema_version: "2026-09-21",
    jobber_request_id: "request",
    submission_id: "submission",
    occurred_at: "2026-07-31T18:00:00.000Z",
    lead_source: "Google Ads",
    source_key: "google",
    source_detail: "google_ads",
    source_reason: "test",
  };

  for (const market of ["ut", "mo_stl", "mo_kc"]) {
    assert.equal((await submitFieldflowAttribution(env, market, record)).ok, true);
  }
  assert.equal(database.calls.length, 2, "only Utah and St. Louis enter the first durable rollout");
  assert.deepEqual(
    calls.map(({ url, options }) => [url, options.headers.Authorization]),
    [
      ["https://fieldflow.example.test/ingest/slc", "Bearer slc-secret"],
      ["https://fieldflow.example.test/ingest/stl", "Bearer stl-secret"],
      ["https://fieldflow.example.test/ingest/kc", "Bearer kc-secret"],
    ],
  );
});

test("blocks preview writes before calling an external receiver", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 202 });
  };
  const result = await submitFieldflowAttribution({
    EXTERNAL_API_WRITES_ENABLED: "false",
  }, "ut", {
    jobber_request_id: "request-preview",
    submission_id: "submission-preview",
  });
  assert.equal(result.reason, "external_api_writes_disabled");
  assert.equal(called, false);
});

test("fails open for unsupported markets, missing config, invalid schema, and receiver rejection", async () => {
  const unsupported = await submitFieldflowAttribution({}, "general", {});
  assert.equal(unsupported.reason, "unsupported_market");

  const missing = await submitFieldflowAttribution({ EXTERNAL_API_WRITES_ENABLED: "true" }, "ut", {});
  assert.equal(missing.reason, "missing_configuration");

  const configuredEnv = {
    EXTERNAL_API_WRITES_ENABLED: "true",
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
  };
  const invalid = await submitFieldflowAttribution(configuredEnv, "ut", {});
  assert.equal(invalid.reason, "unsupported_attribution_schema");
  assert.equal(invalid.attempts, 0);

  globalThis.fetch = async () => new Response(null, { status: 400 });
  const rejected = await submitFieldflowAttribution(configuredEnv, "ut", {
    schema_version: "2026-07-31",
    jobber_request_id: "request-rejected",
    submission_id: "submission-rejected",
    occurred_at: "2026-07-31T18:00:00.000Z",
    source_reason: "test",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.attempts, 1);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.reason, "receiver_rejected");
});
