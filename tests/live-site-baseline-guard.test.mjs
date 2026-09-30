import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertActiveScript,
  assertMarketNumbers,
  assertServedProductionDeployment,
  compareSnapshots,
} from "../scripts/live-site-baseline-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("current built release matches the frozen live deployment without approvals", () => {
  const result = spawnSync(process.execPath, ["scripts/check-live-site-baseline.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Local release guard passed:/);
});

test("unreviewed asset, runtime, removal, and addition changes fail the release guard", () => {
  const before = { assets: { "index.html": "one", "script.js": "two" }, runtime: { "functions/api/leads.js": "three" } };
  const after = { assets: { "index.html": "changed", "new.js": "added" }, runtime: { "functions/api/leads.js": "changed" } };
  assert.deepEqual(compareSnapshots(before, after), [
    "assets/index.html: one -> changed (unreviewed)",
    "assets/new.js: absent -> added (unreviewed)",
    "assets/script.js: two -> absent (unreviewed)",
    "runtime/functions/api/leads.js: three -> changed (unreviewed)",
  ]);
});

test("only exact reviewed hashes with a reason pass; stale approvals fail", () => {
  const before = { assets: { "index.html": "one" }, runtime: {} };
  const after = { assets: { "index.html": "two" }, runtime: {} };
  const review = { changes: { "assets/index.html": { expectedSha256: "two", reason: "Reviewed change to form submission script reference" } } };
  assert.deepEqual(compareSnapshots(before, after, review), []);
  assert.match(compareSnapshots(before, after, { changes: { "assets/index.html": { expectedSha256: "wrong", reason: "Reviewed change to form submission script reference" } } })[0], /unreviewed/);
  assert.match(compareSnapshots(before, before, review)[0], /stale/);
});

test("market links cannot regress even when a page change is reviewed", () => {
  const markets = { ut: { page: "salt-lake-city-ut/index.html", display: "385-336-4442", e164: "+13853364442" } };
  const valid = { "salt-lake-city-ut/index.html": "<a href=\"tel:+13853364442\">385-336-4442</a> 'phone_conversion_number': '385-336-4442'" };
  assert.deepEqual(assertMarketNumbers(valid, markets), []);
  const regressed = { "salt-lake-city-ut/index.html": valid["salt-lake-city-ut/index.html"].replace("tel:+13853364442", "tel:+18005550100") };
  assert.match(assertMarketNumbers(regressed, markets)[0], /unexpected call links/);
  const subpage = { ...valid, "salt-lake-city-ut/attic-insulation/index.html": regressed["salt-lake-city-ut/index.html"] };
  assert.match(assertMarketNumbers(subpage, markets)[0], /attic-insulation/);
});

test("all pages must reference the reviewed active script exactly once", () => {
  const pages = { "index.html": '<script src="script.40559d41a6b61dc2.js"></script>' };
  assert.deepEqual(assertActiveScript(pages, "script.40559d41a6b61dc2.js", { "script.40559d41a6b61dc2.js": "hash" }), []);
  assert.match(assertActiveScript(pages, "script.488eaabd8e623d5d.js", { "script.488eaabd8e623d5d.js": "hash" })[0], /expected one/);
});

test("online preflight ignores only never-started Pages records above the serving deployment", () => {
  const project = { canonical_deployment: { id: "live" } };
  const idle = { id: "queued", latest_stage: { status: "idle", started_on: null, ended_on: null }, stages: [
    { status: "idle", started_on: null, ended_on: null },
    { status: "idle", started_on: null, ended_on: null },
  ] };
  const deployments = [idle, { id: "live" }];
  assert.equal(assertServedProductionDeployment(project, deployments, "live"), 1);
  assert.throws(() => assertServedProductionDeployment({ canonical_deployment: { id: "changed" } }, deployments, "live"), /Production changed/);
  assert.throws(() => assertServedProductionDeployment(project, [
    { ...idle, stages: [{ status: "active", started_on: "now", ended_on: null }] },
    { id: "live" },
  ], "live"), /not idle/);
  assert.throws(() => assertServedProductionDeployment(project, [idle], "live"), /absent/);
});
