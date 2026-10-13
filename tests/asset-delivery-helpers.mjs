import { readFileSync } from "node:fs";
import { assetDelivery } from "../scripts/asset-delivery.mjs";
import { applyGoogleReviewFacts } from "../scripts/google-review-facts.mjs";
import { applyLocalBusinessFacts } from "../scripts/local-business-facts.mjs";
import { applyMarketFaq } from "../scripts/market-faq.mjs";
import { applyTownFaq } from "../scripts/town-faq.mjs";
import { synchronizationFiles } from "./live-backend-parity.mjs";

export function preTownFaqHtml(html, file) {
  return applyTownFaq(html, file, { reverse: true });
}

export function preMarketFaqHtml(html, file) {
  return applyMarketFaq(html, file, { reverse: true });
}

export function preGoogleReviewFactsHtml(html, file) {
  return applyGoogleReviewFacts(html, file, { reverse: true });
}

export function preLocalBusinessFactsHtml(html, file) {
  if (file !== "salt-lake-city-ut/index.html" && file !== "st-louis-mo/index.html") return html;
  return applyLocalBusinessFacts(html, `/${file.slice(0, -"index.html".length)}`, { reverse: true });
}

// Historical copy/layout tests compare content before the separately tested URL migration.
export function preAssetMigrationHtml(html, file) {
  if (!assetDelivery.htmlReferenceChangesOnly.includes(file)) return html;
  for (const key of ["css", "js"]) {
    html = html.replace(assetDelivery[key].to, assetDelivery.referenceExceptions[file]?.[key] || assetDelivery[key].from);
  }
  return html;
}

export function readApprovedContent(file, root = new URL("../", import.meta.url)) {
  // Historical layout/copy tests use the retained pre-focus JS; modal tests verify the new asset.
  const asset = file === "styles.css" ? assetDelivery.css.to : file === "script.js" ? assetDelivery.modalFocus.previousAsset : file;
  let html = readFileSync(new URL(asset, root), "utf8");
  html = preTownFaqHtml(html, file);
  html = preMarketFaqHtml(html, file);
  html = preGoogleReviewFactsHtml(html, file);
  html = preLocalBusinessFactsHtml(html, file);
  return preAssetMigrationHtml(html, file);
}

export const assetMigrationFiles = [
  ...synchronizationFiles,
  ...assetDelivery.htmlReferenceChangesOnly, "styles.css", "script.js", "_headers",
  "build-seo-wave1.mjs", "scripts/build-pages-output.mjs",
  "tests/city-market-exact-copy.test.mjs", "tests/four-guide-ai-authority-cluster.test.mjs",
  "tests/hub-hotspot-layout.test.mjs", "tests/mobile-header.test.mjs",
  "tests/pages-deployment-hardening.test.mjs", "tests/pest-guide-exact-copy.test.mjs",
];
