import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectDirectory, "dist");

const publicEntries = [
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
  "script.79eca18f8a153d62.js",
  "script.8c577120c8f5bbb0.js",
  "script.488eaabd8e623d5d.js",
  "script.40559d41a6b61dc2.js",
  "services",
  "site.webmanifest",
  "sitemap.xml",
  "st-louis-mo",
  "styles.css",
  "styles.72e38ccd660523f9.css",
  "terms-of-service",
];

const allowedNestedFileExtensions = new Set([
  ".avif",
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".mp4",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
]);

async function assertSafePublicTree(sourcePath, explicitEntry = false) {
  const stats = await lstat(sourcePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to publish symbolic link: ${sourcePath}`);
  }
  if (!explicitEntry && path.basename(sourcePath).startsWith(".")) {
    throw new Error(`Refusing to publish hidden entry: ${sourcePath}`);
  }
  if (!stats.isDirectory()) {
    if (
      !explicitEntry
      && !allowedNestedFileExtensions.has(path.extname(sourcePath).toLowerCase())
    ) {
      throw new Error(`Refusing to publish unexpected file type: ${sourcePath}`);
    }
    return;
  }

  const children = await readdir(sourcePath);
  await Promise.all(
    children.map((child) => assertSafePublicTree(path.join(sourcePath, child))),
  );
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of publicEntries) {
  const source = path.join(projectDirectory, entry);
  const destination = path.join(outputDirectory, entry);
  await assertSafePublicTree(source, true);
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
  });
}

// The live pages load the content-addressed script, not the legacy /script.js.
// Keep that exact live asset as the default build output. A later edit to the
// canonical source creates a new hashed asset and changes only the copied HTML
// and headers, so it cannot accidentally publish the older legacy script.
const deliveryManifest = JSON.parse(await readFile(
  path.join(projectDirectory, "scripts/asset-delivery-manifest.json"), "utf8",
));
const liveScriptName = deliveryManifest?.js?.to;
if (!/^script\.[a-f0-9]{16}\.js$/.test(liveScriptName || "")) {
  throw new Error("Asset manifest does not identify the live active script.");
}
const canonicalScript = await readFile(path.join(projectDirectory, "src/site-interactions.js"));
const scriptHash = createHash("sha256").update(canonicalScript).digest("hex").slice(0, 16);
const candidateScriptName = `script.${scriptHash}.js`;
if (candidateScriptName === liveScriptName) {
  const copiedLiveScript = await readFile(path.join(outputDirectory, liveScriptName));
  if (!copiedLiveScript.equals(canonicalScript)) {
    throw new Error("Canonical active script differs from the live hashed asset.");
  }
} else {
  await writeFile(path.join(outputDirectory, candidateScriptName), canonicalScript);
  let changedReferences = 0;
  async function updateScriptReferences(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await updateScriptReferences(target);
      } else if (entry.name.endsWith(".html")) {
        const before = await readFile(target, "utf8");
        const occurrences = before.split(liveScriptName).length - 1;
        if (occurrences) {
          changedReferences += occurrences;
          await writeFile(target, before.split(liveScriptName).join(candidateScriptName));
        }
      }
    }
  }
  await updateScriptReferences(outputDirectory);
  if (changedReferences === 0) {
    throw new Error("No HTML pages reference the active script; refusing to publish an unused edit.");
  }
  const headersPath = path.join(outputDirectory, "_headers");
  const headers = await readFile(headersPath, "utf8");
  await writeFile(headersPath, `${headers.trimEnd()}\n\n/${candidateScriptName}\n  Cache-Control: public, max-age=31536000, immutable\n`);
}

const builtEntries = (await readdir(outputDirectory)).sort();
const expectedEntries = [...publicEntries];
if (candidateScriptName !== liveScriptName) expectedEntries.push(candidateScriptName);
expectedEntries.sort();
if (JSON.stringify(builtEntries) !== JSON.stringify(expectedEntries)) {
  throw new Error("Pages output contains an entry outside the public allowlist.");
}

console.log(`Built ${builtEntries.length} public entries in ${outputDirectory}`);
