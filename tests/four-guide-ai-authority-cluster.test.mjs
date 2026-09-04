import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteOrigin = "https://goodattic.energy";

const guides = [
  {
    slug: "attic-insulation-removal-after-mice",
    title: "Remove Attic Insulation After Mice? | Good Attic",
    description:
      "Learn when attic insulation should be removed after mice, why covering contamination is not enough, and what full attic remediation involves.",
    h1: "Does Attic Insulation Need to Be Removed After Mice?",
  },
  {
    slug: "bat-guano-attic-insulation-removal",
    title: "Bat Guano in Attic Insulation: Should It Be Removed? | Good Attic",
    description:
      "Learn when bat guano in attic insulation calls for removal, why properly timed exclusion comes first, and when specialized cleanup may be needed.",
    h1: "What Should Happen When Bat Guano Reaches Attic Insulation?",
  },
  {
    slug: "wet-attic-insulation-remove-or-dry",
    title: "Wet Attic Insulation: Remove It or Let It Dry? | Good Attic",
    description:
      "Learn when wet attic insulation may dry, when removal makes sense, and why the moisture source and nearby attic materials should be checked first.",
    h1: "Wet Attic Insulation: Can It Dry, or Does It Need to Be Removed?",
  },
  {
    slug: "replace-attic-insulation-when-replacing-roof",
    title: "Should You Replace Attic Insulation With a New Roof? | Good Attic",
    description:
      "Learn when attic insulation should be replaced with a new roof, when it can stay, and how roofing and attic work should be coordinated.",
    h1: "Replacing Your Roof? Should You Replace the Attic Insulation Too?",
  },
].map((guide) => ({
  ...guide,
  route: `/resources/${guide.slug}/`,
  canonical: `${siteOrigin}/resources/${guide.slug}/`,
  file: path.join(projectDirectory, "resources", guide.slug, "index.html"),
}));

const protectedHashes = {
  "resources/blown-insulation-vs-rolled-insulation/index.html":
    "c9058348700a5cea915f64be7fd4a5f854fcc1c94c98b6d9ace1df677dad36f3",
  "resources/attic-air-sealing-vs-more-insulation/index.html":
    "d521de9dbc9fd5e4127b4f0df4d23bb9d44095afd79c1b0ea4f24b9678f8e4b6",
  "resources/insulation-removal-vs-top-off/index.html":
    "93183ee1fdd10eca6640dd383b74aab7dcec505a7f4d480ad9f7eb2825b4c837",
  "resources/spray-foam-vs-blown-in-attic-insulation/index.html":
    "a7564079b4196566039d20d93a6fe0f5c0fd4f3a73eed20fa1de70ebc4ffed33",
  "resources/signs-of-attic-pest-contamination/index.html":
    "f9ec6ad9fc411ce5b90b4b3265d917673f6c2555dfe7eff596c80b65eef76345",
  "styles.css": "cc591cb9e147c9d203887467bbea11ffe79064190509604e7fa127062d2b3fa7",
  "script.js": "f286af88aa58394f2bcfa9c6487c8cee86cbead3ea15f1f819355f990ba895aa",
  "functions/_middleware.js":
    "0da797087cc6bacfca6b9c1a863df2a489290628380bfdc242e7cf89b537f720",
  "functions/api/leads.js":
    "a54a672701aa40df93d476143ba608d768c2cc78b3758ecaa46141c68b77cd54",
};

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
}

function textContent(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function schemaRecords(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]))
    .flatMap((record) => (Array.isArray(record["@graph"]) ? record["@graph"] : [record]));
}

function extractBlock(html, start, end) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `Missing block start: ${start}`);
  assert.notEqual(endIndex, -1, `Missing block end: ${end}`);
  return html.slice(startIndex, endIndex + end.length);
}

function localFileFromUrl(url) {
  const parsed = new URL(url);
  const pathname = decodeURIComponent(parsed.pathname);
  if (pathname === "/") return path.join(projectDirectory, "index.html");
  if (pathname.endsWith("/")) {
    return path.join(projectDirectory, pathname.slice(1), "index.html");
  }
  return path.join(projectDirectory, pathname.slice(1));
}

