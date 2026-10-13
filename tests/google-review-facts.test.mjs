import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyGoogleReviewFacts, googleReviewFactsFiles } from "../scripts/google-review-facts.mjs";
import { preGoogleReviewFactsHtml, preMarketFaqHtml, preTownFaqHtml } from "./asset-delivery-helpers.mjs";

const root = new URL("../", import.meta.url);
const base = "5e3ac67b1173d30298b70e8d2c8814bf8beb1abb";
const before = file => execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

test("the 24 Google review fact pages preserve every other baseline byte and reverse exactly", () => {
  assert.equal(googleReviewFactsFiles.length, 24);
  assert.equal(new Set(googleReviewFactsFiles).size, 24);
  for (const file of googleReviewFactsFiles) {
    const original = before(file);
    const current = preMarketFaqHtml(preTownFaqHtml(readFileSync(new URL(file, root), "utf8"), file), file);
    assert.equal(applyGoogleReviewFacts(original, file), current, `${file}: exact forward transform`);
    assert.equal(applyGoogleReviewFacts(current, file), current, `${file}: forward idempotence`);
    assert.equal(preGoogleReviewFactsHtml(current, file), original, `${file}: exact reversal`);
    assert.equal(preGoogleReviewFactsHtml(original, file), original, `${file}: reverse idempotence`);
    const linkText = file === "reviews/index.html" || file === "index.html" ? "See them on Google" : "See all reviews on Google";
    assert.throws(
      () => applyGoogleReviewFacts(current.replace(linkText, "Unexpected review link"), file, { reverse: true }),
      /missing, duplicated, or conflicting/,
      `${file}: conflicting review facts must fail`,
    );
  }
  for (const file of ["kansas-city-mo/index.html", "salt-lake-city-ut/lp/attic-insulation/index.html"]) {
    assert.equal(applyGoogleReviewFacts("untouched", file), "untouched", file);
    assert.equal(preGoogleReviewFactsHtml("untouched", file), "untouched", file);
  }
});
