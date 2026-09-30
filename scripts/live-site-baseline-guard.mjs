import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";

export const RUNTIME_PATHS = [
  ".github/workflows/live-site-release-guard.yml",
  "functions",
  "server",
  "src",
  "workers",
  "wrangler.toml",
  "package.json",
  "package-lock.json",
  "scripts/build-pages-output.mjs",
  "scripts/asset-delivery-manifest.json",
  "scripts/check-live-site-baseline.mjs",
  "scripts/live-site-baseline-guard.mjs",
  "tests/live-site-baseline-guard.test.mjs",
];

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

async function walk(root, relative = "") {
  const full = path.join(root, relative);
  const stat = await lstat(full);
  if (stat.isSymbolicLink()) throw new Error(`Symlink in release input: ${relative}`);
  if (stat.isFile()) return [relative.split(path.sep).join("/")];
  if (!stat.isDirectory()) throw new Error(`Unexpected release input: ${relative}`);
  const entries = (await readdir(full)).sort();
  return (await Promise.all(entries.map((entry) => walk(root, path.join(relative, entry))))).flat();
}

export async function snapshot(root) {
  const assets = {};
  for (const file of await walk(path.join(root, "dist"))) {
    assets[file] = sha256(await readFile(path.join(root, "dist", file)));
  }
  const runtime = {};
  for (const entry of RUNTIME_PATHS) {
    for (const file of await walk(root, entry)) {
      runtime[file] = sha256(await readFile(path.join(root, file)));
    }
  }
  return { assets, runtime };
}

export function compareSnapshots(baseline, candidate, review = {}) {
  const approved = review.changes ?? {};
  const violations = [];
  const used = new Set();
  for (const group of ["assets", "runtime"]) {
    const before = baseline[group] ?? {};
    const after = candidate[group] ?? {};
    for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const oldHash = before[file] ?? null;
      const newHash = after[file] ?? null;
      if (oldHash === newHash) continue;
      const key = `${group}/${file}`;
      const entry = approved[key];
      if (!entry || entry.expectedSha256 !== newHash || typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
        violations.push(`${key}: ${oldHash ?? "absent"} -> ${newHash ?? "absent"} (unreviewed)`);
      } else {
        used.add(key);
      }
    }
  }
  for (const key of Object.keys(approved)) {
    if (!used.has(key)) violations.push(`${key}: stale or invalid approval`);
  }
  return violations.sort();
}

export function assertServedProductionDeployment(project, deployments, expectedId) {
  const servedId = project?.canonical_deployment?.id;
  if (!servedId) throw new Error("Cloudflare Pages did not identify the serving production deployment");
  if (servedId !== expectedId) {
    throw new Error(`Production changed since baseline: expected ${expectedId}; found ${servedId}. Stop and re-baseline from the current live deployment.`);
  }

  const canonicalIndex = deployments.findIndex((deployment) => deployment.id === servedId);
  if (canonicalIndex < 0) throw new Error("Serving production deployment was absent from the recent deployment list");
  const newer = deployments.slice(0, canonicalIndex);
  for (const deployment of newer) {
    const stages = deployment.stages;
    const latest = deployment.latest_stage;
    const idle = latest?.status === "idle" && !latest.started_on && !latest.ended_on &&
      Array.isArray(stages) && stages.length > 0 &&
      stages.every((stage) => stage.status === "idle" && !stage.started_on && !stage.ended_on);
    if (!idle) throw new Error(`New production deployment ${deployment.id} is not idle; inspect it before publishing`);
  }
  return newer.length;
}

export function assertMarketNumbers(pages, markets) {
  const errors = [];
  for (const [market, { page, display, e164 }] of Object.entries(markets)) {
    const prefix = page.slice(0, page.indexOf("/") + 1);
    const marketPages = Object.entries(pages).filter(([file]) => file.startsWith(prefix));
    if (!pages[page] || !marketPages.length) errors.push(`${market}: missing ${page}`);
    for (const [file, html] of marketPages) {
      const hrefs = [...html.matchAll(/href=["']tel:([^"']+)["']/g)].map((match) => match[1]);
      if (!hrefs.length || hrefs.some((href) => href !== e164)) errors.push(`${market}: unexpected call links in ${file}`);
      if (!html.includes(display)) errors.push(`${market}: display number missing from ${file}`);
      if (!html.includes(`'phone_conversion_number': '${display}'`)) errors.push(`${market}: Google phone conversion number missing from ${file}`);
    }
  }
  return errors;
}

export function assertActiveScript(pages, activeScript, assets) {
  const errors = [];
  if (!assets[activeScript]) errors.push(`active script missing: ${activeScript}`);
  for (const [file, html] of Object.entries(pages)) {
    const references = [...html.matchAll(/script\.[0-9a-f]{16}\.js/g)].map((match) => match[0]);
    if (references.length !== 1 || references[0] !== activeScript) {
      errors.push(`${file}: expected one ${activeScript} reference`);
    }
  }
  return errors;
}

export async function pageContent(root) {
  const pages = {};
  for (const file of await walk(path.join(root, "dist"))) {
    if (file.endsWith(".html")) pages[file] = await readFile(path.join(root, "dist", file), "utf8");
  }
  return pages;
}
