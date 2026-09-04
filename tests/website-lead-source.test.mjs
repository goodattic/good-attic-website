import assert from "node:assert/strict";
import { test } from "node:test";

import { _private as leads } from "../functions/api/leads.js";

const NOW = Date.parse("2026-07-31T18:00:00.000Z");
const GOOGLE_ADS = {
  key: "google",
  detail: "google_ads",
  label: "Google Ads",
};
const ORGANIC_ONLINE = {
  key: "website",
  detail: "organic_online",
  label: "Organic Online",
};
const AI_REFERRAL = {
  key: "website",
  detail: "ai_referral",
  label: "Organic Online",
};

function fresh(overrides = {}) {
  return {
    attribution_captured_at: new Date(NOW - 60_000).toISOString(),
    ad_landing_page: "https://goodattic.energy/salt-lake-city-ut/",
    ad_referrer: "",
    ...overrides,
  };
}

function assertCanonical(actual, expected, reason, message) {
  assert.deepEqual(
    {
      key: actual.key,
      detail: actual.detail,
      label: actual.label,
      reason: actual.reason,
    },
    { ...expected, reason },
    message,
  );
}

test("classifies every supported Google click marker as canonical Google Ads", () => {
  for (const [field, value] of [
    ["gclid", "AbC_123456-xyz"],
    ["gbraid", "GbR_123456-xyz"],
    ["wbraid", "WbR_123456-xyz"],
    ["gad_source", "1"],
  ]) {
    assertCanonical(
      leads.classifyWebsiteLeadSource(fresh({ [field]: value }), NOW),
      GOOGLE_ADS,
      field,
    );
  }
});

test("classifies every supported Google paid-search UTM medium as Google Ads", () => {
  for (const medium of [
    "cpc",
    "ppc",
    "paidsearch",
    "paid_search",
    "paid-search",
    "paid search",
    "sem",
  ]) {
    assertCanonical(
      leads.classifyWebsiteLeadSource(
        fresh({ utm_source: "Google", utm_medium: medium }),
        NOW,
      ),
      GOOGLE_ADS,
      "google_paid_utm",
    );
  }
});

test("classifies direct, referral, social, email, and organic search as Organic Online", () => {
  const cases = [
    ["direct", fresh(), "non_google_attribution"],
    [
      "referral",
      fresh({ ad_referrer: "https://trusted-partner.example/referral" }),
      "non_google_attribution",
    ],
    [
      "social",
      fresh({ utm_source: "facebook", utm_medium: "social" }),
      "non_google_attribution",
    ],
    [
      "non-Google CPC",
      fresh({ utm_source: "facebook", utm_medium: "cpc" }),
      "non_google_attribution",
    ],
    [
      "email",
      fresh({ utm_source: "newsletter", utm_medium: "email" }),
      "non_google_attribution",
    ],
    [
      "non-Google organic",
      fresh({ utm_source: "bing", utm_medium: "organic" }),
      "non_google_attribution",
    ],
    [
      "Google organic UTM",
      fresh({ utm_source: "google", utm_medium: "organic" }),
      "google_organic_utm",
    ],
    [
      "Google organic referrer",
      fresh({ ad_referrer: "https://www.google.com/search?q=attic+insulation" }),
      "google_referrer",
    ],
  ];

  for (const [name, payload, reason] of cases) {
    assertCanonical(
      leads.classifyWebsiteLeadSource(payload, NOW),
      ORGANIC_ONLINE,
      reason,
      name,
    );
  }

  assert.equal(leads.isGoogleSearchHost("google.com.evil.test"), false);
  assert.equal(leads.isGoogleSearchHost("mail.google.com"), false);
  assertCanonical(
    leads.classifyWebsiteLeadSource(
      fresh({ ad_referrer: "https://google.com.evil.test/search" }),
      NOW,
    ),
    ORGANIC_ONLINE,
    "non_google_attribution",
  );
});

test("classifies missing, stale, future, and malformed paid evidence as Organic Online", () => {
  const cases = [
    ["missing/default attribution", {}],
    ["malformed gclid", fresh({ gclid: "tiny" })],
    ["malformed gad_source", fresh({ gad_source: "not-numeric" })],
    ["stale attribution", {
      gclid: "AbC_123456-xyz",
      attribution_captured_at: new Date(NOW - (91 * 24 * 60 * 60 * 1000)).toISOString(),
    }],
    ["future attribution", {
      gclid: "AbC_123456-xyz",
      attribution_captured_at: new Date(NOW + (10 * 60 * 1000)).toISOString(),
    }],
  ];

  for (const [name, payload] of cases) {
    const expectedReason = leads.hasFreshAttribution(payload, NOW)
      ? "non_google_attribution"
      : "missing_or_stale_attribution";
    assertCanonical(
      leads.classifyWebsiteLeadSource(payload, NOW),
      ORGANIC_ONLINE,
      expectedReason,
      name,
    );
  }
});

