import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestPost, _private as leads } from "../functions/api/leads.js";
import { buildWebsiteAttribution, _private as fieldflow } from "../server/fieldflow-attribution.js";

const SUBMISSION_ID = "604eb2c7-8c17-4196-a67a-6197dd56f8e2";
const NEED = "Insulation removal & replacement";
const PATHS = [
  ["/salt-lake-city-ut/lp/attic-insulation/", "ut"],
  ["/salt-lake-city-ut/lp/insulation-removal/", "ut"],
  ["/st-louis-mo/lp/attic-insulation/", "mo_stl"],
  ["/st-louis-mo/lp/insulation-removal/", "mo_stl"],
  ["/kansas-city-mo/lp/attic-insulation/", "mo_kc"],
  ["/kansas-city-mo/lp/insulation-removal/", "mo_kc"],
];

function shortPayload(overrides = {}) {
  const pagePath = "/kansas-city-mo/lp/insulation-removal/";
  return {
    submission_id: SUBMISSION_ID,
    form_variant: "short_ad_landing",
    page_path: pagePath,
    page_market: "mo_kc",
    page_url: `https://goodattic.energy${pagePath}`,
    name: "Avery Homeowner",
    phone: "816-555-0101",
    zip: "64101",
    project_type: [NEED],
    project_type_label: NEED,
    full_address: "64101", // The shared form script builds this from ZIP alone.
    ...overrides,
  };
}

function requestFor(payload) {
  return new Request("https://goodattic.energy/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(fs.readFileSync(new URL("../migrations/0011_website_lead_intake_failures.sql", import.meta.url), "utf8"));
  raw.exec(fs.readFileSync(new URL("../migrations/0017_website_form_transaction_ids.sql", import.meta.url), "utf8"));
  raw.exec(fs.readFileSync(new URL("../migrations/0018_short_ad_request_notes.sql", import.meta.url), "utf8"));
  return {
    raw,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const result = raw.prepare(sql).run(...args);
              return { meta: { changes: Number(result.changes) } };
            },
            async first() {
              if (sql.includes("jobber_token_authority:select_auth")) {
                return {
                  refresh_status: "ready",
                  access_token: "fixture-access",
                  access_expires_at: Date.now() + 3_600_000,
                };
              }
              return raw.prepare(sql).get(...args) || null;
            },
          };
        },
      };
    },
  };
}

test("only the six ad URLs with the explicit marker use the short-form validation", async () => {
  for (const [pagePath, market] of PATHS) {
    const payload = shortPayload({ page_path: pagePath, page_market: market });
    assert.equal(leads.shortAdMarketFor(payload), market);
    const lead = leads.buildLead(payload, SUBMISSION_ID, null, market);
    assert.deepEqual(leads.validateLead(lead, payload), []);
    assert.equal(lead.market_key, market);
    assert.equal(lead.address, "");
    assert.equal(lead.city, "");
    assert.equal(lead.state, "");
  }

  for (const overrides of [
    { form_variant: "" },
    { page_path: "/kansas-city-mo/insulation-removal/" },
    { page_path: "/kansas-city-mo/lp/insulation-removal/extra/" },
  ]) {
    const payload = shortPayload(overrides);
    assert.equal(leads.shortAdMarketFor(payload), "");
    const response = await onRequestPost({ request: requestFor(payload), env: {} });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.missing.includes("email"));
    assert.ok(body.missing.includes("city"));
    assert.ok(body.missing.includes("state"));
  }
});

test("short-form validation checks raw name, phone, exact ZIP, and approved services before routing", async () => {
  for (const [overrides, field] of [
    [{ name: "   ", first_name: "Injected" }, "name"],
    [{ phone: "   " }, "phone"],
    [{ zip: "64101-1234" }, "zip"],
    [{ zip: "6410" }, "zip"],
    [{ project_type: ["Spray foam"], project_type_label: NEED }, "project_type"],
    [{ project_type: ["Attic Insulation", "Invalid service"] }, "project_type"],
    [{ project_type: [] }, "project_type"],
  ]) {
    const response = await onRequestPost({ request: requestFor(shortPayload(overrides)), env: {} });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).missing.includes(field));
  }
  const payload = shortPayload({
    street_address: "Not a real street",
    city: "Wrong City",
    state: "UT",
    page_market: "ut",
  });
  const market = leads.shortAdMarketFor(payload);
  const lead = leads.buildLead(payload, SUBMISSION_ID, null, market);
  assert.equal(market, "mo_kc");
  assert.equal(lead.market_key, "mo_kc");
  assert.deepEqual([lead.address, lead.city, lead.state], ["", "", ""]);
  assert.equal(lead.service, NEED);
  assert.deepEqual(leads.validateLead(lead, payload), []);
});

