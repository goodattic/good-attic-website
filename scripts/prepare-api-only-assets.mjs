#!/usr/bin/env node
// Stage the reviewed API with the exact static assets that are serving now.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const baseline = JSON.parse(await readFile(path.join(root, "scripts/live-site-baseline.json"), "utf8"));
const expected = baseline.assets;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unexpected deploy asset: ${relative}`);
  }
  return result;
}

const current = await files(dist);
const extra = current.filter((file) => !(file in expected));
assert.equal(extra.length, 1, `Expected exactly one new script asset; found ${extra.join(", ")}`);
assert.match(extra[0], /^script\.[a-f0-9]{16}\.js$/);
await rm(path.join(dist, extra[0]));

let restored = 0;
for (const [file, hash] of Object.entries(expected)) {
  const target = path.join(dist, file);
  let existing;
  try { existing = await readFile(target); } catch { throw new Error(`Missing baseline asset: ${file}`); }
  if (sha256(existing) === hash) continue;
  const original = execFileSync("git", ["show", `live-snapshot-2026-10:${file}`], {
    cwd: root, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(sha256(original), hash, `Saved snapshot does not match live hash: ${file}`);
  await writeFile(target, original);
  restored += 1;
}

const staged = await files(dist);
assert.deepEqual(staged.sort(), Object.keys(expected).sort());
for (const [file, hash] of Object.entries(expected)) {
  assert.equal(sha256(await readFile(path.join(dist, file))), hash, `Staged asset differs from live: ${file}`);
}
console.log(`API-only assets match serving deployment ${baseline.productionDeployment.id}: ${staged.length} assets; restored ${restored}, removed ${extra[0]}`);
