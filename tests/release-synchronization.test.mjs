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

const currentBaseline = JSON.parse(read("tests/qualified-phone-release-baseline.json"));
test("current deployment baseline protects every existing file outside the phone-stage patch", () => {
  assert.equal(currentBaseline.cloudflareVersion, "ee7cce66-ff07-4bd6-81e2-e526214e4158");
  for (const [file, hash] of Object.entries(currentBaseline.protectedHashes)) assert.equal(sha(read(file)), hash, file);
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

test("only the reviewed phone-stage files and release evidence differ from the current live baseline", () => {
  for (const [file,hash] of Object.entries(currentBaseline.approvedHashes)) assert.equal(sha(read(file)),hash,file);
  const current = [...new Set(git("ls-files","--cached","--others","--exclude-standard").toString().trim().split("\n"))].sort();
  const expected = [...new Set([...Object.keys(currentBaseline.protectedHashes),...Object.keys(currentBaseline.approvedHashes),"tests/qualified-phone-release-baseline.json","tests/release-synchronization.test.mjs"])].sort();
  assert.deepEqual(current,expected);
});