test("short forms accept multiple main-form services and preserve them in the lead", () => {
  const services = ["Attic Insulation", "Insulation Removal", "Attic Pest Issues", "Attic Air Sealing", "Attic Fans", "Other"];
  const payload = shortPayload({ project_type: services, project_type_label: "ignored" });
  const lead = leads.buildLead(payload, SUBMISSION_ID, null, "mo_kc");
  assert.deepEqual(leads.validateLead(lead, payload), []);
  assert.equal(lead.service, services.join(", "));
});

test("short lead creates a phone-bearing Jobber client and a Request with the address callback note", async () => {
  const db = database();
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.getjobber.com/api/graphql");
    const { query, variables } = JSON.parse(init.body);
    if (query.includes("GoodAtticClientCreate")) {
      calls.push(["client", variables.input]);
      return Response.json({ data: { clientCreate: {
        client: { id: "client-short", clientProperties: { nodes: [{ id: "property-default" }] } },
        userErrors: [],
      } } });
    }
    if (query.includes("GoodAtticRequestCreate")) {
      calls.push(["request", variables.input]);
      return Response.json({ data: { requestCreate: {
        request: { id: "request-short", property: null }, userErrors: [],
      } } });
    }
    throw new Error("Unexpected Jobber mutation");
  };
  try {
    const response = await onRequestPost({
      request: requestFor(shortPayload()),
      env: { ANGI_ROUTER_DB: db, EXTERNAL_API_WRITES_ENABLED: "false" },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.transaction_id, SUBMISSION_ID);
    assert.equal(result.transaction_confirmed, true);
    assert.equal(db.raw.prepare("SELECT transaction_id FROM website_form_conversions WHERE jobber_request_id = ?")
      .get("request-short").transaction_id, SUBMISSION_ID);
    assert.deepEqual(calls.map(([kind]) => kind), ["client", "request"]);
    assert.equal(calls[0][1].firstName, "Avery");
    assert.equal(calls[0][1].lastName, "Homeowner");
    assert.equal(calls[0][1].phones[0].number, "8165550101");
    assert.equal(Object.hasOwn(calls[0][1], "emails"), false);
    assert.equal(Object.hasOwn(calls[0][1], "properties"), false);
    assert.deepEqual(calls[1][1], {
      clientId: "client-short",
      title: `SHORT AD FORM - get address on the call | ZIP 64101 | ${NEED}`,
      requestDetails: { form: { sections: [{ label: "Service Details", items: [{
        label: "Please provide as much information as you can",
        answerText: `Services: ${NEED}\nZIP: 64101\nShort ad form: get the address on the call.`,
      }] }] } },
    });

    const payload = shortPayload({
      gclid: "Click_123456",
      ad_landing_page: "https://goodattic.energy/kansas-city-mo/lp/insulation-removal/?gclid=Click_123456&utm_source=google&utm_medium=cpc",
    });
    const lead = leads.buildLead(payload, SUBMISSION_ID, {
      key: "google", detail: "google_ads", label: "Google Ads", reason: "gclid",
    }, "mo_kc");
    const wire = fieldflow.buildFieldflowWireRecord(buildWebsiteAttribution(payload, lead, {
      account_id: "account-kc", request_id: "request-short", client_id: "client-short",
    }));
    assert.equal(wire.submission_id, SUBMISSION_ID);
    assert.equal(wire.gclid, "Click_123456");
    assert.equal(wire.source_key, "google");
    for (const field of ["phone", "email", "street_address", "address", "city", "state", "zip", "service", "landing_page", "form_variant"]) {
      assert.equal(Object.hasOwn(wire, field), false, field);
    }
  } finally {
    globalThis.fetch = previousFetch;
    db.raw.close();
  }
});

