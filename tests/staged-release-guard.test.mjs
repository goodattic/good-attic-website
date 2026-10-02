import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReviewedRollbackFiles,
  assertServedProductionDeployment,
  compareSnapshots,
  snapshotFingerprint,
  validateGate4Proof,
} from "../scripts/live-site-baseline-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frozen = {
  productionDeployment: {
    id: "d0acd4af-738d-4dee-9f4b-5df4612bd4b0",
    accountId: "account-a",
    projectName: "site-a",
  },
  activeScript: "script.40559d41a6b61dc2.js",
  marketNumbers: { ut: { page: "ut/index.html", display: "385-336-4442", e164: "+13853364442" } },
  assets: { "index.html": "old-page", "script.40559d41a6b61dc2.js": "old-script" },
  runtime: { "functions/api/leads.js": "old-api" },
};
const gate4Review = {
  activeScript: frozen.activeScript,
  changes: {
    "runtime/functions/api/leads.js": {
      expectedSha256: "new-api",
      reason: "Reviewed API-only form transaction release",
    },
  },
};

function gate4Proof() {
  const proof = {
    schemaVersion: 1,
    stage: "gate4",
    sourceBaselineDeploymentId: frozen.productionDeployment.id,
    productionDeployment: {
      id: "12345678-1234-1234-1234-123456789abc",
      accountId: frozen.productionDeployment.accountId,
      projectName: frozen.productionDeployment.projectName,
    },
    activeScript: frozen.activeScript,
    marketNumbers: frozen.marketNumbers,
    assets: { ...frozen.assets },
    runtime: { "functions/api/leads.js": "new-api" },
    capture: {
      assetsDirectory: "dist",
      onlineVerified: true,
      publishedFilesSha256: "a".repeat(64),
      publishedFilesCount: 2,
      capturedAt: "2026-10-02T12:00:00.000Z",
    },
  };
  proof.artifactSnapshotSha256 = snapshotFingerprint(proof);
  return proof;
}

test("Gate 4 accepts reviewed runtime changes only and retains every live static asset", () => {
  const proof = gate4Proof();
  assert.deepEqual(validateGate4Proof(frozen, gate4Review, proof), []);
  proof.assets["index.html"] = "changed-page";
  proof.artifactSnapshotSha256 = snapshotFingerprint(proof);
  assert.match(validateGate4Proof(frozen, gate4Review, proof).join("\n"), /assets\/index.html.*unreviewed/);
});

test("only the exact reviewed rolled-back deployment can sit above the serving baseline", () => {
  const project = { id: "project-a", name: "site-a", canonical_deployment: { id: "live" } };
  const files = { "/index.html": "content-one", "/script.js": "content-two" };
  const reviewed = {
    id: "c46d8778-34b6-42a6-8031-50c0ac11d222",
    createdOn: "2026-10-02T21:14:09.459743Z",
    sourceCommit: "f15e3914d82ec62a79c1d171512f6e0f1c1b7c2b",
    publishedFilesSha256: snapshotFingerprint({ assets: files, runtime: {} }),
  };
  const rolledBack = {
    id: reviewed.id,
    project_id: project.id,
    project_name: project.name,
    environment: "production",
    aliases: null,
    created_on: reviewed.createdOn,
    latest_stage: { status: "success" },
    deployment_trigger: { type: "ad_hoc", metadata: { commit_hash: reviewed.sourceCommit } },
    files,
  };
  const live = { id: "live", files };
  const earlier = {
    ...reviewed,
    id: "ef63fcc3-e242-46dd-b782-05ab9d45194e",
    createdOn: "2026-10-02T21:13:02.490682Z",
    sourceCommit: "f15e39198965e64c617f8e145617a62616009b8d",
  };
  const earlierRecord = {
    ...rolledBack,
    id: earlier.id,
    created_on: earlier.createdOn,
    deployment_trigger: { type: "ad_hoc", metadata: { commit_hash: earlier.sourceCommit } },
  };
  assert.equal(assertServedProductionDeployment(project, [rolledBack, earlierRecord, live], "live", [reviewed, earlier]), 0);
  assert.doesNotThrow(() => assertReviewedRollbackFiles(live, rolledBack, reviewed));
  assert.doesNotThrow(() => assertReviewedRollbackFiles(live, earlierRecord, earlier));
  assert.throws(() => assertServedProductionDeployment(project, [{ ...rolledBack, id: "another" }, live], "live", [reviewed, earlier]), /not idle or the exact reviewed rollback/);
  assert.throws(() => assertServedProductionDeployment(project, [{ ...rolledBack, aliases: ["site-a.example"] }, live], "live", [reviewed, earlier]), /not idle or the exact reviewed rollback/);
  assert.throws(() => assertServedProductionDeployment({ ...project, canonical_deployment: { id: reviewed.id } }, [rolledBack, live], "live", [reviewed, earlier]), /Production changed/);
  assert.throws(() => assertReviewedRollbackFiles(live, { ...rolledBack, files: { ...files, "/index.html": "changed" } }, reviewed), /published files differ/);
});

test("Gate 4 proof rejects wrong project, stale deployment, missing online evidence, and changed runtime", () => {
  for (const alter of [
    (proof) => { proof.productionDeployment.projectName = "site-b"; },
    (proof) => { proof.productionDeployment.id = frozen.productionDeployment.id; },
    (proof) => { proof.capture.onlineVerified = false; },
    (proof) => { proof.runtime["functions/api/leads.js"] = "unexpected-api"; proof.artifactSnapshotSha256 = snapshotFingerprint(proof); },
  ]) {
    const proof = gate4Proof();
    alter(proof);
    assert.notDeepEqual(validateGate4Proof(frozen, gate4Review, proof), []);
  }
});

test("Gate 5 reviews only static/script changes against the captured Gate 4 artifact", () => {
  const proof = gate4Proof();
  const gate5Review = {
    changes: {
      "assets/index.html": { expectedSha256: "new-page", reason: "Reviewed active script reference change" },
      "assets/script.new.js": { expectedSha256: "new-script", reason: "Reviewed active script content" },
    },
  };
  const candidate = {
    assets: { ...proof.assets, "index.html": "new-page", "script.new.js": "new-script" },
    runtime: { ...proof.runtime },
  };
  assert.deepEqual(compareSnapshots(proof, candidate, gate5Review), []);
  candidate.runtime["functions/api/leads.js"] = "lost-gate4-api";
  assert.match(compareSnapshots(proof, candidate, gate5Review).join("\n"), /runtime\/functions\/api\/leads.js.*unreviewed/);
});

test("stage commands fail before network when online pin or Gate 4 artifact directory is omitted", () => {
  for (const [args, message] of [
    [["--stage", "gate4", "--check-live-deployment"], /requires --assets-dir/],
    [["--stage", "gate5"], /requires --check-live-deployment/],
    [["--stage", "gate4", "--assets-dir", "dist"], /requires --check-live-deployment/],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/check-live-site-baseline.mjs", ...args], {
      cwd: root, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
});
