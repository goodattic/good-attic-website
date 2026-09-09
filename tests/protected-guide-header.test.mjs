import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { selectAll } from "css-select";
import { assetDelivery, pageAssets } from "../scripts/asset-delivery.mjs";
import { synchronizationFiles } from "./live-backend-parity.mjs";

const root = new URL("../", import.meta.url);
const parent = "0e3703bb5606f3c7e30c7f576ac708dc37db01ed";
const rollback = "3757a4f6fdb823c201aaa985c860f1e4e4909b1d";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const read = file => readFileSync(new URL(file, root));
const before = file => git("show", `${parent}:${file}`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const oldManifest = JSON.parse(before("scripts/asset-delivery-manifest.json"));
const files = Object.keys(oldManifest.protectedHashes);
const substitutions = [
  ['href="../../styles.css?v=measurement-20260901a"', 'href="../../styles.72e38ccd660523f9.css"'],
  ['src="../../script.js?v=quo-numbers-20260907a"', `src="../../${assetDelivery.js.to}"`],
];
const slices = (html, selector) => {
  const doc = parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
  return selectAll(selector, doc).map(node => html.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset));
};

test("five-guide exception reverses exactly two attribute values and nothing else", () => {
  assert.equal(files.length, 5);
  assert.equal(assetDelivery.protectedReferenceException.parentCommit, parent);
  assert.deepEqual(Object.keys(assetDelivery.protectedReferenceException.currentHashes), files);
  for (const file of files) {
    const old = before(file).toString(), current = read(file).toString();
    assert.equal(sha(old), oldManifest.protectedHashes[file]);
    assert.equal(sha(current), assetDelivery.protectedReferenceException.currentHashes[file]);
    let expected = old, reversed = current;
    for (const [from, to] of substitutions) {
      assert.equal(old.split(from).length - 1, 1, file);
      assert.equal(current.split(to).length - 1, 1, file);
      assert.equal(current.includes(from), false, file);
      expected = expected.replace(from, to);
      reversed = reversed.replace(to, from);
    }
    assert.equal(current, expected, file);
    assert.equal(reversed, old, file);
    assert.deepEqual(pageAssets(file), { css: oldManifest.css.to, js: assetDelivery.js.to });
  }
});

test("article, search metadata, schema, FAQ, links, images, forms, header markup and footer are exact", () => {
  for (const file of files) {
    const old = before(file).toString(), current = read(file).toString();
    for (const selector of ["main", "title", "meta", 'link[rel="canonical"]', 'script[type="application/ld+json"]', "details.faq-item", "a", "img", "form", ".modal", "header", "footer"]) {
      assert.deepEqual(slices(current, selector), slices(old, selector), `${file}: ${selector}`);
    }
    for (const schema of slices(current, 'script[type="application/ld+json"]')) JSON.parse(schema.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
  }
  assert.equal(read("resources/index.html").toString().replace(assetDelivery.js.to, oldManifest.js.to), before("resources/index.html").toString());
  assert.equal(read("_headers").toString().replace(`\n/${assetDelivery.js.to}\n  Cache-Control: public, max-age=31536000, immutable\n`, ""), before("_headers").toString());
  for (const file of ["sitemap.xml", "robots.txt"]) assert.deepEqual(read(file), before(file), file);
});

test("historical header exception plus the separately tested modal registrations stay bounded", () => {
  const support = ["scripts/asset-delivery-manifest.json", "scripts/build-pages-output.mjs", "_headers", "tests/asset-delivery.test.mjs", "tests/city-market-exact-copy.test.mjs", "tests/four-guide-ai-authority-cluster.test.mjs", "tests/protected-guide-header.test.mjs", "tests/pages-deployment-hardening.test.mjs", "tests/mobile-header.test.mjs"];
  const allowed = new Set([...synchronizationFiles, ...assetDelivery.htmlReferenceChangesOnly, ...support, "tests/asset-delivery-helpers.mjs"]);
  const tracked = git("ls-tree", "-r", "--name-only", parent).toString().trim().split("\n");
  for (const file of tracked.filter(file => !allowed.has(file))) assert.deepEqual(read(file), before(file), file);
  const expectedManifest = { ...oldManifest, htmlReferenceChangesOnly: [...files, ...oldManifest.htmlReferenceChangesOnly], protectedReferenceException: assetDelivery.protectedReferenceException, js: {...oldManifest.js, to: assetDelivery.js.to}, assets: {...oldManifest.assets, [assetDelivery.js.to]: assetDelivery.assets[assetDelivery.js.to]}, modalFocus: assetDelivery.modalFocus };
  assert.deepEqual(assetDelivery, expectedManifest);
  const added = git("diff", "--name-only", "--diff-filter=A", parent, "--").toString().trim().split("\n").filter(Boolean);
  assert.ok(added.every(file => [...synchronizationFiles, "tests/protected-guide-header.test.mjs", "tests/modal-focus.test.mjs", "tests/modal-focus.browser.mjs", assetDelivery.js.to].includes(file)));
});

test("both generations and the phone dependency retain exact parent and rollback bytes", () => {
  for (const file of [...Object.keys(oldManifest.assets), "assets/icons/phone.svg"]) {
    assert.deepEqual(read(file), before(file), file);
    assert.deepEqual(read(file), git("show", `${rollback}:${file}`), file);
    if (oldManifest.assets[file]) assert.equal(sha(read(file)), oldManifest.assets[file], file);
  }
  for (const file of files) assert.deepEqual(git("show", `${rollback}:${file}`), before(file), file);
});

test("two clean generations reproduce exact raw HTML bytes and unchanged data/sitemap", async () => {
  const generated = git("ls-tree", "-r", "--name-only", parent).toString().trim().split("\n").filter(file => file.endsWith(".html") && !["index.html", "404.html"].includes(file));
  generated.push("seo-wave1-page-data.json", "sitemap.xml", "robots.txt");
  for (let run = 0; run < 2; run++) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "good-attic-header-generation-"));
    try {
      for (const file of ["build-seo-wave1.mjs", "scripts", "content", "data", "node_modules"]) await cp(new URL(file, root), path.join(temporary, file), { recursive: true });
      execFileSync(process.execPath, ["build-seo-wave1.mjs"], { cwd: temporary });
      for (const file of generated) assert.deepEqual(readFileSync(path.join(temporary, file)), read(file), `${run}: ${file}`);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});
