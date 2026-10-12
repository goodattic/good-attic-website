import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { applyHubHotspotLayout, hubHotspotStyle } from "../scripts/hub-hotspot-layout.mjs";
import { applyLocalBusinessFacts } from "../scripts/local-business-facts.mjs";
import { readApprovedContent, preGoogleReviewFactsHtml, preLocalBusinessFactsHtml } from "./asset-delivery-helpers.mjs";

const root = new URL("../", import.meta.url);
const parent = "f982edd88b52931ef29be4b1f89958ad22f48e9b";
const localBusinessBase = "c77009f516864c56ba21dc4b0d24f40b9de32a35";
const before = file => execFileSync("git", ["show", `${parent}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

test("only the three hubs acquire the exact page-local positioning style, with every other byte preserved", () => {
  for (const route of ["/salt-lake-city-ut/", "/st-louis-mo/", "/kansas-city-mo/"]) {
    const file = route.slice(1) + "index.html", original = before(file), current = readApprovedContent(file);
    assert.equal(current, original.replace("</head>", `${hubHotspotStyle}\n</head>`));
    assert.equal(applyHubHotspotLayout(current, route), current);
    assert.equal(applyHubHotspotLayout(original, route), current);
    assert.throws(() => applyHubHotspotLayout(current.replace("100cqw", "99cqw"), route), /Conflicting/);
  }
});

test("positioning retains global CSS, browser JavaScript, text sizes and diagram locations", () => {
  for (const file of ["styles.css", "script.js"]) assert.equal(readApprovedContent(file), before(file));
  assert.doesNotMatch(hubHotspotStyle, /font-size|overflow|text-overflow|line-clamp|display:\s*none|!important/);
  assert.equal((hubHotspotStyle.match(/@media/g) || []).length, 2);
  for (const route of ["/", "/resources/", "/resources/blown-insulation-vs-rolled-insulation/", "/salt-lake-city-ut/service-areas/draper-ut/"]) assert.equal(applyHubHotspotLayout("unchanged", route), "unchanged");
});

test("two hub office and hours additions preserve every other baseline byte and reverse exactly", () => {
  for (const route of ["/salt-lake-city-ut/", "/st-louis-mo/"]) {
    const file = route.slice(1) + "index.html";
    const original = execFileSync("git", ["show", `${localBusinessBase}:${file}`], { cwd: root, encoding: "utf8" });
    const current = preGoogleReviewFactsHtml(readFileSync(new URL(file, root), "utf8"), file);
    assert.equal(applyLocalBusinessFacts(original, route), current, route);
    assert.equal(applyLocalBusinessFacts(current, route), current, `${route} forward idempotence`);
    assert.equal(preLocalBusinessFactsHtml(current, file), original, `${route} exact reversal`);
    assert.equal(preLocalBusinessFactsHtml(original, file), original, `${route} reverse idempotence`);
    assert.throws(() => applyLocalBusinessFacts(current.replace('"opens":"00:00"', '"opens":"01:00"'), route, { reverse: true }), /expected one exact match/);
    assert.throws(() => applyLocalBusinessFacts(current.replace("We are open 24 hours a day, 7 days a week.", "Hours changed."), route, { reverse: true }), /expected one exact match/);
  }
  assert.equal(applyLocalBusinessFacts("unchanged", "/kansas-city-mo/"), "unchanged");
  assert.equal(preLocalBusinessFactsHtml("unchanged", "kansas-city-mo/index.html"), "unchanged");
});