test("the four guides expose the approved metadata and schema", async () => {
  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    assert.match(html, new RegExp(`<title>${guide.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
    assert.ok(html.includes(`<meta name="description" content="${guide.description}">`));
    assert.ok(html.includes(`<link rel="canonical" href="${guide.canonical}">`));
    assert.ok(html.includes(`<h1>${guide.h1}</h1>`));

    const records = schemaRecords(html);
    const article = records.find((record) => record["@type"] === "Article");
    const breadcrumbs = records.find((record) => record["@type"] === "BreadcrumbList");
    const faq = records.find((record) => record["@type"] === "FAQPage");
    assert.ok(article, `${guide.slug} is missing Article schema`);
    assert.ok(breadcrumbs, `${guide.slug} is missing BreadcrumbList schema`);
    assert.ok(faq, `${guide.slug} is missing FAQPage schema`);
    assert.equal(article.headline, guide.h1);
    assert.equal(article.url, guide.canonical);
    assert.equal(article.mainEntityOfPage, guide.canonical);
    assert.equal(breadcrumbs.itemListElement.at(-1).item, guide.canonical);
    assert.equal(records.some((record) => record["@type"] === "QAPage"), false);

    const visibleFaqs = [...html.matchAll(/<details class="faq-item reveal">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map(
      (match) => ({ question: textContent(match[1]), answer: textContent(match[2]) }),
    );
    const structuredFaqs = faq.mainEntity.map((item) => ({
      question: item.name,
      answer: item.acceptedAnswer.text,
    }));
    assert.ok(visibleFaqs.length >= 3 && visibleFaqs.length <= 5);
    assert.deepEqual(visibleFaqs, structuredFaqs);
  }
});

test("new-guide internal links and images resolve locally", async () => {
  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    const localUrls = [...html.matchAll(/href="([^"]+)"/g)]
      .map((match) => new URL(match[1], guide.canonical))
      .filter((url) => url.origin === siteOrigin && !url.pathname.startsWith("/api/"));
    const localImages = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(
      (match) => new URL(match[1], guide.canonical),
    );

    for (const url of [...localUrls, ...localImages]) {
      await access(localFileFromUrl(url));
    }
  }
});

test("the resource hub and sitemap contain each new route once", async () => {
  const hub = await readFile(path.join(projectDirectory, "resources", "index.html"), "utf8");
  const sitemap = await readFile(path.join(projectDirectory, "sitemap.xml"), "utf8");

  for (const guide of guides) {
    assert.equal(hub.split(`href="${guide.slug}/"`).length - 1, 1);
    assert.equal(sitemap.split(`<loc>${guide.canonical}</loc>`).length - 1, 1);
  }
});

test("protected pages and operational assets remain byte-identical to production baseline 64ee206", async () => {
  for (const [relativePath, expectedHash] of Object.entries(protectedHashes)) {
    const contents = await readFile(path.join(projectDirectory, relativePath));
    const actualHash = createHash("sha256").update(contents).digest("hex");
    assert.equal(actualHash, expectedHash, `${relativePath} changed from the protected baseline`);
  }
});

test("new guides preserve the production header, footer, modal, tracking, and form contract", async () => {
  const baseline = await readFile(
    path.join(projectDirectory, "resources", "blown-insulation-vs-rolled-insulation", "index.html"),
    "utf8",
  );
  const stableBlocks = [
    ["<header class=\"site-header\"", "</header>"],
    ["<footer class=\"footer\">", "</footer>"],
    ["<div class=\"modal\"", "</div>\n  \n  <script src=\"../../script.js"],
    ["<!-- Google tag (gtag.js) -->", "<link rel=\"stylesheet\" href=\"../../styles.css?v=legal-20260713a\">"],
  ];

  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    for (const [start, end] of stableBlocks) {
      assert.equal(extractBlock(html, start, end), extractBlock(baseline, start, end));
    }
    assert.ok(html.includes('data-lead-endpoint="/api/leads"'));
    assert.ok(html.includes("window.goodAtticGoogleTagConfigured = true"));
    assert.ok(html.includes("window.goodAtticPhoneConversionNumbersConfigured = true"));
  }
});

test("new guides keep promotional controls late and exclude prohibited editorial language", async () => {
  const prohibited = /approved scope|remediation pathway|specialist boundary|confirmed safely accessible work area|subject to|where included|cannot guarantee|does not promise|no claim is made|documented conditions across the accessible attic/i;

  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    const main = extractBlock(html, "<main class=\"page-main\">", "</main>");
    const hero = extractBlock(main, '<section class="section page-hero">', "</section>");
    assert.equal(hero.includes("page-hero__actions"), false);
    assert.equal(main.includes("Financing Options"), false);
    assert.ok(main.includes("Request an Attic Assessment"));
    assert.doesNotMatch(textContent(main), prohibited);
  }
});
