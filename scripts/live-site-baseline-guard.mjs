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
  "tests/staged-release-guard.test.mjs",
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

export async function snapshot(root, assetsRoot = path.join(root, "dist")) {
  const assets = {};
  for (const file of await walk(assetsRoot)) {
    assets[file] = sha256(await readFile(path.join(assetsRoot, file)));
  }
  const runtime = {};
  for (const entry of RUNTIME_PATHS) {
    for (const file of await walk(root, entry)) {
      runtime[file] = sha256(await readFile(path.join(root, file)));
    }
  }
  return { assets, runtime };
}

export function snapshotFingerprint({ assets, runtime }) {
  const sorted = (group) => Object.fromEntries(Object.entries(group).sort(([a], [b]) => a.localeCompare(b)));
  return sha256(JSON.stringify({ assets: sorted(assets), runtime: sorted(runtime) }));
}

export function validateGate4Proof(frozen, review, proof) {
  const errors = [];
  if (proof?.schemaVersion !== 1 || proof?.stage !== "gate4") errors.push("Gate 4 proof has an invalid version or stage");
  if (proof?.sourceBaselineDeploymentId !== frozen.productionDeployment.id) errors.push("Gate 4 proof is not based on the frozen live deployment");
  const deployment = proof?.productionDeployment;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deployment?.id || "") ||
      deployment.id === frozen.productionDeployment.id) errors.push("Gate 4 proof lacks a new deployment ID");
  if (deployment?.accountId !== frozen.productionDeployment.accountId ||
      deployment?.projectName !== frozen.productionDeployment.projectName) errors.push("Gate 4 proof names a different Pages project");
  if (proof?.activeScript !== frozen.activeScript) errors.push("Gate 4 proof does not retain the live active script");
  if (JSON.stringify(proof?.marketNumbers) !== JSON.stringify(frozen.marketNumbers)) errors.push("Gate 4 proof changes market phone numbers");
  if (proof?.capture?.onlineVerified !== true || proof?.capture?.assetsDirectory !== "dist" ||
      !/^[0-9a-f]{64}$/.test(proof?.capture?.publishedFilesSha256 || "") ||
      !Number.isSafeInteger(proof?.capture?.publishedFilesCount) || proof.capture.publishedFilesCount < 1 ||
      !Number.isFinite(Date.parse(proof?.capture?.capturedAt || ""))) {
    errors.push("Gate 4 proof lacks a verified Pages asset capture");
  }
  if (!proof?.assets || !proof?.runtime ||
      proof?.artifactSnapshotSha256 !== snapshotFingerprint({ assets: proof.assets || {}, runtime: proof.runtime || {} })) {
    errors.push("Gate 4 proof artifact fingerprint does not match its file hashes");
  }
  if (proof?.assets && proof?.runtime) errors.push(...compareSnapshots(frozen, proof, review));
  return errors;
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

export function assertServedProductionDeployment(project, deployments, expectedId, reviewedRollbacks = []) {
  const servedId = project?.canonical_deployment?.id;
  if (!servedId) throw new Error("Cloudflare Pages did not identify the serving production deployment");
  if (servedId !== expectedId) {
    throw new Error(`Production changed since baseline: expected ${expectedId}; found ${servedId}. Stop and re-baseline from the current live deployment.`);
  }

  const canonicalIndex = deployments.findIndex((deployment) => deployment.id === servedId);
  if (canonicalIndex < 0) throw new Error("Serving production deployment was absent from the recent deployment list");
  const newer = deployments.slice(0, canonicalIndex);
  let idleCount = 0;
  for (const deployment of newer) {
    const stages = deployment.stages;
    const latest = deployment.latest_stage;
    const idle = latest?.status === "idle" && !latest.started_on && !latest.ended_on &&
      Array.isArray(stages) && stages.length > 0 &&
      stages.every((stage) => stage.status === "idle" && !stage.started_on && !stage.ended_on);
    if (idle) {
      idleCount++;
      continue;
    }
    const reviewedRollback = reviewedRollbacks.find((entry) => entry.id === deployment.id);
    const exactRolledBackRecord = reviewedRollback &&
      deployment.project_id === project?.id && deployment.project_name === project?.name &&
      deployment.environment === "production" && deployment.aliases === null &&
      deployment.latest_stage?.status === "success" &&
      deployment.deployment_trigger?.type === "ad_hoc" &&
      deployment.deployment_trigger?.metadata?.commit_hash === reviewedRollback.sourceCommit &&
      deployment.created_on === reviewedRollback.createdOn;
    if (!exactRolledBackRecord) throw new Error(`New production deployment ${deployment.id} is not idle or the exact reviewed rollback; inspect it before publishing`);
  }
  return idleCount;
}

export function assertReviewedRollbackFiles(liveDeployment, rollbackDeployment, reviewedRollback) {
  if (rollbackDeployment?.id !== reviewedRollback?.id || rollbackDeployment?.aliases !== null ||
      rollbackDeployment?.latest_stage?.status !== "success" ||
      rollbackDeployment?.deployment_trigger?.metadata?.commit_hash !== reviewedRollback?.sourceCommit ||
      rollbackDeployment?.created_on !== reviewedRollback?.createdOn ||
      !liveDeployment?.files || !rollbackDeployment?.files) {
    throw new Error("Reviewed rollback deployment detail does not match its recorded identity");
  }
  const liveHash = snapshotFingerprint({ assets: liveDeployment.files, runtime: {} });
  const rollbackHash = snapshotFingerprint({ assets: rollbackDeployment.files, runtime: {} });
  if (liveHash !== reviewedRollback.publishedFilesSha256 || rollbackHash !== liveHash) {
    throw new Error("Reviewed rollback published files differ from the serving deployment");
  }
}

export function assertReviewedGate5RollbackFiles(liveDeployment, rollbackDeployment, reviewedRollback, approvedAssetsSha256) {
  if (reviewedRollback?.baselineDeploymentId !== liveDeployment?.id ||
      reviewedRollback?.approvedAssetsSha256 !== approvedAssetsSha256 ||
      rollbackDeployment?.id !== reviewedRollback?.id || rollbackDeployment?.aliases !== null ||
      rollbackDeployment?.latest_stage?.status !== "success" ||
      rollbackDeployment?.deployment_trigger?.type !== "ad_hoc" ||
      rollbackDeployment?.deployment_trigger?.metadata?.commit_hash !== reviewedRollback?.sourceCommit ||
      rollbackDeployment?.created_on !== reviewedRollback?.createdOn ||
      !rollbackDeployment?.files ||
      Object.keys(rollbackDeployment.files).length !== reviewedRollback?.publishedFilesCount) {
    throw new Error("Reviewed Gate 5 rollback deployment detail does not match its approved identity and assets");
  }
  const publishedHash = snapshotFingerprint({ assets: rollbackDeployment.files, runtime: {} });
  if (publishedHash !== reviewedRollback.publishedFilesSha256) {
    throw new Error("Reviewed Gate 5 rollback published files differ from the approved static build");
  }
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

export async function pageContent(root, assetsRoot = path.join(root, "dist")) {
  const pages = {};
  for (const file of await walk(assetsRoot)) {
    if (file.endsWith(".html")) pages[file] = await readFile(path.join(assetsRoot, file), "utf8");
  }
  return pages;
}
