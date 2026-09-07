import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadWarmGuidePackage } from "../scripts/load-warm-guide-copy.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteOrigin = "https://goodattic.energy";
const exactPackage = await loadWarmGuidePackage(path.join(projectDirectory, "content", "warm-guides"));
const guides = exactPackage.pages.map((page) => ({
  ...page,
  route: page.url,
  title: page.seo_title,
  description: page.meta_description,
  canonical: page.canonical_url,
  faqHeading: page.faq_heading,
  file: path.join(projectDirectory, "resources", page.slug, "index.html"),
}));

const protectedHashes = {
  "resources/blown-insulation-vs-rolled-insulation/index.html":
    "334ecb46a85203bd0af707fc015cd28cd7838f976a49bf14cbddf197ce763c85",
  "resources/attic-air-sealing-vs-more-insulation/index.html":
    "89ff74c234c7dc4d4e588ee61ceebc5a5f0b83f6660ee229b3558523a8fcddf1",
  "resources/insulation-removal-vs-top-off/index.html":
    "b2bd2d2a1a237259a5210ac4db59a6bf1ecc0f7c395cd40d441c7ecd247a6012",
  "resources/spray-foam-vs-blown-in-attic-insulation/index.html":
    "53abfe020bfb0766ee6cff9b63f5d860fc69aaf7f2fcd38e0a17f4b5f6d2befa",
  "resources/signs-of-attic-pest-contamination/index.html":
    "ecc914d742082bf41495d70b071e13dc92fe127aae40d14f157365a4b5da70f0",
  "styles.css": "21a116f422beacd8692747b6e979f5b369f28d2de69ef1bd87123198ab929139",
  "script.js": "fadc8c1a7b66718e923370a6d37b126cc56b04a2ba1952322d7f4507240d3c83",
  "functions/_middleware.js":
    "0da797087cc6bacfca6b9c1a863df2a489290628380bfdc242e7cf89b537f720",
  "functions/api/leads.js":
    "25b191ad3e9d7252ed517da0f4641a32c093345b28f665954e9e6a7bc40be4d6",
  "server/fieldflow-attribution.js":
    "b537f7f91198856f252cb91b1262b27f8d5ba8ee40c7777d94a55c3e9f46c13a",
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
  return decodeHtml(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim(),
  );
}

