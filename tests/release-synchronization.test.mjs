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
const synchronizedRelease = "754f66cb8df0b8871b14b632804308b2ed19e9b6";
const synchronized = file => git("show", `${synchronizedRelease}:${file}`);
const permissionFixFiles = ["server/jobber-quo-intake.js", "tests/jobber-quo-intake.test.mjs"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("the frozen synchronization imported only the exact reviewed four-file live backend patch", () => {
  assert.deepEqual(git("diff", "--name-only", `${liveCommit}^`, liveCommit).toString().trim().split("\n").sort(), [...liveBackendFiles].sort());
  for (const file of liveBackendFiles) assert.deepEqual(synchronized(file), git("show", `${liveCommit}:${file}`), file);
  const allowed = new Set(synchronizationFiles);
  for (const file of files(releaseParent).filter(file => !allowed.has(file))) {
    assert.deepEqual(read(file), git("show", `${releaseParent}:${file}`), file);
  }
  const previous = new Set(files(releaseParent));
  const current = git("ls-files", "--cached", "--others", "--exclude-standard").toString().trim().split("\n");
  assert.deepEqual(current.filter(file => !previous.has(file)).sort(), ["tests/live-backend-parity.mjs", "tests/quo-phone-display.test.mjs", "tests/release-synchronization.test.mjs"]);
});

test("the frozen synchronization retained all live operations with only the approved release receipt timeout", () => {
  const releaseOnly = ["functions/api/leads.js", "server/acknowledgement-source.js"];
  const operational = file => /^(functions|server|migrations)\//.test(file) || file === "wrangler.toml";
  assert.deepEqual(files(releaseParent).filter(operational).sort(), files(liveCommit).filter(operational).sort());
  for (const file of files(liveCommit).filter(operational)) {
    const source = releaseOnly.includes(file) ? releaseParent : liveCommit;
    assert.deepEqual(synchronized(file), git("show", `${source}:${file}`), file);
  }
  assert.match(read("server/acknowledgement-source.js").toString(), /ACKNOWLEDGEMENT_RECEIPT_WAIT_MS = 2000/);
});

test("historical live-patch hashes remain proven; only the two reviewed permission-fix hashes advance", () => {
  const previousSource = git("show", `${releaseParent}:tests/approved-operational-hashes.mjs`).toString();
  const previous = JSON.parse(previousSource.slice(previousSource.indexOf("{")).replace(/;\s*$/, "").replace(/,\s*}/, "}"));
  const expected = { ...previous };
  for (const file of ["server/jobber-quo-intake.js", "tests/jobber-quo-intake.test.mjs"]) {
    expected[file] = createHash("sha256").update(git("show", `${liveCommit}:${file}`)).digest("hex");
  }
  const historicalSource = synchronized("tests/approved-operational-hashes.mjs").toString();
  const historical = JSON.parse(historicalSource.slice(historicalSource.indexOf("{")).replace(/;\s*$/, "").replace(/,\s*}/, "}"));
  assert.deepEqual(historical, expected);
  assert.deepEqual(Object.keys(approvedOperationalHashes), Object.keys(historical));
  for (const [file, hash] of Object.entries(approvedOperationalHashes)) {
    if (permissionFixFiles.includes(file)) {
      assert.notEqual(hash, historical[file], file);
      assert.equal(sha(read(file)), hash, file);
    } else assert.equal(hash, historical[file], file);
  }
});

test("the current release changes only the exact approved broker patch, focused tests and two release guards", () => {
  const allowed = new Set([...permissionFixFiles, "tests/approved-operational-hashes.mjs", "tests/release-synchronization.test.mjs"]);
  const baseline = files(synchronizedRelease);
  const current = git("ls-files", "--cached", "--others", "--exclude-standard").toString().trim().split("\n");
  assert.deepEqual([...new Set(current)].sort(), baseline.sort());
  for (const file of baseline.filter(file => !allowed.has(file))) assert.deepEqual(read(file), synchronized(file), file);
  for (const file of permissionFixFiles) assert.equal(sha(read(file)), approvedOperationalHashes[file], file);
});
