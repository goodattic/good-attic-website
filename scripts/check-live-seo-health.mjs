#!/usr/bin/env node

import { readFileSync } from "node:fs";

const baseUrl = process.argv[2] || "https://goodattic.energy";
const expectedUrlCount =
  process.argv[3] !== undefined
    ? Number(process.argv[3])
    : sitemapUrls(readFileSync("sitemap.xml", "utf8")).length;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK   ${message}`);
}

function warn(message) {
  console.warn(`WARN ${message}`);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  return { response, text: await response.text() };
}

function extract(pattern, html) {
  return html.match(pattern)?.[1]?.trim() || "";
}

function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

console.log(`Good Attic live SEO health check: ${baseUrl}`);

const sitemapResult = await fetchText(`${baseUrl}/sitemap.xml?seo_health=${Date.now()}`);
if (sitemapResult.response.status !== 200) {
  fail(`sitemap.xml returned ${sitemapResult.response.status}`);
  process.exit();
}

const urls = sitemapUrls(sitemapResult.text);
if (urls.length === expectedUrlCount) ok(`Sitemap includes ${urls.length} URLs`);
else fail(`Sitemap includes ${urls.length} URLs, expected ${expectedUrlCount}`);

const titles = new Map();
const descriptions = new Map();
let badStatusCount = 0;
let badCanonicalCount = 0;
let noindexCount = 0;

for (const url of urls) {
  const { response, text } = await fetchText(`${url}?seo_health=${Date.now()}`, { redirect: "manual" });
  if (response.status !== 200) {
    badStatusCount += 1;
    warn(`${url} returned ${response.status}`);
  }

  const title = extract(/<title>([^<]*)<\/title>/i, text);
  const description = extract(/<meta name="description" content="([^"]*)"/i, text);
  const canonical = extract(/<link rel="canonical" href="([^"]*)"/i, text);

  titles.set(title, (titles.get(title) || 0) + 1);
  descriptions.set(description, (descriptions.get(description) || 0) + 1);

  if (canonical !== url) {
    badCanonicalCount += 1;
    warn(`${url} canonical mismatch: ${canonical || "missing"}`);
  }

  if (/name=["']robots["'][^>]*noindex/i.test(text)) {
    noindexCount += 1;
    warn(`${url} has noindex`);
  }
}

const duplicateTitles = [...titles.entries()].filter(([, count]) => count > 1 && count);
const duplicateDescriptions = [...descriptions.entries()].filter(([, count]) => count > 1 && count);

if (!badStatusCount) ok("All sitemap URLs returned 200");
else fail(`${badStatusCount} sitemap URLs returned non-200 responses`);

if (!badCanonicalCount) ok("All sitemap canonicals match");
else fail(`${badCanonicalCount} canonical mismatches found`);

if (!noindexCount) ok("No sitemap URLs have noindex");
else fail(`${noindexCount} noindex sitemap URLs found`);

if (!duplicateTitles.length) ok("No duplicate title tags across sitemap URLs");
else fail(`${duplicateTitles.length} duplicate title groups found`);

if (!duplicateDescriptions.length) ok("No duplicate meta description groups across sitemap URLs");
else fail(`${duplicateDescriptions.length} duplicate meta description groups found`);

const redirectChecks = [
  ["/salt-lake-city/blown-in-insulation", `${baseUrl}/salt-lake-city-ut/attic-insulation/`],
  ["/contact-salt-lake-city", `${baseUrl}/salt-lake-city-ut/`],
  ["/post/can-you-over-insulate-your-attic", `${baseUrl}/resources/what-r-value-means-for-an-attic/`],
  ["/post/cellulose-vs-fiberglass-insulation", `${baseUrl}/resources/cellulose-vs-fiberglass-attic-insulation/`],
  ["/post/hire-vs-diy-attic-insulation", `${baseUrl}/resources/diy-vs-professional-attic-insulation/`],
  ["/post/does-spray-foam-insulation-reduce-noise", `${baseUrl}/resources/spray-foam-vs-blown-in-attic-insulation/`],
  ["/st-louis/attic-insulation-remove", `${baseUrl}/st-louis-mo/insulation-removal/`]
];

for (const [path, expectedLocation] of redirectChecks) {
  const response = await fetch(`${baseUrl}${path}?seo_health=${Date.now()}`, { redirect: "manual" });
  const location = response.headers.get("location");
  const normalizedLocation = location ? new URL(location, baseUrl).origin + new URL(location, baseUrl).pathname : "";
  if (response.status === 301 && normalizedLocation === expectedLocation) ok(`${path} redirects to ${expectedLocation}`);
  else fail(`${path} returned ${response.status} to ${location || "no location"}`);
}

const randomPath = `/this-should-not-exist-${Date.now()}`;
const randomResponse = await fetch(`${baseUrl}${randomPath}`, { redirect: "manual" });
if (randomResponse.status === 404) ok("Random nonexistent URL returns 404");
else fail(`Random nonexistent URL returned ${randomResponse.status}`);

if (!process.exitCode) {
  console.log("Live SEO health check finished cleanly.");
}
