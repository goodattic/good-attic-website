import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { selectAll } from "css-select";

export const hubHotspotCopy = JSON.parse(readFileSync(new URL("../content/hub-hotspots/exact-replacements.json", import.meta.url), "utf8"));
const routes = ["/salt-lake-city-ut/", "/st-louis-mo/", "/kansas-city-mo/"];
const byRoute = new Map(routes.map((route) => [route, hubHotspotCopy.entries.filter((entry) => entry.route === route)]));
assert.equal(hubHotspotCopy.entries.length, 18);
assert.ok(hubHotspotCopy.entries.every((entry) => byRoute.has(entry.route)));
for (const entries of byRoute.values()) {
  assert.equal(entries.length, 6);
  assert.equal(new Set(entries.map((entry) => entry.selector)).size, 6);
}
const text = (node) => node.type === "text" ? node.data : (node.children || []).map(text).join("");

export function applyHubHotspotCopy(html, route) {
  const entries = byRoute.get(route);
  if (!entries) return html;
  const document = parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
  const patches = [];
  for (const entry of entries) {
    const nodes = selectAll(entry.selector, document);
    assert.equal(nodes.length, 1, `${route} ${entry.selector}: expected one hotspot`);
    const node = nodes[0];
    assert.equal(node.name, "small");
    assert.deepEqual(node.children.map((child) => child.type === "text" ? "text" : child.name), ["text", "br", "br", "text"]);
    assert.equal(text(selectAll("strong", node.parent)[0]), entry.unchanged_panel_title);
    const { startTag, endTag } = node.sourceCodeLocation;
    const current = html.slice(startTag.endOffset, endTag.startOffset);
    assert.ok(current === entry.before_inner_html || current === entry.after_inner_html, `${route} ${entry.selector}: conflicting hotspot copy`);
    if (current === entry.after_inner_html) continue;
    patches.push({ start: startTag.endOffset, end: endTag.startOffset, value: entry.after_inner_html });
  }
  // Replace only the approved bodies; preserve every surrounding byte.
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, patch.start) + patch.value + html.slice(patch.end);
  }
  return html;
}
