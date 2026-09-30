#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertActiveScript,
  assertMarketNumbers,
  compareSnapshots,
  pageContent,
  snapshot,
} from "./live-site-baseline-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (flag !== "--check-live-deployment") throw new Error(`Unknown option: ${flag}`);
}
const baseline = JSON.parse(await readFile(path.join(root, "scripts/live-site-baseline.json"), "utf8"));
const review = JSON.parse(await readFile(path.join(root, "scripts/live-site-reviewed-changes.json"), "utf8"));
assert.equal(baseline.schemaVersion, 1);
assert.equal(review.schemaVersion, 1);
assert.equal(review.baselineDeploymentId, baseline.productionDeployment.id);

const candidate = await snapshot(root);
const pages = await pageContent(root);
const activeScript = review.activeScript ?? baseline.activeScript;
const errors = [
  ...compareSnapshots(baseline, candidate, review),
  ...assertMarketNumbers(pages, baseline.marketNumbers),
  ...assertActiveScript(pages, activeScript, candidate.assets),
];
if (errors.length) {
  console.error(`Live-site baseline check failed (${errors.length}):\n${errors.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Local release guard passed: ${Object.keys(candidate.assets).length} assets, ${Object.keys(candidate.runtime).length} runtime files against deployment ${baseline.productionDeployment.id}`);
}

if (flags.has("--check-live-deployment") && !process.exitCode) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required for live deployment preflight");
  const { accountId, projectName, id } = baseline.productionDeployment;
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments?env=production&per_page=1`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Cloudflare Pages deployment lookup failed: HTTP ${response.status}`);
  const body = await response.json();
  const latest = body?.result?.[0];
  if (body?.success !== true || !latest?.id) throw new Error("Cloudflare Pages deployment lookup returned no production deployment");
  if (latest.id !== id) throw new Error(`Production changed since baseline: expected ${id}; found ${latest.id}. Stop and re-baseline from the current live deployment.`);
  console.log(`Online deployment preflight passed: production still ${id}`);
}
