import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assetDelivery, pageAssets } from "../scripts/asset-delivery.mjs";
import { assetMigrationFiles, preAssetMigrationHtml } from "./asset-delivery-helpers.mjs";
import { beforeHomepageCleanup } from "./homepage-cleanup-helpers.mjs";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root));
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const original = file => git("show", `${assetDelivery.sourceCommit}:${file}`);

test("retained assets and the new modal asset match their registered full digests", () => {
  for (const [file, hash] of Object.entries(assetDelivery.assets)) {
    assert.equal(sha(read(file)), hash, file);
    if (file.split(".").length === 3) assert.ok(file.includes(hash.slice(0, 16)), file);
  }
  assert.deepEqual(read(assetDelivery.css.to), original("styles.css"));
  assert.deepEqual(read(assetDelivery.modalFocus.previousAsset), original("script.js"));
  for (const file of ["styles.css", "script.js"]) assert.deepEqual(read(file), git("show", `${assetDelivery.restoredCommit}:${file}`));
  assert.deepEqual(read("assets/icons/phone.svg"), original("assets/icons/phone.svg"));
});

test("exactly 91 original plus five exception HTML files change only two asset references", () => {
  const approved = new Set(assetDelivery.htmlReferenceChangesOnly);
  assert.equal(approved.size, 96);
  const files = git("ls-tree", "-r", "--name-only", assetDelivery.sourceCommit).toString().trim().split("\n");
  const changed = [];
  for (const file of files.filter(file => file.endsWith(".html"))) {
    const before = original(file).toString();
    let expected = before;
    if (approved.has(file)) {
      for (const key of ["css", "js"]) {
        const from = assetDelivery.referenceExceptions[file]?.[key] || assetDelivery[key].from;
        assert.equal(expected.split(from).length, 2, file);
        expected = expected.replace(from, assetDelivery[key].to);
      }
    }
    assert.equal(beforeHomepageCleanup(read(file).toString(), file), expected, file);
    if (expected !== before) changed.push(file);
  }
  assert.deepEqual(changed.sort(), [...approved].sort());
});

test("five guides reverse exactly to protected bytes; winning card and sitemap stay byte-identical", () => {
  for (const [file, hash] of Object.entries(assetDelivery.protectedHashes)) {
    const reversed = Buffer.from(preAssetMigrationHtml(read(file).toString(), file));
    assert.equal(sha(read(file)), assetDelivery.protectedReferenceException.currentHashes[file], file);
    assert.equal(sha(reversed), hash, file);
    assert.deepEqual(reversed, original(file));
    assert.deepEqual(reversed, git("show", `${assetDelivery.restoredCommit}:${file}`));
    assert.equal(pageAssets(file).css, assetDelivery.css.to);
    assert.equal(pageAssets(file).js, assetDelivery.js.to);
  }
  const cards = source => [...source.matchAll(/<a class="feature-card page-card-link reveal"[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.deepEqual(cards(read("resources/index.html").toString()), cards(original("resources/index.html").toString()));
  assert.deepEqual(read("sitemap.xml"), original("sitemap.xml"));
  assert.deepEqual(read("robots.txt"), original("robots.txt"));
});

test("no operational, content, dependency, or other tracked source changes escape the asset allowlist", () => {
  const allowed = new Set(assetMigrationFiles);
  const files = git("ls-tree", "-r", "--name-only", assetDelivery.sourceCommit).toString().trim().split("\n");
  for (const file of files.filter(file => !allowed.has(file))) assert.deepEqual(read(file), original(file), file);
  for (const file of assetDelivery.htmlReferenceChangesOnly) {
    assert.deepEqual(pageAssets(file), { css: assetDelivery.css.to, js: assetDelivery.js.to });
    assert.deepEqual(pageAssets('/' + file), pageAssets(file));
  }
});

test("only registered asset header blocks change and production keeps its indexing policy", () => {
  const before = original("_headers").toString();
  let expected = before;
  for (const file of ["styles.css", "script.js"]) expected = expected.replace(`/${file}\n  Cache-Control: public, max-age=3600, must-revalidate`, `/${file}\n  Cache-Control: public, no-cache, max-age=0, must-revalidate`);
  expected = expected.replace('/script.js\n  Cache-Control: public, no-cache, max-age=0, must-revalidate', '/script.js\n  Cache-Control: public, no-cache, max-age=0, must-revalidate\n\n/styles.72e38ccd660523f9.css\n  Cache-Control: public, max-age=31536000, immutable\n\n/script.79eca18f8a153d62.js\n  Cache-Control: public, max-age=31536000, immutable');
  expected += `\n/${assetDelivery.js.to}\n  Cache-Control: public, max-age=31536000, immutable\n`;
  assert.equal(read("_headers").toString(), expected);
  assert.doesNotMatch(expected, /noindex/i);
  assert.doesNotMatch(read("robots.txt").toString(), /Disallow:\s*\//);
});
