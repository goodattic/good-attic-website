import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { selectAll } from "css-select";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { applyMarketFaq, marketFaqFiles } from "../scripts/market-faq.mjs";
import { preMarketFaqHtml } from "./asset-delivery-helpers.mjs";

const root = new URL("../", import.meta.url);
const baseline = "45f0f413c8f5190525620650780da67fbf904189";
const before = (file) => execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8" });
const current = (file) => readFileSync(new URL(file, root), "utf8");
const nodeText = (node) => node.type === "text" ? node.data : (node.children || []).map(nodeText).join("");
const normalize = (value) => value.replace(/\s+/g, " ").trim();

test("the two market FAQs preserve every other hub byte and reverse exactly", () => {
  assert.deepEqual(marketFaqFiles, ["salt-lake-city-ut/index.html", "st-louis-mo/index.html"]);
  for (const file of marketFaqFiles) {
    const original = before(file), updated = current(file);
    assert.equal(applyMarketFaq(original, file), updated, `${file}: exact forward transform`);
    assert.equal(applyMarketFaq(updated, file), updated, `${file}: forward idempotence`);
    assert.equal(preMarketFaqHtml(updated, file), original, `${file}: exact reversal`);
    assert.equal(preMarketFaqHtml(original, file), original, `${file}: reverse idempotence`);
    assert.throws(
      () => preMarketFaqHtml(updated.replace("Every attic is a little different", "Every attic differs"), file),
      /altered FAQ schema/,
      `${file}: altered schema must fail`,
    );
    assert.throws(
      () => preMarketFaqHtml(updated.replace("<p class=\"eyebrow\">FAQ</p>", "<p class=\"eyebrow\">Questions</p>"), file),
      /altered visible FAQ/,
      `${file}: altered visible section must fail`,
    );
  }
  assert.equal(applyMarketFaq("untouched", "kansas-city-mo/index.html"), "untouched");
  assert.equal(preMarketFaqHtml("untouched", "kansas-city-mo/index.html"), "untouched");
});

test("visible FAQ questions and answers match the single FAQPage block in order", () => {
  for (const file of marketFaqFiles) {
    const html = current(file);
    const document = parse(html, { treeAdapter: adapter });
    const sections = selectAll("main section#faq", document);
    assert.equal(sections.length, 1, file);
    const visible = selectAll("details.faq-item", sections[0]).map((details) => {
      const summaries = selectAll("summary", details);
      const paragraphs = selectAll("p", details);
      assert.equal(summaries.length, 1, `${file}: summary count`);
      assert.equal(paragraphs.length, 1, `${file}: answer count`);
      return { question: normalize(nodeText(summaries[0])), answer: normalize(nodeText(paragraphs[0])) };
    });
    const schemas = selectAll('script[type="application/ld+json"]', document)
      .map((script) => JSON.parse(nodeText(script)))
      .filter((schema) => schema["@type"] === "FAQPage");
    assert.equal(schemas.length, 1, `${file}: FAQPage count`);
    const structured = schemas[0].mainEntity.map((entry) => ({ question: entry.name, answer: entry.acceptedAnswer.text }));
    const expectedCount = file.startsWith("salt-lake-city") ? 10 : 9;
    assert.equal(visible.length, expectedCount, file);
    assert.equal(new Set(visible.map((entry) => entry.question)).size, expectedCount, `${file}: duplicate question`);
    assert.deepEqual(visible, structured, `${file}: visible and structured FAQ mismatch`);
    assert.ok(html.indexOf('<section id="faq" class="section">') < html.indexOf('<section id="contact" class="section contact">'), file);
  }
});
