import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { selectAll } from "css-select";

const contentDirectory = new URL("../content/city-market/", import.meta.url);
export const cityMarketCopy = JSON.parse(readFileSync(new URL("exact-copy-replacements.json", contentDirectory), "utf8"));
export const cityMarketFaq = JSON.parse(readFileSync(new URL("faq-parity-proposal.json", contentDirectory), "utf8"));
const copyByRoute = new Map(cityMarketCopy.pages.map((page) => [page.route, page]));
const faqByRoute = new Map(cityMarketFaq.map((page) => [page.route, page]));
assert.equal(copyByRoute.size, cityMarketCopy.pages.length, "Duplicate copy route");
assert.deepEqual([...copyByRoute.keys()].sort(), [...faqByRoute.keys()].sort());

const normalize = (value) => value.replace(/\s+/g, " ").trim();
const text = (node) => node.type === "text" ? node.data : (node.children || []).map(text).join("");
const documentFor = (html) => parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
const escapeText = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function visibleFaq(document) {
  return selectAll("details.faq-item", document).map((node) => ({
    question: normalize(text(selectAll("summary", node)[0])),
    answer: selectAll("p", node).map((answer) => normalize(text(answer))).join(" "),
  }));
}

export function applyCityMarketCopy(html, route) {
  const page = copyByRoute.get(route);
  if (!page) return html;

  const document = documentFor(html);
  const replacements = [];
  for (const change of page.changes) {
    const matches = selectAll(change.selector, document);
    assert.equal(matches.length, 1, `${change.change_id}: selector must match once`);
    const node = matches[0];
    assert.equal(node.name, change.tag, `${change.change_id}: tag changed`);
    assert.ok(node.children.every((child) => child.type === "text"), `${change.change_id}: target is no longer plain text`);
    assert.equal(normalize(text(node)), change.before, `${change.change_id}: newer copy conflicts with approved before text`);
    const location = node.sourceCodeLocation;
    assert.ok(location?.startTag && location?.endTag, `${change.change_id}: source location missing`);
    const start = location.startTag.endOffset;
    const end = location.endTag.startOffset;
    const original = html.slice(start, end);
    replacements.push({
      start,
      end,
      value: original.match(/^\s*/)[0] + escapeText(change.after) + original.match(/\s*$/)[0],
    });
  }

  const faq = faqByRoute.get(route);
  const blocks = selectAll('script[type="application/ld+json"]', document)
    .map((node) => ({ node, value: JSON.parse(text(node)) }))
    .filter(({ value }) => value["@type"] === "FAQPage");
  assert.equal(blocks.length, 1, `${route}: expected one baseline FAQPage`);
  assert.deepEqual(blocks[0].value, faq.before, `${route}: FAQ source changed`);
  assert.equal(visibleFaq(document).length, faq.visible_faq_count, `${route}: visible FAQ count changed`);
  const location = blocks[0].node.sourceCodeLocation;
  const lineStart = html.lastIndexOf("\n", location.startOffset) + 1;
  const lineEnd = html.indexOf("\n", location.endOffset);
  const standaloneLine = lineEnd !== -1 && !html.slice(lineStart, location.startOffset).trim() && !html.slice(location.endOffset, lineEnd).trim();
  replacements.push(faq.after === null
    ? { start: standaloneLine ? lineStart : location.startOffset, end: standaloneLine ? lineEnd + 1 : location.endOffset, value: "" }
    : { start: location.startTag.endOffset, end: location.endTag.startOffset, value: JSON.stringify(faq.after) });

  // Source-offset splices preserve every unlisted byte, including attributes and formatting.
  replacements.sort((left, right) => right.start - left.start);
  let boundary = html.length;
  let result = html;
  for (const replacement of replacements) {
    assert.ok(replacement.end <= boundary, `${route}: overlapping copy targets`);
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
    boundary = replacement.start;
  }
  const expectedFaq = (faq.after?.mainEntity || []).map((item) => ({ question: item.name, answer: item.acceptedAnswer.text }));
  assert.deepEqual(visibleFaq(documentFor(result)), expectedFaq, `${route}: visible and structured FAQ mismatch`);
  return result;
}
