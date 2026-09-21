import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  homepageBaseline,
  homepageBaselineSha256,
  homepageChanges,
  homepageCleanupAddedTests,
  homepageCleanupAdaptedTests,
  homepageNodes,
  replaceHomepageNodes,
  beforeHomepageCleanup,
} from "./homepage-cleanup-helpers.mjs";

const root = new URL("../", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const read = file => readFileSync(new URL(file, root));
const original = file => git("show", `${homepageBaseline}:${file}`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const baselineHtml = original("index.html").toString();
const currentHtml = read("index.html").toString();
const baselineFiles = git("ls-tree", "-r", "--name-only", homepageBaseline).toString().trim().split("\n");

// These four patches only reverse the seven approved homepage strings for
// historical comparisons and admit the exact two new test files. Their fixed
// digests prevent the historical exceptions from silently growing in scope.
const historicalGuardHashes = {
  "tests/asset-delivery.test.mjs": {
    before: "ef22f2fc5f0568a12d22b38d24b8793538a6881f0b51aaed18066a42573defe3",
    after: "06556fab4e922fe1d7eb8be938a92c78d862a84e9babb8f918b026a76b73ee0d",
  },
  "tests/modal-focus.test.mjs": {
    before: "cde4dd5e055414fffefbec50055d6cccb2953c10b08f18b3fdaf240d8df5cdef",
    after: "2bc717e2ef04ea86ee8ced40dfa21133a8693ffc252e3dbcb8ba38d22d2b71be",
  },
  "tests/protected-guide-header.test.mjs": {
    before: "5078c680f0b9e61f498c9c4049a27d7e548fb11d863d55868a3b735350a96f55",
    after: "dcf66af673ec6bb309e866ec6f09cf256275b26c0d8f13a086cd039d14106303",
  },
  "tests/release-synchronization.test.mjs": {
    before: "fb2fdfae745c31f72dfc79efe1448646125e857f68c8e17f83329b6b16003801",
    after: "1745ca116226d837833ead0616c21885a45868ecdc06b09b386220c357768f92",
  },
};

test("homepage cleanup starts from the verified production source and changes exactly seven plain-text nodes", () => {
  assert.equal(homepageBaseline, "6839180050b3f4df6033f41bf3a80c50de42ff2e");
  assert.equal(sha(original("index.html")), homepageBaselineSha256);
  assert.deepEqual(homepageChanges.map(change => change.id), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.equal(new Set(homepageChanges.map(change => change.selector)).size, 7);
  const before = homepageNodes(baselineHtml, "before");
  const after = homepageNodes(currentHtml, "after");
  assert.equal(new Set(after.map(item => item.start)).size, 7);
  for (let i = 0; i < before.length; i++) {
    const change = homepageChanges[i];
    assert.equal(baselineHtml.split(change.before).length - 1, 1, change.id);
    assert.equal(currentHtml.split(change.after).length - 1, 1, change.id);
    assert.equal(currentHtml.includes(change.before), false, change.id);
    assert.equal(before[i].node.name, after[i].node.name, `${change.id}: element type`);
    assert.deepEqual(before[i].node.attribs, after[i].node.attribs, `${change.id}: attributes`);
  }
});

test("reversing only the seven approved text nodes restores every homepage byte", () => {
  assert.equal(replaceHomepageNodes(baselineHtml, "before", "after"), currentHtml);
  const reversed = replaceHomepageNodes(currentHtml, "after", "before");
  assert.equal(reversed, baselineHtml);
  assert.deepEqual(Buffer.from(reversed), original("index.html"));
  assert.equal(sha(reversed), homepageBaselineSha256);
  const protectedWording = "Photo-based attic assessments for homeowners who want a clear plan.";
  assert.equal(baselineHtml.split(protectedWording).length - 1, 1);
  assert.equal(currentHtml.split(protectedWording).length - 1, 1);
});

test("historical homepage reversal rejects missing, conflicting or ambiguous nodes and is inert on other files", () => {
  for (const change of homepageChanges) {
    assert.throws(() => beforeHomepageCleanup(currentHtml.replace(change.after, "Unexpected replacement"), "index.html"), /exact after text/);
  }
  const contact = `<p class="contact-note">${homepageChanges.find(change => change.id === "E").after}</p>`;
  assert.throws(() => beforeHomepageCleanup(currentHtml.replace(contact, contact + contact), "index.html"), /unique intended node/);
  assert.throws(() => beforeHomepageCleanup(currentHtml.replace(contact, ""), "index.html"), /unique intended node/);
  assert.throws(() => beforeHomepageCleanup(baselineHtml, "index.html"), /exact after text/);
  for (const file of ["resources/index.html", "salt-lake-city-ut/index.html", "script.js", "styles.css", "server/jobber-quo-intake.js"]) {
    const untouched = read(file).toString();
    assert.equal(beforeHomepageCleanup(untouched, file), untouched, file);
  }
});

test("every other tracked file and every operational source retain exact production bytes", () => {
  const approved = new Set(["index.html", ...homepageCleanupAdaptedTests]);
  const currentFiles = git("ls-files", "--cached", "--others", "--exclude-standard").toString().trim().split("\n");
  assert.deepEqual([...new Set(currentFiles)].sort(), [...baselineFiles, ...homepageCleanupAddedTests].sort());
  for (const file of baselineFiles.filter(file => !approved.has(file))) {
    assert.deepEqual(read(file), original(file), file);
  }
  const operations = file => /^(functions|server|migrations|workers)\//.test(file) || file === "wrangler.toml";
  assert.equal([...approved].some(operations), false);
  assert.equal(homepageCleanupAddedTests.some(file => !file.startsWith("tests/")), false);
});

test("the four historical guard adaptations remain exact and all their existing tests remain present", () => {
  assert.deepEqual([...homepageCleanupAdaptedTests].sort(), Object.keys(historicalGuardHashes).sort());
  assert.deepEqual(homepageCleanupAddedTests, ["tests/homepage-cleanup-helpers.mjs", "tests/homepage-cleanup.test.mjs"]);
  for (const [file, hashes] of Object.entries(historicalGuardHashes)) {
    const before = original(file), after = read(file);
    assert.equal(sha(before), hashes.before, `${file}: baseline guard`);
    assert.equal(sha(after), hashes.after, `${file}: exact reviewed guard adaptation`);
    const testNames = bytes => [...bytes.toString().matchAll(/^test\("([^"]+)"/gm)].map(match => match[1]);
    assert.deepEqual(testNames(after), testNames(before), file);
    assert.doesNotMatch(after.toString(), /\btest\.(?:skip|todo|only)\b/);
  }
});
