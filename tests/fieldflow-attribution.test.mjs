import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { _private as leads } from "../functions/api/leads.js";
import {
  buildAngiAttribution,
  buildFieldflowWireRecord,
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
  });

  assert.deepEqual(record, {
    schema_version: "2026-09-01",
    jobber_request_id: "jobber-request-123",
    submission_id: "submission-123",
    occurred_at: lead.submitted_at,
    lead_source: "Google Ads",
    source_key: "google",
    source_detail: "google_ads",
    source_reason: "gclid",
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
    "market",
    "jobber_account_id",
  ]) {
    assert.equal(Object.hasOwn(record, forbidden), false, forbidden);
  }
});

test("sends canonical Organic Online attribution to Fieldflow over editable form data", () => {
  const lead = websiteLead({
    key: "website",
    detail: "organic_online",
    label: "Organic Online",
    reason: "google_organic_utm",
  });
  const record = buildWebsiteAttribution(
    {
      lead_source: "Google Ads",
      utm_source: "google",
      utm_medium: "organic",
      utm_campaign: "attic-help",
      ad_referrer: "https://www.google.com/search?q=private+query",
    },
    lead,
    { request_id: "jobber-request-website" },
  );

  assert.equal(record.lead_source, "Organic Online");
  assert.equal(record.source_key, "website");
  assert.equal(record.source_detail, "organic_online");
  assert.equal(record.source_reason, "google_organic_utm");
  assert.equal(record.utm_campaign, "attic-help");
  assert.equal(record.referrer, "https://www.google.com");
  assert.equal(record.gclid, undefined);
  assert.equal(record.utm_source, undefined);
  assert.equal(record.utm_medium, undefined);
});

test("does not forward stale paid markers that were classified Organic Online", () => {
  const lead = websiteLead({
    key: "website",
    detail: "organic_online",
    label: "Organic Online",
    reason: "missing_or_stale_attribution",
  });
  const record = buildWebsiteAttribution(
    {
      gclid: "stale-click-id",
      gad_source: "1",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "old-campaign",
    },
    lead,
    { request_id: "jobber-request-stale" },
  );

  assert.equal(record.lead_source, "Organic Online");
  assert.equal(record.source_detail, "organic_online");
  assert.equal(record.gclid, undefined);
  assert.equal(record.gad_source, undefined);
  assert.equal(record.utm_source, undefined);
  assert.equal(record.utm_medium, undefined);
  assert.equal(record.utm_campaign, "old-campaign");
});

const auditNow = Date.parse("2026-09-08T18:00:00Z");
const auditJobber = { request_id: "request-local-audit" };

function classifiedRecord(payload) {
  const source = leads.classifyWebsiteLeadSource(payload, auditNow);
  const lead = websiteLead(source);
  return {
    source,
    record: buildWebsiteAttribution(payload, lead, auditJobber),
    ghl: leads.buildGhlLead(payload, lead, auditJobber),
  };
}

function returningPayload(prefix = "paid_touch") {
  return {
    attribution_captured_at: new Date(auditNow).toISOString(),
    ad_landing_page: "https://goodattic.energy/?utm_source=google&utm_medium=organic&utm_campaign=unrelated-return",
    ad_referrer: "https://www.google.com/search?q=private",
    [`${prefix}_captured_at`]: new Date(auditNow - 86400000).toISOString(),
    [`${prefix}_landing_page`]: "https://goodattic.energy/salt-lake-city-ut/",
    [`${prefix}_referrer`]: "https://www.google.com/",
  };
}

