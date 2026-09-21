import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { _private as leads } from "../functions/api/leads.js";
import {
  buildAngiAttribution,
  buildWebsiteAttribution,
  submitFieldflowAttribution,
} from "../server/fieldflow-attribution.js";

const originalFetch = globalThis.fetch;

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

test("builds an Angi record with exact Jobber and provider identifiers", () => {
  assert.deepEqual(
    buildAngiAttribution({
      leadOid: "635435743",
      spEntityId: "131399442",
      sourceEventAt: "2026-07-31T18:00:00.000Z",
    }, "jobber-request-angi"),
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

test("fails open for unsupported markets, missing config, and receiver rejection", async () => {
  const unsupported = await submitFieldflowAttribution({}, "general", {});
  assert.equal(unsupported.reason, "unsupported_market");

  const missing = await submitFieldflowAttribution({ EXTERNAL_API_WRITES_ENABLED: "true" }, "ut", {});
  assert.equal(missing.reason, "missing_configuration");

  globalThis.fetch = async () => new Response(null, { status: 400 });
  const rejected = await submitFieldflowAttribution({
    EXTERNAL_API_WRITES_ENABLED: "true",
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
  }, "ut", {});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.attempts, 1);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.reason, "receiver_rejected");
});
