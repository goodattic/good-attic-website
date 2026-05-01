import { access, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const INDEXNOW_KEY = "d6a3ebfa-57b3-4b13-b2f9-c9052cbc9008";

const requiredFiles = [
  "index.html",
  "styles.css",
  "script.js",
  "robots.txt",
  "sitemap.xml",
  "seo-wave1-page-data.json",
  "data/proof/approved-review-excerpts.json",
  "data/proof/documented-project-proof.json",
  `${INDEXNOW_KEY}.txt`
];

function ok(message) {
  console.log(`OK   ${message}`);
}

function warn(message) {
  console.log(`WARN ${message}`);
}

function fail(message) {
  console.log(`FAIL ${message}`);
}

async function fileExists(relativePath) {
  try {
    await access(path.join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function extractBaseUrl(buildFile) {
  const match = buildFile.match(/baseUrl:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

async function main() {
  console.log("Good Attic launch readiness check\n");

  let failed = false;

  for (const relativePath of requiredFiles) {
    if (await fileExists(relativePath)) {
      ok(`Found ${relativePath}`);
    } else {
      fail(`Missing ${relativePath}`);
      failed = true;
    }
  }

  const buildFile = await readFile(path.join(projectRoot, "build-seo-wave1.mjs"), "utf8");
  const robots = await readFile(path.join(projectRoot, "robots.txt"), "utf8");
  const sitemap = await readFile(path.join(projectRoot, "sitemap.xml"), "utf8");
  const pages = JSON.parse(await readFile(path.join(projectRoot, "seo-wave1-page-data.json"), "utf8"));
  const reviewData = JSON.parse(await readFile(path.join(projectRoot, "data/proof/approved-review-excerpts.json"), "utf8"));
  const proofData = JSON.parse(await readFile(path.join(projectRoot, "data/proof/documented-project-proof.json"), "utf8"));

  const baseUrl = extractBaseUrl(buildFile);
  if (baseUrl === "https://goodattic.energy") {
    ok("Canonical base URL is set to https://goodattic.energy");
  } else {
    fail(`Canonical base URL is not launch-ready: ${baseUrl || "missing"}`);
    failed = true;
  }

  const requiredRobotsRules = [
    "User-agent: OAI-SearchBot",
    "User-agent: GPTBot",
    "User-agent: Googlebot",
    "User-agent: Bingbot",
    "Sitemap: https://goodattic.energy/sitemap.xml"
  ];

  for (const rule of requiredRobotsRules) {
    if (robots.includes(rule)) ok(`robots.txt contains "${rule}"`);
    else {
      fail(`robots.txt is missing "${rule}"`);
      failed = true;
    }
  }

  if (sitemap.includes("<urlset") && sitemap.includes("https://goodattic.energy/")) {
    ok("sitemap.xml contains launch domain URLs");
  } else {
    fail("sitemap.xml does not look launch-ready");
    failed = true;
  }

  if (buildFile.includes('meta name="theme-color"')) {
    ok("Generated pages include share/theme metadata");
  } else {
    warn("Could not confirm share/theme metadata in generator");
  }

  if (buildFile.includes("contactPoint")) {
    ok("Organization schema includes contactPoint data");
  } else {
    fail("Organization schema is missing contactPoint data");
    failed = true;
  }

  if (buildFile.includes("Best next pages")) {
    ok("Shared related-page routing is present");
  } else {
    warn("Could not confirm related-page routing module");
  }

  const reviewCount = Array.isArray(reviewData.items) ? reviewData.items.length : 0;
  const proofCount = Array.isArray(proofData.items) ? proofData.items.length : 0;

  if (reviewCount > 0) ok(`Approved review excerpts loaded: ${reviewCount}`);
  else warn("No approved review excerpts loaded yet");

  if (proofCount > 0) ok(`Documented project proof items loaded: ${proofCount}`);
  else warn("No documented project proof items loaded yet");

  const pageTypeCounts = countBy(pages, "page_type");
  console.log("\nPage inventory:");
  for (const [type, count] of Object.entries(pageTypeCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`- ${type}: ${count}`);
  }

  console.log("\nOwner-only launch tasks:");
  console.log("- Point goodattic.energy at Cloudflare Pages production.");
  console.log("- Verify the domain in Google Search Console and Bing Webmaster Tools.");
  console.log("- Submit the sitemap in both webmaster tools.");
  console.log("- Confirm Cloudflare is not blocking Googlebot, Bingbot, or OAI-SearchBot.");
  console.log("- Load the first approved review excerpts and project evidence into data/proof/*.json.");
  console.log("- Confirm GHL_WEBHOOK_URL is set in Cloudflare Pages production.");

  console.log(failed ? "\nLaunch check finished with failures." : "\nLaunch check finished without blocking failures.");
  process.exitCode = failed ? 1 : 0;
}

await main();
