import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { selectAll } from "css-select";
import { applyCityMarketCopy, cityMarketCopy, cityMarketFaq } from "../scripts/load-city-market-copy.mjs";
import { applyHubHotspotCopy } from "../scripts/load-hub-hotspot-copy.mjs";
import { applyHubHotspotLayout } from "../scripts/hub-hotspot-layout.mjs";
import { approvedOperationalHashes } from "./approved-operational-hashes.mjs";

const root = new URL("../", import.meta.url);
const base = cityMarketCopy.base_commit;
const read = (file) => readFile(new URL(file, root), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const text = (node) => node.type === "text" ? node.data : (node.children || []).map(text).join("");
const dom = (html) => parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
const faqBlocks = (document) => selectAll('script[type="application/ld+json"]', document)
  .map((node) => ({ node, value: JSON.parse(text(node)) }))
  .filter(({ value }) => value["@type"] === "FAQPage");
const visibleFaq = (document) => selectAll("details.faq-item", document).map((node) => ({
  question: normalize(text(selectAll("summary", node)[0])),
  answer: selectAll("p", node).map((answer) => normalize(text(answer))).join(" "),
}));
const pages = await Promise.all(cityMarketCopy.pages.map(async (page) => {
  const before = git("show", `${base}:${page.source_file}`);
  const after = await read(page.source_file);
  return { ...page, before, after, beforeDom: dom(before), afterDom: dom(after) };
}));

function maskApprovedNodes(html, document, changes) {
  const patches = changes.map((change) => {
    const nodes = selectAll(change.selector, document);
    assert.equal(nodes.length, 1, change.change_id);
    const location = nodes[0].sourceCodeLocation;
    return { start: location.startTag.endOffset, end: location.endTag.startOffset, value: `COPY:${change.change_id}` };
  });
  for (const block of faqBlocks(document)) {
    const { startOffset, endOffset } = block.node.sourceCodeLocation;
    const lineStart = html.lastIndexOf("\n", startOffset) + 1;
    const lineEnd = html.indexOf("\n", endOffset);
    const standaloneLine = lineEnd !== -1 && !html.slice(lineStart, startOffset).trim() && !html.slice(endOffset, lineEnd).trim();
    patches.push({ start: standaloneLine ? lineStart : startOffset, end: standaloneLine ? lineEnd + 1 : endOffset, value: "" });
  }
  let result = html;
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, patch.start) + patch.value + result.slice(patch.end);
  }
  return result;
}

test("city-market authoritative manifests remain byte-exact with 4674 targets on 33 routes", async () => {
  assert.equal(sha(await read("content/city-market/exact-copy-replacements.json")), "0f67b78d319ff90b37f8eec64cd3b22f3893ee9cdf5e879a88984de6e59b1b35");
  assert.equal(sha(await read("content/city-market/faq-parity-proposal.json")), "f406d8e139d05be9b21ece2cd61c7f3f3c8441e87a377d53aef893322b02fd20");
  assert.equal(pages.length, 33);
  assert.equal(pages.reduce((total, page) => total + page.changes.length, 0), 4674);
  assert.equal(pages.filter((page) => page.route.includes("/service-areas/")).length, 30);
  for (const page of pages) assert.equal(sha(page.before), page.baseline_html_sha256, page.route);
});

test("all exact after strings occupy their approved plain-text selectors", () => {
  for (const page of pages) {
    for (const change of page.changes) {
      const previous = selectAll(change.selector, page.beforeDom);
      const current = selectAll(change.selector, page.afterDom);
      assert.equal(previous.length, 1, change.change_id);
      assert.equal(current.length, 1, change.change_id);
      assert.equal(normalize(text(previous[0])), change.before, change.change_id);
      assert.equal(normalize(text(current[0])), change.after, change.change_id);
      assert.equal(current[0].name, change.tag);
      assert.deepEqual(current[0].attribs, previous[0].attribs, change.change_id);
      assert.ok(current[0].children.every((node) => node.type === "text"));
    }
  }
});

test("every byte outside the supplied copy nodes and FAQ blocks is unchanged", () => {
  for (const page of pages) {
    const before = applyHubHotspotLayout(applyHubHotspotCopy(page.before, page.route), page.route);
    assert.equal(maskApprovedNodes(page.after, page.afterDom, page.changes), maskApprovedNodes(before, dom(before), page.changes), page.route);
  }
});

test("FAQ correction removes only 99 unmatched pairs and synchronizes all 90 visible pairs", () => {
  let beforeCount = 0;
  let afterCount = 0;
  let visibleEdits = 0;
  for (const page of pages) {
    const plan = cityMarketFaq.find((record) => record.route === page.route);
    const before = faqBlocks(page.beforeDom);
    const after = faqBlocks(page.afterDom);
    assert.equal(before.length, 1);
    assert.deepEqual(before[0].value, plan.before);
    assert.deepEqual(after.map((block) => block.value), plan.after ? [plan.after] : []);
    assert.equal(visibleFaq(page.beforeDom).length, visibleFaq(page.afterDom).length);
    assert.deepEqual(visibleFaq(page.afterDom), (plan.after?.mainEntity || []).map((item) => ({ question: item.name, answer: item.acceptedAnswer.text })));
    beforeCount += plan.before.mainEntity.length;
    afterCount += visibleFaq(page.afterDom).length;
    visibleEdits += page.changes.filter((change) => change.faq_sync_required).length;
  }
  assert.equal(beforeCount, 189);
  assert.equal(afterCount, 90);
  assert.equal(beforeCount - afterCount, 99);
  assert.equal(visibleEdits, 8);
});

