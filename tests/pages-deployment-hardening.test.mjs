import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { onRequest as middleware } from "../functions/_middleware.js";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(projectDirectory, "dist");

const expectedPublicEntries = [
  "404.html",
  "_headers",
  "_redirects",
  "about",
  "assets",
  "contact",
  "d6a3ebfa-57b3-4b13-b2f9-c9052cbc9008.txt",
  "financing",
  "index.html",
  "kansas-city-mo",
  "llms.txt",
  "locations",
  "privacy-policy",
  "resources",
  "reviews",
  "robots.txt",
  "salt-lake-city-ut",
  "script.js",
  "services",
  "site.webmanifest",
  "sitemap.xml",
  "st-louis-mo",
  "styles.css",
  "terms-of-service",
];

test("Pages build publishes only the explicit public allowlist", async () => {
  execFileSync(process.execPath, ["scripts/build-pages-output.mjs"], {
    cwd: projectDirectory,
    stdio: "pipe",
  });

  assert.deepEqual(
    (await readdir(outputDirectory)).sort(),
    [...expectedPublicEntries].sort(),
  );

  for (const internalEntry of [
    "data",
    "functions",
    "migrations",
    "scripts",
    "tests",
    "wrangler.toml",
    "README.md",
    "LAUNCH-CHECKLIST.md",
  ]) {
    await assert.rejects(access(path.join(outputDirectory, internalEntry)));
  }
});

test("preview API requests fail closed before any route handler runs", async () => {
  let nextCalled = false;
  const blocked = await middleware({
    request: new Request("https://preview.example.test/api/leads", {
      method: "POST",
    }),
    env: {
      EXTERNAL_API_WRITES_ENABLED: "false",
    },
    next: async () => {
      nextCalled = true;
      return new Response("unexpected");
    },
  });

  assert.equal(blocked.status, 503);
  assert.deepEqual(await blocked.json(), {
    ok: false,
    status: "external_api_writes_disabled",
  });
  assert.equal(nextCalled, false);
});

test("production API writes and the read-only site config route pass through", async () => {
  const expected = new Response("next");
  const production = await middleware({
    request: new Request("https://goodattic.energy/api/leads", {
      method: "POST",
    }),
    env: {
      EXTERNAL_API_WRITES_ENABLED: "true",
    },
    next: async () => expected,
  });
  assert.equal(production, expected);

  const previewSiteConfig = await middleware({
    request: new Request("https://preview.example.test/api/site-config"),
    env: {
      EXTERNAL_API_WRITES_ENABLED: "false",
    },
    next: async () => expected,
  });
  assert.equal(previewSiteConfig, expected);
});

test("Wrangler uses clean output and explicitly disables preview writes", async () => {
  const wrangler = await readFile(
    path.join(projectDirectory, "wrangler.toml"),
    "utf8",
  );
  assert.match(wrangler, /pages_build_output_dir = "dist"/);
  assert.match(
    wrangler,
    /\[env\.production\.vars\][\s\S]*EXTERNAL_API_WRITES_ENABLED = "true"/,
  );
  assert.match(
    wrangler,
    /\[env\.preview\.vars\][\s\S]*EXTERNAL_API_WRITES_ENABLED = "false"/,
  );
  assert.match(
    wrangler,
    /\[env\.production\.vars\][\s\S]*FIELDFLOW_ATTRIBUTION_BASE_URL = "https:\/\/fieldflow\.goodattic\.energy\/api\/integrations\/highlevel\/lead-attribution"/,
  );
  assert.match(
    wrangler,
    /\[env\.preview\.vars\][\s\S]*FIELDFLOW_ATTRIBUTION_BASE_URL = ""/,
  );
  assert.match(
    wrangler,
    /\[env\.preview\][\s\S]*kv_namespaces = \[\][\s\S]*d1_databases = \[\]/,
  );
  assert.match(
    wrangler,
    /\[\[env\.production\.kv_namespaces\]\][\s\S]*binding = "JOBBER_TOKEN_STORE"/,
  );
  assert.match(
    wrangler,
    /\[\[env\.production\.d1_databases\]\][\s\S]*binding = "ANGI_ROUTER_DB"/,
  );
});