function publicWordCount(html) {
  const guide = extractBlock(html, "<div data-exact-guide-content>", "<!-- exact-guide-content:end -->");
  const text = textContent(guide).replace(/&[a-zA-Z0-9#]+;/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
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

function markdownVisibleText(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.trim() !== "---" && !/^\|(?:\s*-+\s*\|)+$/.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .replace(/^### /, "")
        .replace(/^\d+\. /, "")
        .replace(/^- /, "")
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .replace(/\s*\|\s*/g, " ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1"),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function expectedGuideText(guide) {
  const copy = guide.exact_copy;
  const units = [
    "Home",
    "/",
    "Resources",
    "/",
    guide.h1,
    copy.hero.eyebrow,
    guide.h1,
    ...copy.hero.paragraphs,
  ];

  for (const section of copy.sections) {
    units.push(section.eyebrow, section.heading, markdownVisibleText(section.markdown));
  }
  for (const group of copy.sourceGroups) {
    units.push(group.heading);
    for (const source of group.sources) units.push(source.title, source.text);
  }
  units.push(copy.faq.eyebrow, copy.faq.heading);
  for (const item of copy.faq.items) units.push(item.question, item.answer);
  for (const linkSection of [copy.related, copy.local]) {
    units.push(linkSection.eyebrow, linkSection.heading, linkSection.intro);
    for (const item of linkSection.items) units.push(item.title, item.text, item.cta);
  }
  units.push(
    copy.closingCta.eyebrow,
    copy.closingCta.heading,
    copy.closingCta.body,
    copy.closingCta.label,
  );
  return units.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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

function sectionContainingH2(html, heading) {
  const headingIndex = html.indexOf(`<h2>${heading}</h2>`);
  assert.notEqual(headingIndex, -1, `Missing H2: ${heading}`);
  const startIndex = html.lastIndexOf('<section class="', headingIndex);
  const endIndex = html.indexOf("</section>", headingIndex);
  assert.notEqual(startIndex, -1, `Missing section start for ${heading}`);
  assert.notEqual(endIndex, -1, `Missing section end for ${heading}`);
  return html.slice(startIndex, endIndex + "</section>".length);
}

test("the four guides expose the approved metadata and schema", async () => {
  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    assert.match(html, new RegExp(`<title>${guide.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
    assert.ok(html.includes(`<meta name="description" content="${guide.description}">`));
    assert.ok(html.includes(`<link rel="canonical" href="${guide.canonical}">`));
    assert.ok(html.includes(`<h1>${guide.h1}</h1>`));
    assert.ok(html.includes(`<h2>${guide.faqHeading}</h2>`));
    assert.equal(publicWordCount(html), expectedGuideText(guide).split(" ").length);

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

test("rendered guide content is an exact, ordered projection of the approved package", async () => {
  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    const renderedGuide = extractBlock(
      html,
      "<div data-exact-guide-content>",
      "<!-- exact-guide-content:end -->",
    );
    assert.equal(textContent(renderedGuide), expectedGuideText(guide));

    const words = expectedGuideText(guide).split(" ");
    const firstBrandWord = words.findIndex(
      (word, index) => word === "Good" && words[index + 1]?.replace(/[^A-Za-z]/g, "") === "Attic",
    );
    assert.ok(firstBrandWord >= 0, `${guide.slug} is missing its approved Good Attic transition`);
    assert.ok(firstBrandWord / words.length >= 0.6, `${guide.slug} introduces Good Attic too early`);
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

test("source, related-guide, local-service, and CTA destinations match the package", async () => {
  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    for (const sourceGroup of guide.exact_copy.sourceGroups) {
      const section = sectionContainingH2(html, sourceGroup.heading);
      const hrefs = [...section.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(hrefs, sourceGroup.sources.map((source) => source.url));
    }

    for (const linkSection of [guide.exact_copy.related, guide.exact_copy.local]) {
      const section = sectionContainingH2(html, linkSection.heading);
      const destinations = [...section.matchAll(/href="([^"]+)"/g)].map(
        (match) => new URL(match[1], guide.canonical).pathname,
      );
      assert.deepEqual(destinations, linkSection.items.map((item) => item.url));
    }

    const cta = sectionContainingH2(html, guide.exact_copy.closingCta.heading);
    const ctaHref = cta.match(/<a class="button primary" href="([^"]+)">/);
    assert.ok(ctaHref, `Missing primary CTA for ${guide.slug}`);
    assert.equal(new URL(ctaHref[1], guide.canonical).pathname, guide.exact_copy.closingCta.url);
  }
});

test("the resource hub and sitemap contain each new route once", async () => {
  const hub = await readFile(path.join(projectDirectory, "resources", "index.html"), "utf8");
  const sitemap = await readFile(path.join(projectDirectory, "sitemap.xml"), "utf8");

  const cardMatches = [...hub.matchAll(/<a class="feature-card page-card-link reveal" href="([^"]+)">[\s\S]*?<\/a>/g)];
  const newCardHrefs = cardMatches
    .map((match) => match[1])
    .filter((href) => guides.some((guide) => href === `${guide.slug}/`));
  assert.deepEqual(newCardHrefs, guides.map((guide) => `${guide.slug}/`));

  for (const guide of guides) {
    const card = cardMatches.find((match) => match[1] === `${guide.slug}/`);
    assert.ok(card, `Missing Resources card for ${guide.slug}`);
    assert.equal(
      textContent(card[0]),
      [guide.hub_card.category, guide.hub_card.title, guide.hub_card.text, guide.hub_card.cta].join(" "),
    );
  }

  const legacyCards = cardMatches.filter(
    (match) => !guides.some((guide) => match[1] === `${guide.slug}/`),
  );
  assert.equal(legacyCards.length, 43);
  assert.equal(
    createHash("sha256").update(legacyCards.map((match) => match[0]).join("\n")).digest("hex"),
    "6ce5aa58bb68c43150b17a488db5fd6635f31ad806853a3986ca9eb02c312914",
  );
  assert.equal(legacyCards[23][1], "blown-insulation-vs-rolled-insulation/");
  assert.equal(
    createHash("sha256").update(legacyCards[23][0]).digest("hex"),
    "a85c3aad697b872e3cd1e2587e69f7c168e20a5f76e39c130b40f394c9536f9d",
  );

  const batCard = cardMatches.find((match) => match[1] === "bat-guano-attic-insulation-removal/");
  assert.ok(batCard);
  assert.ok(batCard[0].includes("../assets/dirty-old-attic-needing-restoration.webp"));
  assert.equal(batCard[0].includes("animals-in-the-attic.webp"), false);

  for (const guide of guides) {
    assert.equal(hub.split(`href="${guide.slug}/"`).length - 1, 1);
    assert.equal(sitemap.split(`<loc>${guide.canonical}</loc>`).length - 1, 1);
  }
});

test("protected pages and operational assets remain byte-identical to live baseline 78ae22f", async () => {
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
    ["<!-- Google tag (gtag.js) -->", "<link rel=\"stylesheet\" href=\"../../styles.css?v=measurement-20260901a\">"],
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
  const regressionLanguage = /Best next pages|Keep moving through the site|current attic topic|market hub|support path|protected pages|sales decision|Open page|Open local service|local service path|local restoration path|local removal path|accepted scope|accepted attic work|The scope should|unverified batt|Questions about .*\?\./i;

  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    const main = extractBlock(html, "<main class=\"page-main\">", "</main>");
    const hero = extractBlock(main, '<section class="section page-hero">', "</section>");
    assert.equal(hero.includes("page-hero__actions"), false);
    assert.equal(main.includes("Financing Options"), false);
    assert.ok(main.includes("Request an Attic Assessment"));
    assert.doesNotMatch(textContent(main), prohibited);
    assert.doesNotMatch(textContent(main), regressionLanguage);
  }
});

test("new guides match the winning guide's production-intended crawler eligibility", async () => {
  const robots = await readFile(path.join(projectDirectory, "robots.txt"), "utf8");
  for (const crawler of ["Googlebot", "Bingbot", "OAI-SearchBot", "GPTBot"]) {
    assert.match(robots, new RegExp(`User-agent: ${crawler}\\nAllow: /`));
  }

  for (const guide of guides) {
    const html = await readFile(guide.file, "utf8");
    const main = extractBlock(html, '<main class="page-main">', "</main>");
    assert.ok(main.includes("data-exact-guide-content"));
    assert.doesNotMatch(html, /noindex|nosnippet|data-nosnippet/i);
    assert.equal(html.match(/<link rel="canonical"/g)?.length, 1);
    assert.ok(html.includes(`<link rel="canonical" href="${guide.canonical}">`));
  }
});
