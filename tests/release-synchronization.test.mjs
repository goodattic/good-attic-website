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

test("synchronization imports only the exact reviewed four-file live backend patch", () => {
  assert.deepEqual(git("diff", "--name-only", `${liveCommit}^`, liveCommit).toString().trim().split("\n").sort(), [...liveBackendFiles].sort());
  for (const file of liveBackendFiles) assert.deepEqual(read(file), git("show", `${liveCommit}:${file}`), file);
  const allowed = new Set(synchronizationFiles);
  for (const file of files(releaseParent).filter(file => !allowed.has(file))) {
    assert.deepEqual(read(file), git("show", `${releaseParent}:${file}`), file);
  }
  const previous = new Set(files(releaseParent));
  const current = git("ls-files", "--cached", "--others", "--exclude-standard").toString().trim().split("\n");
  assert.deepEqual(current.filter(file => !previous.has(file)).sort(), ["tests/live-backend-parity.mjs", "tests/quo-phone-display.test.mjs", "tests/release-synchronization.test.mjs"]);
});

test("all live operations are retained with only the approved release receipt timeout", () => {
  const releaseOnly = ["functions/api/leads.js", "server/acknowledgement-source.js"];
  const operational = file => /^(functions|server|migrations)\//.test(file) || file === "wrangler.toml";
  assert.deepEqual(files(releaseParent).filter(operational).sort(), files(liveCommit).filter(operational).sort());
  for (const file of files(liveCommit).filter(operational)) {
    const source = releaseOnly.includes(file) ? releaseParent : liveCommit;
    assert.deepEqual(read(file), git("show", `${source}:${file}`), file);
  }
  assert.match(read("server/acknowledgement-source.js").toString(), /ACKNOWLEDGEMENT_RECEIPT_WAIT_MS = 2000/);
});

test("only two live-patch hash expectations advance; all unrelated expectations remain fixed", () => {
  const previousSource = git("show", `${releaseParent}:tests/approved-operational-hashes.mjs`).toString();
  const previous = JSON.parse(previousSource.slice(previousSource.indexOf("{")).replace(/;\s*$/, "").replace(/,\s*}/, "}"));
  const expected = { ...previous };
  for (const file of ["server/jobber-quo-intake.js", "tests/jobber-quo-intake.test.mjs"]) {
    expected[file] = createHash("sha256").update(git("show", `${liveCommit}:${file}`)).digest("hex");
  }
  assert.deepEqual(approvedOperationalHashes, expected);
});
