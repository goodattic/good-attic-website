import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { applyHubHotspotCopy, hubHotspotCopy } from "../scripts/load-hub-hotspot-copy.mjs";

const root = new URL("../", import.meta.url);
const approved = "f982edd88b52931ef29be4b1f89958ad22f48e9b";
const git = (ref, file) => execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const routes = ["/salt-lake-city-ut/", "/st-louis-mo/", "/kansas-city-mo/"];

test("the approved hotspot manifest retains exactly 18 entries and its immutable hash", () => {
  const bytes = readFileSync(new URL("content/hub-hotspots/exact-replacements.json", root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "7db4bdaf0a8d8294d6b21d402b1d16681f0f94588b9eb3da38dc001b864dca24");
  assert.equal(hubHotspotCopy.entries.length, 18);
  assert.equal(hubHotspotCopy.entries.reduce((n, e) => n + e.after_paragraphs.length, 0), 36);
});

for (const route of routes) {
  test(`${route} exact 18-node-pair transform matches approved HTML and is idempotent`, () => {
    const file = route.slice(1) + "index.html";
    const before = git(hubHotspotCopy.base_commit, file);
    const after = git(approved, file);
    assert.equal(applyHubHotspotCopy(before, route), after);
    assert.equal(applyHubHotspotCopy(after, route), after);
    assert.equal(applyHubHotspotCopy(applyHubHotspotCopy(before, route), route), after);
    for (const entry of hubHotspotCopy.entries.filter(e => e.route === route)) {
      assert.ok(after.includes(entry.after_inner_html));
      assert.throws(() => applyHubHotspotCopy(after.replace(entry.after_inner_html, "Unexpected homeowner copy"), route), /AssertionError/);
      assert.throws(() => applyHubHotspotCopy(after.replace(entry.after_inner_html, entry.after_inner_html.replace("<br><br>", "<br>")), route), /AssertionError/);
    }
  });
}

test("hotspot transform is a byte-preserving no-op on city, resource, service and home routes", () => {
  for (const route of ["/", "/services/insulation-removal/", "/resources/blown-insulation-vs-rolled-insulation/", "/salt-lake-city-ut/service-areas/draper-ut/", "/st-louis-mo/service-areas/chesterfield-mo/", "/kansas-city-mo/service-areas/overland-park-ks/"]) {
    assert.equal(applyHubHotspotCopy("unrelated bytes\n", route), "unrelated bytes\n");
  }
});
