import {
  cp,
  lstat,
  mkdir,
  readdir,
  rm,
} from "node:fs/promises";
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
  "services",
  "site.webmanifest",
  "sitemap.xml",
  "st-louis-mo",
  "styles.css",
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

const builtEntries = (await readdir(outputDirectory)).sort();
const expectedEntries = [...publicEntries].sort();
if (JSON.stringify(builtEntries) !== JSON.stringify(expectedEntries)) {
  throw new Error("Pages output contains an entry outside the public allowlist.");
}

console.log(`Built ${builtEntries.length} public entries in ${outputDirectory}`);
