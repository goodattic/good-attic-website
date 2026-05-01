import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const INDEXNOW_KEY = "d6a3ebfa-57b3-4b13-b2f9-c9052cbc9008";
const DEFAULT_HOST = "https://goodattic.energy";

function usage() {
  console.log("Usage: node scripts/submit-indexnow.mjs [https://goodattic.energy]");
}

function urlsFromSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

async function main() {
  const targetHost = process.argv[2] || DEFAULT_HOST;
  if (!/^https?:\/\//.test(targetHost)) {
    usage();
    process.exit(1);
  }

  const sitemapXml = await readFile(path.join(projectRoot, "sitemap.xml"), "utf8");
  const urlList = urlsFromSitemap(sitemapXml).filter((url) => url.startsWith(targetHost));

  if (!urlList.length) {
    throw new Error(`No sitemap URLs matched ${targetHost}`);
  }

  const payload = {
    host: new URL(targetHost).host,
    key: INDEXNOW_KEY,
    keyLocation: `${targetHost}/${INDEXNOW_KEY}.txt`,
    urlList
  };

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`IndexNow submission failed with ${response.status} ${response.statusText}`);
  }

  console.log(`Submitted ${urlList.length} URLs to IndexNow for ${targetHost}`);
}

await main();
