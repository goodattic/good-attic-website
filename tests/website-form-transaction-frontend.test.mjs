import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/site-interactions.js", import.meta.url), "utf8");
const submissionStart = source.indexOf("const formSubmissions = new WeakMap();");
const submissionEnd = source.indexOf('document.querySelectorAll("[data-lead-form]").forEach', submissionStart);
const trackingStart = source.indexOf("function trackLeadConversion(");
const trackingEnd = source.indexOf("function trackPhoneClick(", trackingStart);
assert.ok(submissionStart >= 0 && submissionEnd > submissionStart);
assert.ok(trackingStart >= 0 && trackingEnd > trackingStart);

const UUID = "0f40f4de-ef72-4b76-a45e-2028dd594081";
const OTHER_UUID = "9eacefda-b3aa-498b-893a-a9f032460567";

function formData(entries) {
  return { entries: () => entries[Symbol.iterator]() };
}

function submissionRuntime({ storage, uuid = UUID, cryptoApi = { randomUUID: () => typeof uuid === "function" ? uuid() : uuid, subtle: webcrypto.subtle } }) {
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  return vm.runInContext(
    `${source.slice(submissionStart, submissionEnd)}\n({ submissionFor, claimSubmission, rememberSubmission })`,
    vm.createContext({
      WeakMap, JSON, Date, TextEncoder, Uint8Array, Array, crypto: cryptoApi,
      sessionStorage, location: { pathname: "/salt-lake-city-ut/" },
    }),
  );
}

test("one set of submitted answers keeps one UUID across double-submit, retry, and reload", async () => {
  const storage = new Map();
  const ids = [OTHER_UUID, UUID, OTHER_UUID];
  const runtime = submissionRuntime({ storage, uuid: () => ids.shift() });
  const form = { dataset: {} };
  const answers = [["first_name", "Fixture"], ["phone", "8015550101"]];
  const first = formData([...answers, ["source_page", "https://goodattic.energy/?gclid=first"]]);
  const retry = formData([...answers, ["source_page", "https://goodattic.energy/?gclid=changed"]]);
  const [one, concurrent] = await Promise.all([
    runtime.submissionFor(form, first), runtime.submissionFor(form, retry),
  ]);
  assert.strictEqual(one, concurrent);
  assert.equal(one.id, UUID);
  assert.equal(runtime.claimSubmission(one), true);
  assert.equal(runtime.claimSubmission(concurrent), false);
  one.inFlight = false;

  const afterReload = submissionRuntime({ storage, uuid: OTHER_UUID });
  assert.equal((await afterReload.submissionFor({ dataset: {} }, retry)).id, UUID);
  assert.doesNotMatch(JSON.stringify([...storage]), /Fixture|8015550101|gclid/);

  one.completedAt = Date.now();
  runtime.rememberSubmission(one);
  assert.equal((await runtime.submissionFor(form, retry)).id, UUID);
  assert.notEqual((await runtime.submissionFor(form, formData([["first_name", "Other"]]))).id, UUID);
});

test("transaction tracking fails open when browser cryptography is unavailable", async () => {
  const runtime = submissionRuntime({ storage: new Map(), cryptoApi: null });
  const submission = await runtime.submissionFor({ dataset: {} }, formData([["first_name", "Fixture"]]));
  assert.equal(submission.id, null);
  assert.equal(runtime.claimSubmission(submission), true);
});

test("accepted lead sends the confirmed D1-linked transaction ID once, or an unkeyed conversion when tracking is unavailable", () => {
  const events = [];
  const signals = [];
  const warnings = [];
  const runtime = vm.runInContext(
    `${source.slice(trackingStart, trackingEnd)}\n${source.slice(submissionStart, submissionEnd)}\nfinalizeSuccessfulLeadSubmission`,
    vm.createContext({
      WeakMap, JSON, Date,
      window: { gtag: (...args) => events.push(args) },
      googleAdsTracking: { leadConversionSendTo: "AW-test/label", analyticsMeasurementId: "G-test" },
      ensureGoogleTag() {}, setEnhancedConversionData() {},
      fetch: (...args) => { signals.push(args); return Promise.resolve({}); },
      console: { warn: (message) => warnings.push(message) },
    }),
  );

  for (const result of [null, {}, { transaction_id: OTHER_UUID, transaction_confirmed: true },
    { transaction_id: UUID, transaction_confirmed: false }]) {
    const submission = { id: UUID, conversionSent: false, completedAt: null };
    const status = {};
    const before = events.length;
    runtime({ status, submission, payload: { form_name: "Test" }, result });
    assert.match(status.textContent, /^Thanks\./);
    assert.equal(submission.conversionSent, true);
    assert.ok(submission.completedAt);
    const conversion = events.slice(before).find((event) => event[1] === "conversion");
    assert.ok(conversion);
    assert.equal(Object.hasOwn(conversion[2], "transaction_id"), false);
  }
  assert.equal(warnings.length, 4);
  assert.equal(signals.length, 0);

  const submission = { id: UUID, conversionSent: false, completedAt: null };
  const before = events.length;
  runtime({ status: {}, submission, payload: { form_name: "Test" }, result: { transaction_id: UUID, transaction_confirmed: true } });
  runtime({ status: {}, submission, payload: { form_name: "Test" }, result: { transaction_id: UUID, transaction_confirmed: true } });
  const keyed = events.slice(before).filter((event) => event[1] === "conversion");
  assert.equal(keyed.length, 1);
  assert.equal(keyed[0][2].transaction_id, UUID);
  assert.equal(signals.length, 1);
  assert.equal(JSON.parse(signals[0][1].body).transaction_id, UUID);
});

test("failed intake shows the current market or swapped call number without changing phone routing", () => {
  const start = source.indexOf("function showLeadSubmissionError(");
  const end = source.indexOf('document.querySelectorAll("[data-lead-form]")', start);
  assert.ok(start >= 0 && end > start);
  let href = "tel:+13853364442";
  const showError = vm.runInContext(
    `${source.slice(start, end)}\nshowLeadSubmissionError`,
    vm.createContext({
      document: { querySelector: () => href ? { getAttribute: () => href } : null },
    }),
  );
  const status = {};
  showError(status);
  assert.match(status.textContent, /385-336-4442/);
  href = "tel:+18555128842";
  showError(status);
  assert.match(status.textContent, /855-512-8842/);
  href = null;
  showError(status);
  assert.match(status.textContent, /number at the top of this page/);
});
