import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assetDelivery } from "../scripts/asset-delivery.mjs";

const root = new URL("../", import.meta.url);
const parent = "6295efbc4fdc09a7770fdfdbb793e569757a02ab";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const read = file => readFileSync(new URL(file, root));
const before = file => git("show", `${parent}:${file}`);
const old = JSON.parse(before("scripts/asset-delivery-manifest.json"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const support = ["_headers", "scripts/asset-delivery-manifest.json", "scripts/build-pages-output.mjs", "tests/asset-delivery.test.mjs", "tests/protected-guide-header.test.mjs", "tests/pages-deployment-hardening.test.mjs", "tests/mobile-header.test.mjs"];

test("modal child changes exactly one src value per approved page, including five protected guides", () => {
  assert.equal(assetDelivery.modalFocus.parentCommit, parent);
  assert.equal(assetDelivery.modalFocus.previousAsset, old.js.to);
  assert.deepEqual(assetDelivery.htmlReferenceChangesOnly, old.htmlReferenceChangesOnly);
  for (const file of old.htmlReferenceChangesOnly) {
    const previous = before(file).toString(), current = read(file).toString();
    assert.equal(previous.split(old.js.to).length, 2, file);
    assert.equal(current.split(assetDelivery.js.to).length, 2, file);
    assert.equal(current.replace(assetDelivery.js.to, old.js.to), previous, file);
  }
  for (const file of Object.keys(old.protectedHashes)) {
    assert.equal(sha(read(file)), assetDelivery.protectedReferenceException.currentHashes[file]);
    assert.notEqual(sha(read(file)), old.protectedReferenceException.currentHashes[file]);
  }
});

test("modal child cannot change content, CSS, form contracts, backend, or unrelated source", () => {
  const allowed = new Set([...old.htmlReferenceChangesOnly, ...support, "tests/asset-delivery-helpers.mjs", "tests/four-guide-ai-authority-cluster.test.mjs"]);
  const tracked = git("ls-tree", "-r", "--name-only", parent).toString().trim().split("\n");
  for (const file of tracked.filter(file => !allowed.has(file))) assert.deepEqual(read(file), before(file), file);
  const expected = {...old, js: {...old.js, to: assetDelivery.js.to}, assets: {...old.assets, [assetDelivery.js.to]: sha(read(assetDelivery.js.to))}, modalFocus: {parentCommit: parent, previousAsset: old.js.to}, protectedReferenceException: {...old.protectedReferenceException, currentHashes: assetDelivery.protectedReferenceException.currentHashes}};
  assert.deepEqual(assetDelivery, expected);
  assert.equal(read("_headers").toString(), before("_headers").toString() + `\n/${assetDelivery.js.to}\n  Cache-Control: public, max-age=31536000, immutable\n`);
  assert.equal(read("scripts/build-pages-output.mjs").toString(), before("scripts/build-pages-output.mjs").toString().replace(`  "${old.js.to}",`, `  "${old.js.to}",\n  "${assetDelivery.js.to}",`));
});

test("new JavaScript changes only modal interaction; analytics, validation, submission and success are exact", () => {
  const previous = read(old.js.to).toString(), current = read(assetDelivery.js.to).toString();
  const start = previous.indexOf("function openModal()"), end = previous.indexOf("function getLeadThankYouModal()");
  const newStart = current.indexOf("let modalInteractionState = null;"), newEnd = current.indexOf("function getLeadThankYouModal()");
  assert.ok(start > 0 && end > start && newStart > 0 && newEnd > newStart);
  assert.equal(current.slice(0, newStart), previous.slice(0, start));
  assert.equal(current.slice(newEnd), previous.slice(end));
  const interaction = current.slice(newStart, newEnd);
  for (const name of ["track", "gtag", "dataLayer", "fetch", "submitLead", "sendBeacon"]) assert.doesNotMatch(interaction, new RegExp(`\\b${name}\\b`));
  assert.match(interaction, /document\.removeEventListener\("focusin", containModalFocus\)/);
  assert.match(interaction, /document\.removeEventListener\("keydown", containModalTab\)/);
});