test("uses a valid landing-page query as coherent Google paid evidence", () => {
  assertCanonical(
    leads.classifyWebsiteLeadSource(fresh({
      ad_landing_page: "https://goodattic.energy/salt-lake-city-ut/?gclid=Landing_123456",
    }), NOW),
    GOOGLE_ADS,
    "gclid",
  );
});

test("keeps a fresh paid touch attributable after a later organic visit", () => {
  assertCanonical(
    leads.classifyWebsiteLeadSource(fresh({
      ad_referrer: "https://www.google.com/search?q=attic+insulation",
      paid_touch_gclid: "PaidTouch_123456",
      paid_touch_landing_page: "https://goodattic.energy/st-louis-mo/?gclid=PaidTouch_123456",
      paid_touch_captured_at: new Date(NOW - (2 * 24 * 60 * 60 * 1000)).toISOString(),
    }), NOW),
    GOOGLE_ADS,
    "paid_touch_gclid",
  );
});

test("classifies external AI referrers and self-reported AI as Organic Online AI referrals", () => {
  for (const [referrer, reason] of [
    ["https://chatgpt.com/c/attic-help", "ai_referrer_chatgpt"],
    ["https://www.perplexity.ai/search/attic-help", "ai_referrer_perplexity"],
    ["https://gemini.google.com/app/example", "ai_referrer_gemini"],
    ["https://copilot.microsoft.com/chats/example", "ai_referrer_copilot"],
    ["https://claude.ai/new", "ai_referrer_claude"],
  ]) {
    assertCanonical(
      leads.classifyWebsiteLeadSource(fresh({ ad_referrer: referrer }), NOW),
      AI_REFERRAL,
      reason,
    );
  }

  assertCanonical(
    leads.classifyWebsiteLeadSource({
      self_reported_source: "ai_search",
      self_reported_source_detail: "google_ai",
    }, NOW),
    AI_REFERRAL,
    "self_reported_ai_google_ai",
  );
  assertCanonical(
    leads.classifyWebsiteLeadSource(fresh({
      ad_referrer: "https://www.google.com/search?q=attic+insulation",
      self_reported_source: "ai_search",
      self_reported_source_detail: "google_ai",
    }), NOW),
    AI_REFERRAL,
    "self_reported_ai_google_ai",
  );
  assert.equal(leads.aiReferrerEngine("chatgpt.com.evil.test"), "");
});

test("never upgrades an unverified self-reported Google ad to the paid pipeline", () => {
  assertCanonical(
    leads.classifyWebsiteLeadSource({ self_reported_source: "google_ads" }, NOW),
    ORGANIC_ONLINE,
    "self_reported_google_ads_unverified",
  );
});

test("routes verified Google Ads through enabled Google apps and all non-PPC through website apps", () => {
  const googleLead = leads.buildLead({
    name: "Source Test",
    state: "UT",
    page_market: "ut",
  }, "paid-source-test", {
    ...GOOGLE_ADS,
    reason: "gclid",
  });

  const fallback = leads.resolveLeadJobberRoute({}, googleLead);
  assert.equal(fallback.authAccountKey, "utah");
  assert.equal(fallback.sourceKey, "website");
  assert.equal(fallback.attributionFallback, true);

  const enabled = leads.resolveLeadJobberRoute(
    { JOBBER_GOOGLE_ROUTING_MARKETS: "ut,mo_stl" },
    googleLead,
  );
  assert.equal(enabled.authAccountKey, "utah_google");
  assert.equal(enabled.clientIdEnvKey, "JOBBER_CLIENT_ID_GOOGLE");
  assert.equal(enabled.attributionFallback, false);

  for (const source of [
    { ...ORGANIC_ONLINE, reason: "google_referrer" },
    { ...ORGANIC_ONLINE, reason: "missing_or_stale_attribution" },
  ]) {
    const nonPpcLead = leads.buildLead({
      name: "Source Test",
      state: "UT",
      page_market: "ut",
    }, `non-paid-${source.detail}`, source);
    const route = leads.resolveLeadJobberRoute(
      { JOBBER_GOOGLE_ROUTING_MARKETS: "ut,mo_stl" },
      nonPpcLead,
    );
    assert.equal(route.authAccountKey, "utah");
    assert.equal(route.sourceKey, "website");
    assert.equal(route.attributionFallback, false);
  }
});