test("short-form phone rejection does not retry Jobber without its only contact method", async () => {
  const payload = shortPayload();
  const lead = leads.buildLead(payload, SUBMISSION_ID, null, leads.shortAdMarketFor(payload));
  let calls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ data: { clientCreate: {
      client: null,
      userErrors: [{ message: "Invalid phone", path: ["phones"] }],
    } } });
  };
  try {
    await assert.rejects(leads.createJobberClient({}, "fixture-access", lead), /Jobber did not accept/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("standard forms keep their full-address and email requirements and Jobber property", () => {
  const payload = shortPayload({ form_variant: "", full_address: "123 Main St, Kansas City, MO 64101" });
  const lead = leads.buildLead(payload, SUBMISSION_ID);
  assert.deepEqual(leads.validateLead(lead), ["email", "city", "state"]);
  const complete = leads.buildLead({
    name: "Avery Homeowner", phone: "8165550101", email: "avery@example.test",
    street_address: "123 Main St", city: "Kansas City", state: "MO", zip: "64101",
    project_type: "New or added attic insulation",
  }, SUBMISSION_ID);
  assert.deepEqual(leads.validateLead(complete), []);
  assert.equal(leads.buildClientInput(complete).properties[0].address.street1, "123 Main St");
  assert.equal(leads.buildClientInput(complete).emails[0].address, "avery@example.test");
  assert.deepEqual(leads.buildRequestInput(complete, "client-standard", "property-standard"), {
    clientId: "client-standard",
    title: "New or added attic insulation",
    propertyId: "property-standard",
  });
});

test("all six previews use the shipped form handler to create a Jobber request and emit the existing conversion", async () => {
  const vm = await import("node:vm");
  const bundle = fs.readFileSync(new URL("../dist/script.e0b6cf2323b054a8.js", import.meta.url), "utf8");
  const submissionStart = bundle.indexOf("const formSubmissions = new WeakMap();");
  const formStart = bundle.indexOf('document.querySelectorAll("[data-lead-form]").forEach');
  const formEnd = bundle.indexOf('\ninitAddressAutocomplete();', formStart);
  const trackingStart = bundle.indexOf('function trackLeadConversion(');
  const trackingEnd = bundle.indexOf('function trackPhoneClick(', trackingStart);
  const tracking = {
    leadConversionSendTo: bundle.match(/leadConversionSendTo: "([^"]+)"/)[1],
    analyticsMeasurementId: bundle.match(/analyticsMeasurementId: "([^"]+)"/)[1],
  };
  for (const [pagePath, market] of PATHS) {
    const db = database();
    const calls = [];
    const events = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.getjobber.com/api/graphql");
      const { query, variables } = JSON.parse(init.body);
      calls.push(variables.input);
      if (query.includes("GoodAtticClientCreate")) return Response.json({ data: { clientCreate: {
        client: { id: "client-short", clientProperties: { nodes: [] } }, userErrors: [],
      } } });
      if (query.includes("GoodAtticShortAdNote")) return Response.json({ data: { requestCreateNote: { requestNote: { id: "note-short" }, userErrors: [] } } });
      if (query.includes("GoodAtticRequestCreate")) return Response.json({ data: { requestCreate: {
        request: { id: "request-short", property: null }, userErrors: [],
      } } });
      throw new Error("Unexpected external call");
    };
    try {
      const payload = shortPayload({ page_path: pagePath, page_market: market, page_url: `https://goodattic.energy${pagePath}`,
        project_type: ["Attic Insulation", "Attic Air Sealing"], additional_notes: "Fixture only" });
      const entries = Object.entries(payload).flatMap(([key, value]) => Array.isArray(value) ? value.map(v => [key, v]) : [[key, value]]);
      const status = { textContent: "" };
      const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
      const options = payload.project_type.map(value => ({ value, checked: true, addEventListener() {} }));
      let submit;
      const form = { dataset: { leadEndpoint: "/api/leads" }, elements: {}, reset() {},
        querySelectorAll: () => options,
        querySelector: selector => selector === "[data-form-status]" ? status : selector === 'button[type="submit"]' ? button : null,
        addEventListener(type, handler) { if (type === "submit") submit = handler; },
      };
      let backendResult;
      vm.runInNewContext(bundle.slice(trackingStart, trackingEnd) + bundle.slice(submissionStart, formEnd), {
        crypto: (await import("node:crypto")).webcrypto, TextEncoder, Uint8Array, console,
        sessionStorage: { getItem: () => null, setItem() {} }, location: { pathname: pagePath },
        document: { querySelectorAll: () => [form] },
        getAddressInputs: () => [], syncProjectTypeValidity: () => true, syncFullAddressValidity: () => true,
        FormData: class { entries() { return entries[Symbol.iterator](); } getAll(name) { return entries.filter(([key]) => key === name).map(([,value]) => value); } },
        buildFullAddress: () => payload.zip, addAttributionToPayload() {},
        async fetch(endpoint, init) {
          if (endpoint === "/api/leads/conversion-signal") return Response.json({ ok: true });
          assert.equal(endpoint, "/api/leads");
          const response = await onRequestPost({ request: requestFor(JSON.parse(init.body)), env: { ANGI_ROUTER_DB: db, EXTERNAL_API_WRITES_ENABLED: "false" } });
          backendResult = await response.clone().json();
          return response;
        },
        window: { gtag: (...args) => events.push(args) }, googleAdsTracking: tracking,
        ensureGoogleTag() {}, setEnhancedConversionData() {}, updateSourcePageFields() {}, openLeadThankYou() {},
      });
      await submit({ preventDefault() {} });
      assert.equal(backendResult.ok, true, pagePath);
      assert.equal(calls.length, 3, pagePath);
      assert.match(calls[2].message, /Customer notes: Fixture only/);
      assert.equal(backendResult.jobber.customer_note.status, "completed");
      assert.equal(calls[1].clientId, "client-short");
      assert.match(calls[1].title, /Attic Insulation, Attic Air Sealing/);
      const conversions = events.filter(event => event[1] === "conversion");
      assert.equal(conversions.length, 1, pagePath);
      assert.equal(conversions[0][2].transaction_id, backendResult.transaction_id);
      assert.equal(backendResult.transaction_confirmed, true);
      assert.equal(conversions[0][2].send_to, "AW-11103039262/SDRICJin3tIaEJ7eq64p");
      assert.equal(events.filter(event => event[1] === "generate_lead").length, 1);
      assert.match(status.textContent, /has been sent/);
    } finally { globalThis.fetch = previousFetch; db.raw.close(); }
  }
});

