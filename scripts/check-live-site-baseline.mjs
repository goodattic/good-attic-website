#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  const { accountId, projectName, id } = baseline.productionDeployment;
  let latestId;
  if (token) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments?env=production&per_page=1`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Cloudflare Pages deployment lookup failed: HTTP ${response.status}`);
    const body = await response.json();
    if (body?.success !== true) throw new Error("Cloudflare Pages deployment lookup failed");
    latestId = body?.result?.[0]?.id;
  } else {
    // Wrangler's existing OAuth login is sufficient for a read-only preflight.
    // This avoids making release safety depend on another expiring API token.
    const output = execFileSync("npx", [
      "wrangler", "pages", "deployment", "list",
      "--project-name", projectName,
      "--environment", "production",
      "--json",
    ], { cwd: root, encoding: "utf8", timeout: 45_000 });
    const deployments = JSON.parse(output);
    latestId = deployments.find((entry) => entry.Environment === "Production")?.Id;
  }
  if (!latestId) throw new Error("Cloudflare Pages deployment lookup returned no production deployment");
  if (latestId !== id) throw new Error(`Production changed since baseline: expected ${id}; found ${latestId}. Stop and re-baseline from the current live deployment.`);
  console.log(`Online deployment preflight passed: production still ${id}`);
}
