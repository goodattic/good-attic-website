#!/usr/bin/env node
// One real, isolated website submission. Never reuse a browser profile or ad-click cookie.
import assert from "node:assert/strict";
import { chromium } from "/Users/patrickoloughlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const [stage, market] = process.argv.slice(2);
const markets = {
  ut: { path: "salt-lake-city-ut", city: "Salt Lake City", state: "UT", zip: "84101" },
  mo_stl: { path: "st-louis-mo", city: "St. Louis", state: "MO", zip: "63101" },
  mo_kc: { path: "kansas-city-mo", city: "Kansas City", state: "MO", zip: "64106" },
};
assert.ok(["gate4", "gate5"].includes(stage), "stage must be gate4 or gate5");
assert.ok(markets[market], "market must be ut, mo_stl, or mo_kc");
assert.ok(process.env.GOOD_ATTIC_TEST_EMAIL && process.env.GOOD_ATTIC_TEST_PHONE,
  "Good Attic-owned test contact must be supplied through environment variables");

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const pageErrors = [];
  const siteRequestFailures = [];
  const conversionRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).hostname === "goodattic.energy") {
      siteRequestFailures.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/googleadservices\.com|google-analytics\.com|doubleclick\.net/.test(url.hostname)
      && request.url().includes("7152833432")) {
      const postFields = new URLSearchParams(request.postData() || "");
      conversionRequests.push({
        host: url.hostname,
        path: url.pathname,
        transactionId: url.searchParams.get("oid") || url.searchParams.get("transaction_id")
          || postFields.get("oid") || postFields.get("transaction_id") || "",
      });
    }
  });
  const target = markets[market];
  const pageResponse = await page.goto(`https://goodattic.energy/${target.path}/`, {
    waitUntil: "domcontentloaded", timeout: 30_000,
  });
  assert.equal(pageResponse.status(), 200);
  const adClickCookies = (await context.cookies()).filter(({ name }) =>
    /(?:^|_)(?:gclid|gbraid|wbraid|gcl_aw|gcl_gb|codxkc)(?:$|_)/i.test(name));
  assert.deepEqual(adClickCookies, [], "Fresh test browser must have no ad-click or prior-test cookies");
  const form = page.locator("form[data-lead-form]").first();
  await form.locator('input[name="project_type"][value="Attic Insulation"]').check();
  await form.locator('input[name="first_name"]').fill("TEST - Codex");
  await form.locator('input[name="last_name"]').fill("- delete");
  await form.locator('input[name="phone"]').fill(process.env.GOOD_ATTIC_TEST_PHONE);
  await form.locator('input[name="email"]').fill(process.env.GOOD_ATTIC_TEST_EMAIL);
  await form.locator('input[name="street_address"]').fill("123 Test Street");
  await form.locator('input[name="city"]').fill(target.city);
  await form.locator('select[name="state"]').selectOption(target.state);
  await form.locator('input[name="zip"]').fill(target.zip);

  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/leads" && response.request().method() === "POST",
    { timeout: 75_000 },
  );
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const result = await response.json();
  const requestId = result?.jobber?.request_id || "";
  const submissionId = result?.transaction_id || "";
  // Always print the Request ID, even when an assertion fails, so test cleanup is possible.
  console.log(JSON.stringify({
    stage, market, http: response.status(), ok: result?.ok === true,
    request_id: requestId, account_id: result?.jobber?.account_id || "",
    submission_id: submissionId,
    transaction_confirmed: result?.transaction_confirmed === true,
    fieldflow_ok: result?.fieldflow?.ok === true,
    fieldflow_http: result?.fieldflow?.status || 0,
    fieldflow_reason: result?.fieldflow?.reason || "",
  }));
  assert.equal(response.status(), 200);
  assert.equal(result?.ok, true);
  assert.ok(requestId, "Jobber Request is required");
  assert.equal(result?.jobber?.market_key, market);
  assert.ok(submissionId, "API must return a stable transaction/submission ID");
  assert.equal(result?.transaction_confirmed, true, "D1 transaction must be confirmed");
  assert.equal(result?.fieldflow?.ok, true, "Fieldflow must accept the lead");
  assert.ok([200, 201, 202].includes(result?.fieldflow?.status), "Fieldflow HTTP acceptance is required");
  await page.locator("[data-lead-thank-you-modal]").waitFor({ state: "visible", timeout: 15_000 });
  assert.deepEqual(pageErrors, [], "No browser script errors");
  assert.deepEqual(siteRequestFailures, [], "No failed first-party browser requests");

  if (stage === "gate5") {
    const dataLayerIds = await page.evaluate(() => Array.from(window.dataLayer || [])
      .filter((entry) => entry?.[0] === "event" && entry?.[1] === "conversion")
      .map((entry) => entry?.[2]?.transaction_id || ""));
    assert.ok(dataLayerIds.includes(submissionId), "Browser conversion event must use the D1 ID");
    await page.waitForTimeout(5_000);
    assert.ok(conversionRequests.some((request) => request.transactionId === submissionId),
      "A Google conversion network request must carry the same transaction ID");
    console.log(JSON.stringify({
      stage, market, conversion_network_matched: true,
      conversion_host: conversionRequests.find((request) => request.transactionId === submissionId)?.host || "",
    }));
  }
  await context.close();
} finally {
  await browser.close();
}
