import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { selectAll } from "css-select";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { applyTownFaq, townFaqFiles } from "../scripts/town-faq.mjs";
import { preTownFaqHtml } from "./asset-delivery-helpers.mjs";

const root = new URL("../", import.meta.url);
const baseline = "e0f69bfc026dc7f8f48876b2ac64913b47b1c25e";
const before = (file) => execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8" });
const current = (file) => readFileSync(new URL(file, root), "utf8");
const text = (node) => node.type === "text" ? node.data : (node.children || []).map(text).join("");
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const document = (html) => parse(html, { treeAdapter: adapter });

const addedCounts = new Map([
  ["salt-lake-city-ut/service-areas/sandy-ut/index.html", 2],
  ["salt-lake-city-ut/service-areas/cottonwood-heights-ut/index.html", 3],
  ["salt-lake-city-ut/service-areas/draper-ut/index.html", 3],
  ["st-louis-mo/service-areas/wildwood-mo/index.html", 3],
  ["st-louis-mo/service-areas/chesterfield-mo/index.html", 3],
  ["kansas-city-mo/service-areas/overland-park-ks/index.html", 2],
  ["kansas-city-mo/service-areas/leawood-ks/index.html", 2],
  ["kansas-city-mo/service-areas/olathe-ks/index.html", 2],
  ["kansas-city-mo/index.html", 5],
]);

function visiblePairs(html) {
  const doc = document(html);
  const lists = selectAll("main .faq-list", doc);
  assert.equal(lists.length, 1, "exactly one visible FAQ list");
  return selectAll("details.faq-item", lists[0]).map((item) => {
    const summaries = selectAll("summary", item);
    const paragraphs = selectAll("p", item);
    assert.equal(summaries.length, 1, "one question per item");
    assert.equal(paragraphs.length, 1, "one answer per item");
    return { question: normalize(text(summaries[0])), answer: normalize(text(paragraphs[0])) };
  });
}

function schemaPairs(html) {
  const schemas = selectAll('script[type="application/ld+json"]', document(html))
    .map((script) => JSON.parse(text(script)))
    .filter((schema) => schema["@type"] === "FAQPage");
  assert.equal(schemas.length, 1, "exactly one FAQPage block");
  return schemas[0].mainEntity.map((entry) => ({ question: entry.name, answer: entry.acceptedAnswer.text }));
}

test("nine town and Kansas City FAQs preserve every other baseline byte and reverse exactly", () => {
  assert.equal(townFaqFiles.length, 9);
  assert.deepEqual(new Set(townFaqFiles), new Set(addedCounts.keys()));
  for (const file of townFaqFiles) {
    const original = before(file), updated = current(file);
    assert.equal(applyTownFaq(original, file), updated, `${file}: exact forward transform`);
    assert.equal(applyTownFaq(updated, file), updated, `${file}: forward idempotence`);
    assert.equal(preTownFaqHtml(updated, file), original, `${file}: exact reversal`);
    assert.equal(preTownFaqHtml(original, file), original, `${file}: reverse idempotence`);

    const firstQuestion = visiblePairs(updated)[0].question;
    assert.throws(
      () => preTownFaqHtml(updated.replace(`"name":"${firstQuestion}"`, `"name":"${firstQuestion} changed"`), file),
      `${file}: altered FAQ schema must fail`,
    );
    assert.throws(
      () => preTownFaqHtml(updated.replace(`<summary>${firstQuestion}</summary>`, `<summary>${firstQuestion} changed</summary>`), file),
      `${file}: altered visible FAQ must fail`,
    );
  }
  assert.equal(applyTownFaq("untouched", "salt-lake-city-ut/index.html"), "untouched");
  assert.equal(preTownFaqHtml("untouched", "salt-lake-city-ut/index.html"), "untouched");
});

test("all nine visible FAQ lists match their FAQPage blocks and retain earlier questions", () => {
  for (const file of townFaqFiles) {
    const updated = current(file);
    const visible = visiblePairs(updated);
    const structured = schemaPairs(updated);
    const prior = file === "kansas-city-mo/index.html" ? [] : visiblePairs(before(file));
    const added = addedCounts.get(file);
    assert.equal(visible.length, prior.length + added, `${file}: FAQ count`);
    assert.deepEqual(visible.slice(added), prior, `${file}: earlier FAQ pairs and order`);
    assert.deepEqual(visible, structured, `${file}: visible and structured FAQ mismatch`);
    assert.equal(new Set(visible.map(({ question }) => question)).size, visible.length, `${file}: duplicate question`);
    if (file === "kansas-city-mo/index.html") {
      assert.equal(selectAll("main section#faq", document(updated)).length, 1, `${file}: FAQ section`);
      assert.ok(updated.indexOf('<section id="faq" class="section">') < updated.indexOf('<section id="contact" class="section contact">'), `${file}: FAQ precedes contact`);
      assert.match(updated, /<h2>Questions Kansas City homeowners ask us\.<\/h2>/);
    } else {
      assert.deepEqual(schemaPairs(before(file)), prior, `${file}: earlier schema and visible FAQ parity`);
    }
  }
});
