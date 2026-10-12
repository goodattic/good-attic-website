#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertActiveScript,
  assertMarketNumbers,
  assertReviewedGate5RollbackFiles,
  assertReviewedRollbackFiles,
  assertServedProductionDeployment,
  compareSnapshots,
  pageContent,
  snapshot,
  snapshotFingerprint,
  validateGate4Proof,
} from "./live-site-baseline-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestDir = path.join(root, "scripts");

function parseOptions(args) {
  const options = { stage: "full", checkLiveDeployment: false, assetsDir: null, captureDeploymentId: null };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--check-live-deployment") options.checkLiveDeployment = true;
    else if (["--stage", "--assets-dir", "--capture-deployment"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      if (flag === "--stage") options.stage = value;
      if (flag === "--assets-dir") options.assetsDir = value;
      if (flag === "--capture-deployment") options.captureDeploymentId = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!["full", "gate4", "gate5"].includes(options.stage)) throw new Error(`Unknown release stage: ${options.stage}`);
  if (options.stage === "gate4" && !options.assetsDir) throw new Error("Gate 4 requires --assets-dir for the exact Pages publish directory");
  if (options.stage !== "gate4" && options.assetsDir) throw new Error("--assets-dir is only supported for Gate 4");
  if (options.captureDeploymentId && (options.stage !== "gate4" || options.checkLiveDeployment)) {
    throw new Error("--capture-deployment requires Gate 4 and cannot be combined with --check-live-deployment");
  }
  if (options.captureDeploymentId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.captureDeploymentId)) {
    throw new Error("--capture-deployment requires a Pages deployment UUID");
  }
  if (options.stage !== "full" && !options.checkLiveDeployment && !options.captureDeploymentId) {
    throw new Error(`${options.stage} release guard requires --check-live-deployment`);
  }
  return options;
}

function resolveAssetsDir(relative) {
  const directory = path.resolve(root, relative);
  if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("Release assets must be inside this checkout");
  if (directory !== path.join(root, "dist")) throw new Error("Gate 4 must inspect the dist directory that Pages will publish");
  return directory;
}

async function readManifest(name) {
  return JSON.parse(await readFile(path.join(manifestDir, name), "utf8"));
}

function checkReview(review, stage, baseline, keyPrefix) {
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.stage, stage);
  if (stage === "gate4") {
    assert.equal(review.baselineDeploymentId, baseline.productionDeployment.id);
    assert.equal(review.activeScript, baseline.activeScript);
  } else assert.equal(review.baselineStage, "gate4");
  const gate5Tooling = new Set([
    "runtime/scripts/check-live-site-baseline.mjs",
    "runtime/scripts/live-site-baseline-guard.mjs",
    "runtime/tests/staged-release-guard.test.mjs",
  ]);
  assert.ok(Object.keys(review.changes || {}).every((key) => key.startsWith(keyPrefix) ||
    (stage === "gate5" && gate5Tooling.has(key))), `${stage} contains changes outside reviewed release files`);
}

async function productionState(baseline, expectedId, reviewedGate5Rollback = null, approvedAssetsSha256 = null) {
  let token = process.env.CLOUDFLARE_API_TOKEN;
  const { accountId, projectName } = baseline.productionDeployment;
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
  if (project?.name !== projectName) throw new Error("Cloudflare Pages returned a different project");
  const deployments = [];
  for (let page = 1; page <= 100; page++) {
    const batch = (await getBody(`${projectUrl}/deployments?env=production&per_page=10&page=${page}`)).result;
    if (!Array.isArray(batch)) throw new Error("Cloudflare Pages deployment list was invalid");
    deployments.push(...batch);
    if (batch.some((deployment) => deployment.id === expectedId) || batch.length < 10) break;
  }
  const reviewedRollbacks = [
    ...(baseline.reviewedRolledBackDeployments || []),
    ...(reviewedGate5Rollback ? [reviewedGate5Rollback] : []),
  ];
  if (!Array.isArray(reviewedRollbacks)) throw new Error("Reviewed rollback records must be an array");
  const idleCount = assertServedProductionDeployment(project, deployments, expectedId, reviewedRollbacks);
  const deployment = (await getBody(`${projectUrl}/deployments/${encodeURIComponent(expectedId)}`)).result;
  if (deployment?.id !== expectedId || deployment?.project_id !== project?.id ||
      deployment?.project_name !== projectName || deployment?.environment !== "production") {
    throw new Error("Cloudflare Pages returned a deployment from another project or environment");
  }
  async function deploymentDetail(id) {
    const detail = (await getBody(`${projectUrl}/deployments/${encodeURIComponent(id)}`)).result;
    if (detail?.id !== id || detail?.project_id !== project?.id || detail?.project_name !== projectName ||
        detail?.environment !== "production") throw new Error("Cloudflare Pages returned an unrelated deployment");
    return detail;
  }
  const canonicalIndex = deployments.findIndex((entry) => entry.id === expectedId);
  for (const reviewedRollback of reviewedRollbacks) {
    if (!deployments.slice(0, canonicalIndex).some((entry) => entry.id === reviewedRollback.id)) continue;
    const rollbackDeployment = await deploymentDetail(reviewedRollback.id);
    if (reviewedGate5Rollback?.id === reviewedRollback.id) {
      assertReviewedGate5RollbackFiles(deployment, rollbackDeployment, reviewedRollback, approvedAssetsSha256);
    } else {
      assertReviewedRollbackFiles(deployment, rollbackDeployment, reviewedRollback);
    }
  }
  return { project, deployment, idleCount, deploymentDetail };
}