test('existing market phone config callback swaps every Call link, before or after landing script loads', async () => {
  const vm = await import('node:vm');
  const landing = fs.readFileSync(new URL('../assets/ad-landing.js', import.meta.url), 'utf8');
  const cases = [
    ['salt-lake-city-ut', 'ut', '+13853364442'],
    ['st-louis-mo', 'mo_stl', '+13149312620'],
    ['kansas-city-mo', 'mo_kc', '+18164340308'],
  ];
  for (const [slug, market, original] of cases) {
    for (const service of ['attic-insulation', 'insulation-removal']) {
      const html = fs.readFileSync(new URL(`../${slug}/lp/${service}/index.html`, import.meta.url), 'utf8');
      const inline = html.match(/<script>\s*window\.dataLayer[\s\S]*?<\/script>/)?.[0]
        .replace(/^<script>/, '').replace(/<\/script>$/, '');
      assert.ok(inline, `${slug}/${service} has a Google phone snippet`);
      const number = {textContent: original.slice(2)};
      const calls = Array.from({length: 3}, () => ({href: `tel:${original}`}));
      const sms = {href: `sms:${original}`};
      const context = {
        document: {
          documentElement: {dataset: {lpMarket: market, lpPhone: original.slice(2)}},
          querySelectorAll: selector => selector === '[data-service-picker]' ? []
            : selector === '[data-lp-call]' ? calls
            : selector === '[data-lp-call-number]' ? [number]
            : selector === '[data-lp-text]' ? [sms] : [],
          querySelector: () => null,
        },
        location: {search: ''}, URLSearchParams, Date,
      };
      context.window = context;
      vm.runInNewContext(inline, context);
      const configs = context.dataLayer.filter(entry => entry[0] === 'config'
        && String(entry[1]).startsWith('AW-11103039262/'));
      assert.equal(configs.length, 3, `${slug}/${service} retains three phone configs once each`);
      assert.deepEqual(Array.from(configs, entry => entry[2].phone_conversion_number),
        ['385-336-4442', '314-931-2620', '816-434-0308']);
      const active = configs.filter(entry => typeof entry[2].phone_conversion_callback === 'function');
      assert.equal(active.length, 1, 'only the page market owns the callback');
      active[0][2].phone_conversion_callback('800-555-0199', '+18005550199');
      assert.equal(context.goodAtticLpPendingCallNumber[0], '800-555-0199');
      vm.runInNewContext(landing, context);
      assert.equal(number.textContent, '800-555-0199');
      assert.ok(calls.every(link => link.href === 'tel:+18005550199'));
      assert.equal(sms.href, `sms:${original}`);
      active[0][2].phone_conversion_callback('888-555-0123', '+18885550123');
      assert.equal(number.textContent, '888-555-0123');
      assert.ok(calls.every(link => link.href === 'tel:+18885550123'));
      assert.equal(sms.href, `sms:${original}`);
      assert.equal(context.dataLayer.filter(entry => entry[0] === 'event' && entry[1] === 'conversion').length, 0);
    }
  }
});