for (const prefix of ["paid_touch", "first_touch"]) {
  for (const clickField of ["gclid", "gbraid", "wbraid"]) {
    for (const inUrl of [false, true]) {
      test(`preserves ${prefix} ${clickField} from ${inUrl ? "URL" : "field"} after an organic return`, () => {
        const payload = returningPayload(prefix);
        const click = `LOCAL_ONLY_${prefix}_${clickField}`;
        if (inUrl) {
          payload[`${prefix}_landing_page`] += `?${clickField}=${click}&utm_campaign=paid-original`;
        } else {
          payload[`${prefix}_${clickField}`] = click;
          payload[`${prefix}_utm_campaign`] = "paid-original";
        }
        const original = structuredClone(payload);
        const { source, record, ghl } = classifiedRecord(payload);
        assert.equal(source.reason, `${prefix}_${clickField}`);
        assert.equal(record[clickField], click);
        assert.equal(record.utm_campaign, "paid-original");
        assert.equal(record.utm_medium, undefined);
        assert.equal(ghl[clickField], click);
        assert.equal(ghl.utm_campaign, "paid-original");
        assert.equal(ghl.utm_medium, "");
        assert.equal(ghl.attribution_captured_at, payload[`${prefix}_captured_at`]);
        assert.equal(ghl.ad_landing_page, payload[`${prefix}_landing_page`]);
        assert.deepEqual(payload, original);
      });
    }
  }
}

test("never fills missing saved-touch fields from the current or first visit", () => {
  const payload = {
    ...returningPayload(),
    paid_touch_gclid: "LOCAL_ONLY_SAVED_CLICK",
    first_touch_utm_campaign: "unrelated-first",
    utm_id: "unrelated-id",
    utm_term: "unrelated-keyword",
    utm_content: "unrelated-ad",
    wbraid: "LOCAL_ONLY_STALE_CURRENT",
    attribution_captured_at: new Date(auditNow - 91 * 86400000).toISOString(),
  };
  delete payload.paid_touch_referrer;
  const { record, ghl } = classifiedRecord(payload);
  assert.equal(record.gclid, payload.paid_touch_gclid);
  assert.equal(record.utm_campaign, undefined);
  assert.equal(record.referrer, undefined);
  assert.equal(record.wbraid, undefined);
  for (const field of ["utm_campaign", "utm_id", "utm_term", "utm_content", "ad_referrer", "wbraid"]) {
    assert.equal(ghl[field], "", field);
  }
});

test("uses a newer fresh paid visit rather than the saved older paid visit", () => {
  const payload = {
    ...returningPayload(),
    ad_landing_page: "https://goodattic.energy/?gclid=LOCAL_NEW_PAID&utm_campaign=new-paid",
    paid_touch_gclid: "LOCAL_OLDER_PAID",
    paid_touch_utm_campaign: "older-paid",
  };
  const { source, record } = classifiedRecord(payload);
  assert.equal(source.reason, "gclid");
  assert.equal(record.gclid, "LOCAL_NEW_PAID");
  assert.equal(record.utm_campaign, "new-paid");
});

for (const ageDays of [91, -1]) {
  test(`rejects saved paid evidence with invalid age ${ageDays} days`, () => {
    const payload = {
      ...returningPayload(),
      paid_touch_gclid: "LOCAL_INVALID_AGE",
      paid_touch_captured_at: new Date(auditNow - ageDays * 86400000).toISOString(),
    };
    const { source, record } = classifiedRecord(payload);
    assert.equal(source.key, "website");
    assert.equal(record.gclid, undefined);
  });
}

test("retains saved paid UTMs without inventing a Google click ID", () => {
  const { source, record } = classifiedRecord({
    ...returningPayload(),
    paid_touch_utm_source: "google",
    paid_touch_utm_medium: "cpc",
    paid_touch_utm_campaign: "paid-utm-only",
  });
  assert.equal(source.reason, "paid_touch_google_paid_utm");
  assert.equal(record.utm_source, "google");
  assert.equal(record.utm_medium, "cpc");
  assert.equal(record.utm_campaign, "paid-utm-only");
  assert.equal(record.gclid, undefined);
});