test("headers, footers, forms, scripts, reviews, images, captions, metadata and href order stay frozen", () => {
  const protectedSelectors = ["header", "footer", "form", "[data-modal]", "[data-review-card]", "img", "figcaption", "h1", "title", 'meta[name="description"]', 'link[rel="canonical"]'];
  const blocks = (source, document, selector) => selectAll(selector, document).map((node) => source.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset));
  for (const page of pages) {
    for (const selector of protectedSelectors) assert.deepEqual(blocks(page.after, page.afterDom, selector), blocks(page.before, page.beforeDom, selector), `${page.route} ${selector}`);
    const hrefs = (document) => selectAll("[href]", document).map((node) => node.attribs.href);
    assert.deepEqual(hrefs(page.afterDom), hrefs(page.beforeDom), page.route);
    const scripts = (source, document) => selectAll("script", document).filter((node) => node.attribs.type !== "application/ld+json").map((node) => source.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset));
    assert.deepEqual(scripts(page.after, page.afterDom), scripts(page.before, page.beforeDom));
    const unrelatedSchema = (document) => selectAll('script[type="application/ld+json"]', document).map((node) => text(node)).filter((value) => JSON.parse(value)["@type"] !== "FAQPage");
    assert.deepEqual(unrelatedSchema(page.afterDom), unrelatedSchema(page.beforeDom));
  }
});

test("unrelated tracked files, Resources, sitemap and operational sources retain the approved parent", async () => {
  const allowed = new Set([...pages.map((page) => page.source_file), "build-seo-wave1.mjs", "package.json", "tests/pest-guide-exact-copy.test.mjs", "tests/four-guide-ai-authority-cluster.test.mjs", ...Object.keys(approvedOperationalHashes)]);
  const existing = new Set(git("ls-tree", "-r", "--name-only", base).trim().split("\n"));
  const changes = git("diff", "--name-only", base, "--").trim().split("\n").filter(Boolean);
  assert.deepEqual(changes.filter((file) => existing.has(file) && !allowed.has(file)), []);
  for (const file of ["resources/index.html", "styles.css", "script.js", "sitemap.xml", "robots.txt"]) assert.equal(await read(file), git("show", `${base}:${file}`), file);
  for (const [file, expected] of Object.entries(approvedOperationalHashes)) assert.equal(sha(await read(file)), expected, file);
  const hashTest = "tests/four-guide-ai-authority-cluster.test.mjs";
  const expectedHashTest = git("show", `${base}:${hashTest}`)
    .replace("25b191ad3e9d7252ed517da0f4641a32c093345b28f665954e9e6a7bc40be4d6", approvedOperationalHashes["functions/api/leads.js"])
    .replace("b537f7f91198856f252cb91b1262b27f8d5ba8ee40c7777d94a55c3e9f46c13a", approvedOperationalHashes["server/fieldflow-attribution.js"]);
  assert.equal(await read(hashTest), expectedHashTest, "only the two justified operational hash expectations may change");
  for (const file of [...existing].filter((file) => file.startsWith("resources/") && file.endsWith(".html"))) assert.equal(await read(file), git("show", `${base}:${file}`), file);
});

test("the source transform preserves other routes and rejects a newer conflicting target", () => {
  assert.equal(applyCityMarketCopy("unchanged resource", "/resources/blown-insulation-vs-rolled-insulation/"), "unchanged resource");
  const page = pages[0];
  const node = selectAll(page.changes[0].selector, page.beforeDom)[0];
  const location = node.sourceCodeLocation;
  const conflict = page.before.slice(0, location.startTag.endOffset) + "Newer intentional copy" + page.before.slice(location.endTag.startOffset);
  assert.throws(() => applyCityMarketCopy(conflict, page.route), /newer copy conflicts/);
  assert.equal(applyHubHotspotLayout(applyHubHotspotCopy(applyCityMarketCopy(page.before, page.route), page.route), page.route), page.after);
});

test("only the scoped generator reads private manifests and published output excludes them", async () => {
  const builder = await read("scripts/build-pages-output.mjs");
  assert.ok(!builder.includes('"content",'));
  for (const page of pages) assert.doesNotMatch(page.after, /CODEX-PREVIEW-IMPLEMENTATION-PROMPT|exact-copy-replacements\.json|faq-parity-proposal\.json|REVIEW_ONLY_NOT_DEPLOYED|change_id|rule_id/);
});
