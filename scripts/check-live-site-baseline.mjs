#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertActiveScript,
  assertMarketNumbers,
  assertServedProductionDeployment,
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
  let token = process.env.CLOUDFLARE_API_TOKEN;
  const { accountId, projectName, id } = baseline.productionDeployment;
  if (!token) {
    // Reuse Wrangler's authenticated session without printing or storing its token.
    const output = execFileSync("npx", ["wrangler", "auth", "token", "--json"], {
      cwd: root, encoding: "utf8", timeout: 45_000,
    });
    token = JSON.parse(output).token;
  }
  if (!token) throw new Error("Cloudflare Pages authentication unavailable for deployment preflight");

  const projectUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;
  async function getBody(url) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Cloudflare Pages lookup failed: HTTP ${response.status}`);
    const body = await response.json();
    if (body?.success !== true) throw new Error("Cloudflare Pages lookup failed");
    return body;
  }
  const project = (await getBody(projectUrl)).result;
  const deployments = [];
  for (let page = 1; page <= 100; page++) {
    const batch = (await getBody(`${projectUrl}/deployments?env=production&per_page=10&page=${page}`)).result;
    if (!Array.isArray(batch)) throw new Error("Cloudflare Pages deployment list was invalid");
    deployments.push(...batch);
    if (batch.some((deployment) => deployment.id === id) || batch.length < 10) break;
  }
  const idleCount = assertServedProductionDeployment(project, deployments, id);
  console.log(`Online deployment preflight passed: production still ${id}; ${idleCount} newer idle record(s) ignored`);
}