test("missing attribution does not acquire paid markers", () => {
  const { source, record } = classifiedRecord({});
  assert.equal(source.key, "website");
  assert.equal(source.reason, "missing_or_stale_attribution");
  assert.equal(record.gclid, undefined);
  assert.equal(record.utm_source, undefined);
});

test("builds an Angi record with exact Jobber and provider identifiers", () => {
  assert.deepEqual(
    buildAngiAttribution({
      leadOid: "635435743",
      spEntityId: "131399442",
      sourceEventAt: "2026-07-31T18:00:00.000Z",
    }, "jobber-request-angi"),
    {
      schema_version: "2026-09-01",
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

test("selects the exact Fieldflow endpoint and secret for each market", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 202 });
  };
  const env = {
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest/",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
    FIELDFLOW_ATTRIBUTION_TOKEN_STL: "stl-secret",
    FIELDFLOW_ATTRIBUTION_TOKEN_KC: "kc-secret",
  };
  const record = {
    schema_version: "2026-09-01",
    jobber_request_id: "request",
    occurred_at: "2026-07-31T18:00:00.000Z",
    source_reason: "test",
  };

  for (const market of ["ut", "mo_stl", "mo_kc"]) {
    assert.equal((await submitFieldflowAttribution(env, market, record)).ok, true);
  }
  assert.deepEqual(
    calls.map(({ url, options }) => [url, options.headers.Authorization]),
    [
      ["https://fieldflow.example.test/ingest/slc", "Bearer slc-secret"],
      ["https://fieldflow.example.test/ingest/stl", "Bearer stl-secret"],
      ["https://fieldflow.example.test/ingest/kc", "Bearer kc-secret"],
    ],
  );
  assert.ok(calls.every(({ options }) => JSON.parse(options.body).schema_version === "2026-07-31"));
  assert.equal(record.schema_version, "2026-09-01");
});

test("adapts the wire contract without erasing the richer audit record", () => {
  const record = {
    schema_version: "2026-09-01",
    jobber_request_id: "local-only",
    lead_source: "Organic Online",
    source_key: "website",
    source_detail: "ai_referral",
    source_reason: "self_reported_ai_chatgpt",
    self_reported_source: "ai_search",
    self_reported_source_detail: "chatgpt",
  };
  const original = structuredClone(record);
  const wire = buildFieldflowWireRecord(record);
  assert.equal(wire.schema_version, "2026-07-31");
  assert.equal(wire.source_detail, "organic_online");
  assert.equal(wire.source_reason, record.source_reason);
  assert.equal(wire.self_reported_source, undefined);
  assert.equal(wire.self_reported_source_detail, undefined);
  assert.deepEqual(record, original);
});

test("accepts existing July records and rejects unknown contract versions without transmission", async () => {
  const record = { schema_version: "2026-07-31", source_reason: "test" };
  assert.deepEqual(buildFieldflowWireRecord(record), record);
  globalThis.fetch = async () => { throw Error("must not transmit"); };
  const result = await submitFieldflowAttribution({
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
  }, "ut", { schema_version: "unknown" });
  assert.equal(result.reason, "unsupported_attribution_schema");
  assert.equal(result.attempts, 0);
});

test("fails open for unsupported markets, missing config, and receiver rejection", async () => {
  const unsupported = await submitFieldflowAttribution({}, "general", {});
  assert.equal(unsupported.reason, "unsupported_market");

  const missing = await submitFieldflowAttribution({}, "ut", {});
  assert.equal(missing.reason, "missing_configuration");

  globalThis.fetch = async () => new Response(null, { status: 400 });
  const rejected = await submitFieldflowAttribution({
    FIELDFLOW_ATTRIBUTION_BASE_URL: "https://fieldflow.example.test/ingest",
    FIELDFLOW_ATTRIBUTION_TOKEN_SLC: "slc-secret",
  }, "ut", { schema_version: "2026-09-01" });
  assert.deepEqual(rejected, {
    ok: false,
    attempts: 1,
    status: 400,
    reason: "receiver_rejected",
  });
});