test('uncertain customer-note delivery preserves the note and does not recreate the Request on retry', async () => {
  const db=database(); const original=globalThis.fetch; let requests=0, notes=0;
  globalThis.fetch=async (_url,init)=>{
    const {query}=JSON.parse(init.body);
    if(query.includes('GoodAtticClientCreate')) return Response.json({data:{clientCreate:{client:{id:'client-short',clientProperties:{nodes:[]}},userErrors:[]}}});
    if(query.includes('GoodAtticRequestCreate')) { requests++; return Response.json({data:{requestCreate:{request:{id:'request-short'},userErrors:[]}}}); }
    if(query.includes('GoodAtticShortAdNote')) {notes++; throw Error('Simulated uncertain note delivery');}
    throw Error('Unexpected request');
  };
  try {
    const payload=shortPayload({additional_notes:'Please inspect the garage attic.'});
    const context=()=>({request:requestFor(payload),env:{ANGI_ROUTER_DB:db,EXTERNAL_API_WRITES_ENABLED:'false'}});
    assert.equal((await onRequestPost(context())).status,200);
    assert.equal((await onRequestPost(context())).status,200);
    assert.equal(requests,1); assert.equal(notes,1);
    const stored=db.raw.prepare('SELECT * FROM short_ad_request_notes').get();
    assert.equal(stored.status,'pending'); assert.match(stored.message,/garage attic/);
  } finally {globalThis.fetch=original;db.raw.close();}
});


test("short ad Service Details puts optional notes first and always includes services, ZIP and address reminder", () => {
  for (const [path, market] of PATHS) {
    for (const note of ["Please check the upstairs attic.", ""]) {
      const payload = shortPayload({page_path:path, page_market:market, additional_notes:note,
        project_type:["Attic Insulation", "Attic Air Sealing"], project_type_label:"Attic Insulation, Attic Air Sealing"});
      const lead = leads.buildLead(payload, SUBMISSION_ID, null, market);
      const input = leads.buildRequestInput(lead, "client", null);
      assert.deepEqual(input.requestDetails.form.sections, [{label:"Service Details", items:[{
        label:"Please provide as much information as you can",
        answerText:(note ? note + "\n" : "") + "Services: Attic Insulation, Attic Air Sealing\nZIP: 64101\nShort ad form: get the address on the call."
      }]}]);
      assert.equal(input.title, "SHORT AD FORM - get address on the call | ZIP 64101 | Attic Insulation, Attic Air Sealing");
    }
  }
});