const options = parseOptions(process.argv.slice(2));
const frozen = await readManifest("live-site-baseline.json");
assert.equal(frozen.schemaVersion, 1);
const assetsRoot = options.stage === "gate4" ? resolveAssetsDir(options.assetsDir) : path.join(root, "dist");

let baseline = frozen;
let review;
if (options.stage === "full") {
  review = await readManifest("live-site-reviewed-changes.json");
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.baselineDeploymentId, frozen.productionDeployment.id);
} else if (options.stage === "gate4") {
  review = await readManifest("live-site-gate4-reviewed-changes.json");
  checkReview(review, "gate4", frozen, "runtime/");
  assert.equal(review.activeScript, frozen.activeScript);
} else {
  const gate4Review = await readManifest("live-site-gate4-reviewed-changes.json");
  checkReview(gate4Review, "gate4", frozen, "runtime/");
  const proof = await readManifest("live-site-gate4-deployed.json");
  const proofErrors = validateGate4Proof(frozen, gate4Review, proof);
  if (proofErrors.length) throw new Error(`Gate 4 release proof invalid:\n${proofErrors.join("\n")}`);
  baseline = proof;
  review = await readManifest("live-site-gate5-reviewed-changes.json");
  checkReview(review, "gate5", proof, "assets/");
}

const candidate = await snapshot(root, assetsRoot);
const pages = await pageContent(root, assetsRoot);
const activeScript = review.activeScript ?? baseline.activeScript;
const errors = [
  ...compareSnapshots(baseline, candidate, review),
  ...assertMarketNumbers(pages, baseline.marketNumbers),
  ...assertActiveScript(pages, activeScript, candidate.assets),
];
if (errors.length) {
  console.error(`${options.stage} release guard failed (${errors.length}):\n${errors.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Local release guard passed: ${options.stage}, ${Object.keys(candidate.assets).length} assets, ${Object.keys(candidate.runtime).length} runtime files against deployment ${baseline.productionDeployment.id}`);
}

if (options.checkLiveDeployment && !process.exitCode) {
  const reviewedGate5Rollback = options.stage === "gate5" ? review.reviewedRolledBackGate5Deployment : null;
  if (options.stage === "gate5") {
    assert.ok(reviewedGate5Rollback, "Gate 5 requires its exact reviewed rollback deployment");
  }
  const approvedAssetsSha256 = snapshotFingerprint({ assets: candidate.assets, runtime: {} });
  const { idleCount, deployment } = await productionState(
    baseline, baseline.productionDeployment.id, reviewedGate5Rollback, approvedAssetsSha256,
  );
  if (options.stage === "gate5") {
    const expectedFilesHash = baseline.capture?.publishedFilesSha256;
    const actualFilesHash = snapshotFingerprint({ assets: deployment.files || {}, runtime: {} });
    if (!expectedFilesHash || actualFilesHash !== expectedFilesHash) {
      throw new Error("Gate 4 serving static manifest differs from captured deployment proof");
    }
  }
  console.log(`Online deployment preflight passed: production still ${baseline.productionDeployment.id}; ${idleCount} newer idle record(s) ignored`);
}

if (options.captureDeploymentId && !process.exitCode) {
  if (options.captureDeploymentId === frozen.productionDeployment.id) throw new Error("Gate 4 capture ID must differ from the frozen deployment");
  const { deployment, deploymentDetail } = await productionState(frozen, options.captureDeploymentId);
  if (deployment?.latest_stage?.status !== "success") {
    throw new Error("Gate 4 capture target is not a successful production deployment");
  }
  const previousDeployment = await deploymentDetail(frozen.productionDeployment.id);
  if (!deployment.uses_functions || !previousDeployment.files || !deployment.files ||
      snapshotFingerprint({ assets: deployment.files, runtime: {} }) !==
      snapshotFingerprint({ assets: previousDeployment.files, runtime: {} })) {
    throw new Error("Gate 4 published static files do not match the frozen live deployment");
  }
  const proof = {
    schemaVersion: 1,
    stage: "gate4",
    sourceBaselineDeploymentId: frozen.productionDeployment.id,
    productionDeployment: {
      id: options.captureDeploymentId,
      accountId: frozen.productionDeployment.accountId,
      projectName: frozen.productionDeployment.projectName,
    },
    activeScript: frozen.activeScript,
    marketNumbers: frozen.marketNumbers,
    assets: candidate.assets,
    runtime: candidate.runtime,
    artifactSnapshotSha256: snapshotFingerprint(candidate),
    capture: {
      assetsDirectory: path.relative(root, assetsRoot),
      onlineVerified: true,
      publishedFilesSha256: snapshotFingerprint({ assets: deployment.files, runtime: {} }),
      publishedFilesCount: Object.keys(deployment.files).length,
      capturedAt: new Date().toISOString(),
    },
  };
  const proofErrors = validateGate4Proof(frozen, review, proof);
  if (proofErrors.length) throw new Error(`Gate 4 capture proof invalid:\n${proofErrors.join("\n")}`);
  const output = path.join(manifestDir, "live-site-gate4-deployed.json");
  await writeFile(output, `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Captured verified Gate 4 deployment ${options.captureDeploymentId}: ${proof.artifactSnapshotSha256}`);
}