test("uses canonical server classification in HighLevel and ignores a forged form label", () => {
  const payload = {
    lead_source: "Angi",
    attribution_captured_at: new Date(NOW).toISOString(),
    utm_source: "google",
    utm_medium: "organic",
    utm_campaign: "attic-help",
    ad_referrer: "https://www.google.com/search?q=attic+insulation",
  };
  const source = leads.classifyWebsiteLeadSource(payload, NOW);
  const lead = leads.buildLead({
    ...payload,
    name: "Source Test",
    state: "UT",
    page_market: "ut",
  }, "source-test", source);
  const ghl = leads.buildGhlLead(payload, lead, {
    account: "Salt Lake City",
    client_id: "client",
    request_id: "request",
  });

  assert.equal(ghl.lead_source, "Organic Online");
  assert.equal(ghl.source_key, "website");
  assert.equal(ghl.source_detail, "organic_online");
  assert.equal(ghl.source_reason, "google_referrer");
  assert.equal(ghl.utm_source, "google");
  assert.equal(ghl.utm_medium, "organic");
  assert.equal(ghl.utm_campaign, "attic-help");
  assert.equal(ghl.attribution.utm_campaign, "attic-help");
});

test("keeps canonical Google Ads fields in the HighLevel payload", () => {
  const payload = fresh({
    gbraid: "GbR_123456-xyz",
    lead_source: "Organic Online",
  });
  const source = leads.classifyWebsiteLeadSource(payload, NOW);
  const lead = leads.buildLead({
    ...payload,
    name: "Paid Source Test",
    state: "UT",
    page_market: "ut",
  }, "paid-source-test", source);
  const ghl = leads.buildGhlLead(payload, lead, {
    account: "Salt Lake City",
    client_id: "client",
    request_id: "request",
  });

  assert.equal(ghl.lead_source, "Google Ads");
  assert.equal(ghl.source_key, "google");
  assert.equal(ghl.source_detail, "google_ads");
  assert.equal(ghl.source_reason, "gbraid");
  assert.equal(ghl.gbraid, "GbR_123456-xyz");
  assert.equal(ghl.attribution.gbraid, "GbR_123456-xyz");
});

test("promotes a validated paid touch into HighLevel after a later organic visit", () => {
  const paidCapturedAt = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
  const payload = fresh({
    utm_source: "google",
    utm_medium: "organic",
    utm_campaign: "later-organic-visit",
    ad_landing_page: "https://goodattic.energy/resources/what-r-value-means-for-an-attic/",
    paid_touch_gclid: "Paid_123456-xyz",
    paid_touch_utm_source: "google",
    paid_touch_utm_medium: "cpc",
    paid_touch_utm_campaign: "slc-attic-insulation",
    paid_touch_utm_content: "attic-insulation",
    paid_touch_utm_term: "attic insulation",
    paid_touch_landing_page: "https://goodattic.energy/salt-lake-city-ut/",
    paid_touch_landing_page_path: "/salt-lake-city-ut/",
    paid_touch_captured_at: paidCapturedAt,
  });
  const source = leads.classifyWebsiteLeadSource(payload, NOW);
  const lead = leads.buildLead({
    ...payload,
    name: "Returning Paid Visitor",
    state: "UT",
    page_market: "ut",
  }, "returning-paid-visitor", source);
  const ghl = leads.buildGhlLead(payload, lead, {
    account: "Salt Lake City",
    client_id: "client",
    request_id: "request",
  });

  assert.equal(source.reason, "paid_touch_gclid");
  assert.equal(ghl.gclid, "Paid_123456-xyz");
  assert.equal(ghl.utm_medium, "cpc");
  assert.equal(ghl.utm_campaign, "slc-attic-insulation");
  assert.equal(ghl.utm_content, "attic-insulation");
  assert.equal(ghl.utm_term, "attic insulation");
  assert.equal(ghl.ad_landing_page, "https://goodattic.energy/salt-lake-city-ut/");
  assert.equal(ghl.attribution_captured_at, paidCapturedAt);
  assert.equal(ghl.attribution.paid_touch_gclid, "Paid_123456-xyz");
});

test("keeps normalized self-reported source detail in HighLevel without changing canonical attribution", () => {
  const payload = {
    self_reported_source: "AI Search",
    self_reported_source_detail: "ChatGPT",
    name: "AI Source Test",
    state: "MO",
    page_market: "mo_stl",
  };
  const source = leads.classifyWebsiteLeadSource(payload, NOW);
  const lead = leads.buildLead(payload, "ai-source-test", source);
  const ghl = leads.buildGhlLead(payload, lead, {
    account: "St. Louis",
    client_id: "client",
    request_id: "request",
  });

  assert.equal(ghl.lead_source, "Organic Online");
  assert.equal(ghl.source_detail, "ai_referral");
  assert.equal(ghl.self_reported_source, "ai_search");
  assert.equal(ghl.self_reported_source_detail, "chatgpt");
  assert.equal(ghl.attribution.self_reported_source, "ai_search");
  assert.equal(ghl.attribution.self_reported_source_detail, "chatgpt");
});
