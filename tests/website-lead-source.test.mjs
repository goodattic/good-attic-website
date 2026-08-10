import assert from "node:assert/strict";
import { test } from "node:test";

import { _private as leads } from "../functions/api/leads.js";

const NOW = Date.parse("2026-07-31T18:00:00.000Z");

function fresh(overrides = {}) {
  return {
    attribution_captured_at: new Date(NOW - 60_000).toISOString(),
    ad_landing_page: "https://goodattic.energy/salt-lake-city-ut/",
    ad_referrer: "",
    ...overrides,
  };
}

test("classifies supported Google click identifiers as Google Ads", () => {
  for (const field of ["gclid", "gbraid", "wbraid"]) {
    const source = leads.classifyWebsiteLeadSource(
      fresh({ [field]: "AbC_123456-xyz" }),
      NOW,
    );
    assert.equal(source.detail, "google_ads");
    assert.equal(source.reason, field);
  }

  assert.equal(
    leads.classifyWebsiteLeadSource(fresh({ gad_source: "1" }), NOW).detail,
    "google_ads",
  );
});

test("classifies only Google paid-search UTMs as Google Ads", () => {
  for (const medium of ["cpc", "ppc", "paid_search", "paid-search", "paid search", "sem"]) {
    assert.equal(
      leads.classifyWebsiteLeadSource(
        fresh({ utm_source: "Google", utm_medium: medium }),
        NOW,
      ).detail,
      "google_ads",
    );
  }

  assert.equal(
    leads.classifyWebsiteLeadSource(
      fresh({ utm_source: "facebook", utm_medium: "cpc" }),
      NOW,
    ).detail,
    "website_other",
  );
});

test("classifies Google organic UTMs and safe Google referrers", () => {
  assert.equal(
    leads.classifyWebsiteLeadSource(
      fresh({ utm_source: "google", utm_medium: "organic" }),
      NOW,
    ).detail,
    "google_organic",
  );
  assert.equal(
    leads.classifyWebsiteLeadSource(
      fresh({ ad_referrer: "https://www.google.com/search?q=attic+insulation" }),
      NOW,
    ).detail,
    "google_organic",
  );
  assert.equal(leads.isGoogleSearchHost("google.com.evil.test"), false);
  assert.equal(leads.isGoogleSearchHost("mail.google.com"), false);
  assert.equal(
    leads.classifyWebsiteLeadSource(
      fresh({ ad_referrer: "https://google.com.evil.test/search" }),
      NOW,
    ).detail,
    "website_other",
  );
});

test("rejects malformed, expired, and future Google attribution", () => {
  assert.equal(
    leads.classifyWebsiteLeadSource(fresh({ gclid: "tiny" }), NOW).detail,
    "website_other",
  );
  assert.equal(
    leads.classifyWebsiteLeadSource(fresh({ gad_source: "not-numeric" }), NOW).detail,
    "website_other",
  );
  assert.equal(
    leads.classifyWebsiteLeadSource({
      gclid: "AbC_123456-xyz",
      attribution_captured_at: new Date(NOW - (91 * 24 * 60 * 60 * 1000)).toISOString(),
    }, NOW).detail,
    "website_other",
  );
  assert.equal(
    leads.classifyWebsiteLeadSource({
      gclid: "AbC_123456-xyz",
      attribution_captured_at: new Date(NOW + (10 * 60 * 1000)).toISOString(),
    }, NOW).detail,
    "website_other",
  );
});

test("uses the landing-page query as a coherent Google attribution signal", () => {
  const source = leads.classifyWebsiteLeadSource(fresh({
    ad_landing_page: "https://goodattic.energy/salt-lake-city-ut/?gclid=Landing_123456",
  }), NOW);
  assert.equal(source.detail, "google_ads");
  assert.equal(source.reason, "gclid");
});

test("routes Google leads only through explicitly enabled source connections", () => {
  const googleLead = leads.buildLead({
    name: "Source Test",
    state: "UT",
    page_market: "ut",
  }, "source-test", {
    key: "google",
    detail: "google_ads",
    label: "Google Ads",
    reason: "gclid",
  });

  const fallback = leads.resolveLeadJobberRoute({}, googleLead);
  assert.equal(fallback.authAccountKey, "utah");
  assert.equal(fallback.attributionFallback, true);

  const enabled = leads.resolveLeadJobberRoute(
    { JOBBER_GOOGLE_ROUTING_MARKETS: "ut,mo_stl" },
    googleLead,
  );
  assert.equal(enabled.authAccountKey, "utah_google");
  assert.equal(enabled.clientIdEnvKey, "JOBBER_CLIENT_ID_GOOGLE");
  assert.equal(enabled.attributionFallback, false);
});

test("uses the server-classified source in HighLevel and ignores a forged form label", () => {
  const lead = leads.buildLead({
    name: "Source Test",
    state: "UT",
    page_market: "ut",
  }, "source-test", {
    key: "google",
    detail: "google_organic",
    label: "Google Organic",
    reason: "google_referrer",
  });
  const payload = {
    lead_source: "Angi",
    attribution_captured_at: new Date(NOW).toISOString(),
  };
  const ghl = leads.buildGhlLead(payload, lead, {
    account: "Salt Lake City",
    client_id: "client",
    request_id: "request",
  });

  assert.equal(ghl.lead_source, "Google Organic");
  assert.equal(ghl.source_key, "google");
  assert.equal(ghl.source_detail, "google_organic");
});
