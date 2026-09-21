import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { approvedOperationalHashes } from "./approved-operational-hashes.mjs";
import { liveCommit, releaseParent, liveBackendFiles, synchronizationFiles } from "./live-backend-parity.mjs";

const root = new URL("../", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const read = file => readFileSync(new URL(file, root));
const files = commit => git("ls-tree", "-r", "--name-only", commit).toString().trim().split("\n");
const synchronizedRelease = "ed94cc5";
const synchronized = file => git("show", `${synchronizedRelease}:${file}`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("the frozen synchronization imported only the exact reviewed four-file live backend patch", () => {
  assert.deepEqual(git("diff", "--name-only", `${liveCommit}^`, liveCommit).toString().trim().split("\n").sort(), ["migrations/0008_quo_call_attributions.sql", "server/jobber-quo-intake.js", "tests/approved-operational-hashes.mjs", "tests/jobber-quo-intake.test.mjs"].sort());
  for (const file of liveBackendFiles) assert.deepEqual(synchronized(file), git("show", `${liveCommit}:${file}`), file);
  const allowed = new Set(synchronizationFiles);
  for (const file of files(releaseParent).filter(file => !allowed.has(file))) {
    assert.deepEqual(read(file), git("show", `${releaseParent}:${file}`), file);
  }
  const previous = new Set(files(releaseParent));
  const current = git("ls-files", "--cached", "--others", "--exclude-standard").toString().trim().split("\n");
  assert.deepEqual(current.filter(file => !previous.has(file)).sort(), ["PHASE2-GOOGLE-ADS-OUTCOME-WATCHER.md", "migrations/0008_quo_call_attributions.sql", "migrations/0009_google_ads_outcome_outbox.sql", "outputs/phase2-dry-run-reconciliation-2026-09-21.json", "server/acknowledgement-source.js", "server/google-ads-outcome-collection.js", "server/google-ads-outcome-watcher.js", "server/jobber-acknowledgement-resolver.js", "server/jobber-contact-resolver.js", "server/jobber-quo-intake.js", "server/quo-client-name.js", "tests/approved-operational-hashes.mjs", "tests/fixtures/acknowledgement-sources.sql", "tests/fixtures/quo-intake-operations.sql", "tests/google-ads-outcome-watcher.test.mjs", "tests/jobber-acknowledgement-resolver.test.mjs", "tests/jobber-quo-intake.test.mjs", "tests/live-backend-parity.mjs", "tests/quo-client-name.test.mjs", "tests/release-synchronization.test.mjs"]);
});

test("the frozen synchronization retained all live operations with only the approved release receipt timeout", () => {
  const releaseOnly = [];
  const operational = file => /^(functions|server|migrations)\//.test(file) || file === "wrangler.toml";
  const intentionallyAdded = new Set(["migrations/0008_quo_call_attributions.sql", "server/acknowledgement-source.js", "server/jobber-acknowledgement-resolver.js", "server/jobber-contact-resolver.js", "server/jobber-quo-intake.js", "server/quo-client-name.js"]);
  assert.deepEqual(files(releaseParent).filter(operational).sort(), files(liveCommit).filter(operational).filter(file => !intentionallyAdded.has(file)).sort());
  for (const file of files(liveCommit).filter(operational).filter(file => !intentionallyAdded.has(file))) {
    const source = releaseOnly.includes(file) ? releaseParent : liveCommit;
    assert.deepEqual(synchronized(file), git("show", `${source}:${file}`), file);
  }
});

test("historical live-patch hashes remain proven and the Phase 1 hashes match the synchronized baseline", () => {
  for (const [file, hash] of Object.entries(approvedOperationalHashes)) {
    assert.equal(sha(read(file)), hash, file);
  }
});

test("the current release changes only the exact approved broker patch, focused tests and two release guards", () => {
  const allowed = new Set(["PHASE2-GOOGLE-ADS-OUTCOME-WATCHER.md", "outputs/phase2-dry-run-reconciliation-2026-09-21.json", "tests/approved-operational-hashes.mjs", "tests/live-backend-parity.mjs", "tests/release-synchronization.test.mjs", "server/acknowledgement-source.js", "server/google-ads-outcome-collection.js", "server/google-ads-outcome-watcher.js", "server/jobber-acknowledgement-resolver.js", "server/jobber-contact-resolver.js", "server/jobber-quo-intake.js", "server/quo-client-name.js", "tests/fixtures/acknowledgement-sources.sql", "tests/fixtures/quo-intake-operations.sql", "tests/google-ads-outcome-watcher.test.mjs", "tests/jobber-acknowledgement-resolver.test.mjs", "tests/jobber-quo-intake.test.mjs", "tests/live-backend-parity.mjs", "tests/quo-client-name.test.mjs", "migrations/0008_quo_call_attributions.sql", "migrations/0009_google_ads_outcome_outbox.sql"]);
  const baseline = files(synchronizedRelease);
  const current = git("ls-files", "--cached", "--others", "--exclude-standard").toString().trim().split("\n");
  const baselineSet = new Set(baseline);
  const currentExtras = [...new Set(current)].filter(file => !baselineSet.has(file)).sort();
  assert.deepEqual(currentExtras, ["PHASE2-GOOGLE-ADS-OUTCOME-WATCHER.md", "migrations/0009_google_ads_outcome_outbox.sql", "outputs/phase2-dry-run-reconciliation-2026-09-21.json", "server/acknowledgement-source.js", "server/google-ads-outcome-collection.js", "server/google-ads-outcome-watcher.js", "server/jobber-acknowledgement-resolver.js", "server/jobber-contact-resolver.js", "server/quo-client-name.js", "tests/fixtures/acknowledgement-sources.sql", "tests/fixtures/quo-intake-operations.sql", "tests/google-ads-outcome-watcher.test.mjs", "tests/jobber-acknowledgement-resolver.test.mjs", "tests/live-backend-parity.mjs", "tests/quo-client-name.test.mjs", "tests/release-synchronization.test.mjs"]);
  for (const file of baseline.filter(file => !allowed.has(file))) assert.deepEqual(read(file), synchronized(file), file);
});
