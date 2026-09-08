import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cityMarketCopy } from "../scripts/load-city-market-copy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parent = "cb2fb2d83e4db12fbc787eda108bed66a08c16ab";
const route = "/resources/when-attic-cleanup-becomes-restoration/";
const file = `${route.slice(1)}index.html`;
const read = (name) => readFile(path.join(root, name), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const before = (name) => git("show", `${parent}:${name}`);
const manifest = JSON.parse(await read("content/pest-guide/copy-manifest.json"));
const metadata = JSON.parse(await read("content/pest-guide/page-metadata.json"));
const schema = JSON.parse(await read("content/pest-guide/faq-jsonld.json"));
const html = await read(file);
const blocks = manifest.ordered_content_blocks;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const unescape = (value) => value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const inline = (value) => value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");
const plain = (value) => normalize(unescape(value.replace(/<\/(?:p|h[1-6]|li|summary|a|span|nav|section)>/g, "$& ").replace(/<[^>]*>/g, ""))).replace(/\s+([.,;:!?])/g, "$1");
const guide = html.match(/<div data-exact-guide-content>([\s\S]*?)<!-- exact-guide-content:end -->/)[1].replace(/<nav[\s\S]*?<\/nav>/, "");

function blockMarkdown(block) {
  switch (block.type) {
    case "eyebrow": case "paragraph": return block.text;
    case "h1": return `# ${block.text}`;
    case "h2": return `## ${block.text}`;
    case "h3": return `### ${block.text}`;
    case "ordered_steps": return block.items.map((item, i) => `${i + 1}. **${item.title}** ${item.body}`).join("\n\n");
    case "cta": return [block.eyebrow, `## ${block.heading}`, block.body, `[${block.label}](${block.fallback_href})`].join("\n\n");
    case "source_list": return [`## ${block.heading}`, ...block.items.map((item) => `- [${item.title}](${item.url}) \u2014 ${item.description}`)].join("\n\n");
    case "faq_list": return [`## ${block.heading}`, ...block.items.flatMap((item) => [`### ${item.question}`, item.answer])].join("\n\n");
    case "link_cards": return [`## ${block.heading}`, block.intro, ...block.items.flatMap((item) => [`### ${item.title}`, item.description, `[${item.anchor}](${item.href})`])].filter(Boolean).join("\n\n");
    case "links": return block.items.map((item) => `[${item.anchor}](${item.href})`).join(" \u00b7 ");
    default: throw new Error(`Unverified block type: ${block.type}`);
  }
}

function blockText(block) {
  switch (block.type) {
    case "eyebrow": case "paragraph": case "h1": case "h2": case "h3": return inline(block.text);
    case "ordered_steps": return block.items.map((item) => `${item.title} ${item.body}`).join(" ");
    case "cta": return [block.eyebrow, block.heading, block.body, block.label].join(" ");
    case "source_list": return [block.heading, ...block.items.flatMap((item) => [item.title, item.description])].join(" ");
    case "faq_list": return [block.heading, ...block.items.flatMap((item) => [item.question, item.answer])].join(" ");
    case "link_cards": return [block.heading, block.intro, ...block.items.flatMap((item) => [item.title, item.description, item.anchor])].filter(Boolean).join(" ");
    case "links": return block.items.map((item) => item.anchor).join(" \u00b7 ");
    default: throw new Error(`Unverified block type: ${block.type}`);
  }
}

test("pest-guide inputs are byte-exact and the manuscript agrees with the structured manifest", async () => {
  const hashes = {
    "01-pest-remediation-exact-copy.md": "c2f22b77ce7562f82cedd3058d4fe77e5e480e9c4d641b9b3773f64f79581dc4",
    "copy-manifest.json": "b400e84a5bc32ac7f1740b488a1b2050ce0e6ac2776ff5bbeb90022b682b13ad",
    "faq-jsonld.json": "51776029cc217f09732a227a0d62d96013347e01a68542e0662eed9bc9fcf0bb",
    "page-metadata.json": "3d0f473d5254a17e849bead3db3862eb4ae5aa86d4e95794195e3e4084a046d6",
    "resource-card.json": "651c63e6a82eecee841c191b1f6f9ac1f87df68ef108e6a9440e30e539662922",
  };
  for (const [name, expected] of Object.entries(hashes)) assert.equal(sha(await read(`content/pest-guide/${name}`)), expected, name);
  assert.equal(blocks.map(blockMarkdown).join("\n\n") + "\n", await read("content/pest-guide/01-pest-remediation-exact-copy.md"));
});

test("the pest guide renders every approved word in order without extra promotion or boilerplate", () => {
  assert.equal(plain(guide), normalize(blocks.map(blockText).join(" ")));
  assert.equal((guide.match(/<h2>/g) || []).length, 13);
  assert.equal((guide.match(/<ol /g) || []).length, 1);
  assert.equal((guide.match(/<li>/g) || []).length, 5);
  assert.doesNotMatch(guide, /SOURCE-AND-CLAIM|publication_authorized|prepared_on|COPY-QA/);
});

test("pest-guide metadata, Article, breadcrumbs, and visible FAQ answers match the approved data", () => {
  assert.equal(unescape(html.match(/<title>([^<]+)<\/title>/)[1]), metadata.seo_title);
  assert.equal(unescape(html.match(/<meta name="description" content="([^"]+)"/)[1]), metadata.meta_description);
  assert.equal(html.match(/<link rel="canonical" href="([^"]+)"/)[1], metadata.canonical);
  assert.equal(unescape(html.match(/<h1>([^<]+)<\/h1>/)[1]), metadata.h1);
  const records = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  assert.equal(records.filter((record) => record["@type"] === "Article").length, 1);
  const article = records.find((record) => record["@type"] === "Article");
  assert.equal(article.headline, metadata.h1);
  assert.equal(article.url, metadata.canonical);
  assert.deepEqual(article.citation, blocks.find((block) => block.type === "source_list").items.map((item) => item.url));
  assert.equal(article.datePublished, undefined);
  assert.equal(article.dateModified, undefined);
  assert.equal(article.author, undefined);
  const breadcrumbs = records.find((record) => record["@type"] === "BreadcrumbList");
  assert.equal(breadcrumbs.itemListElement.at(-1).name, metadata.breadcrumb_label);
  const actualFaq = records.find((record) => record["@type"] === "FAQPage");
  assert.deepEqual(actualFaq.mainEntity, schema.mainEntity);
  const visible = [...guide.matchAll(/<details[^>]*>\s*<summary>(.*?)<\/summary>\s*<p>(.*?)<\/p>\s*<\/details>/gs)].map((match) => ({ question: plain(match[1]), answer: plain(match[2]) }));
  assert.deepEqual(visible, schema.mainEntity.map((item) => ({ question: item.name, answer: item.acceptedAnswer.text })));
  assert.ok(!records.some((record) => record["@type"] === "QAPage"));
});

test("the pest guide uses one late assessment CTA with the existing modal trigger", () => {
  const buttons = [...guide.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)];
  assert.equal(buttons.length, 1);
  assert.match(buttons[0][1], /data-open-modal/);
  assert.match(buttons[0][1], /type="button"/);
  assert.equal(plain(buttons[0][2]), manifest.cta.label);
  assert.doesNotMatch(buttons[0][1], /onclick|href|data-conversion/);
  assert.ok(guide.indexOf(manifest.cta.heading) > guide.indexOf(blocks.find((block) => block.id === "good-attic-3").text));
  assert.ok(guide.indexOf(manifest.cta.heading) < guide.indexOf("Helpful References"));
  assert.equal((guide.match(/data-open-modal/g) || []).length, 1);
});

test("only the existing pest Resources card changes; every card stays in order with its original image", async () => {
  const cards = (source) => [...source.matchAll(/<a class="feature-card page-card-link reveal"[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
  const oldCards = cards(before("resources/index.html"));
  const newCards = cards(await read("resources/index.html"));
  assert.equal(newCards.length, oldCards.length);
  const changed = newCards.flatMap((card, i) => card === oldCards[i] ? [] : [i]);
  assert.equal(changed.length, 1);
  const index = changed[0];
  const target = newCards[index];
  assert.match(target, /href="when-attic-cleanup-becomes-restoration\/"/);
  assert.equal(target.match(/<img[^>]*>/)[0], oldCards[index].match(/<img[^>]*>/)[0]);
  for (const value of [manifest.resource_card.title, manifest.resource_card.category, manifest.resource_card.description, manifest.resource_card.cta]) assert.ok(plain(target).includes(value), value);
  const mask = (source) => source.replace(cards(source)[index], "APPROVED_CARD");
  assert.equal(mask(await read("resources/index.html")), mask(before("resources/index.html")));
});

test("pest-guide chrome, forms, scripts, phones, and all unrelated tracked files retain the preview parent", async () => {
  const original = before(file);
  for (const regex of [/<header[\s\S]*?<\/header>/, /<footer[\s\S]*?<\/footer>/, /<div class="modal"[\s\S]*$/]) assert.equal(html.match(regex)[0], original.match(regex)[0]);
  const scripts = (source) => [...source.matchAll(/<script(?! type="application\/ld\+json")[\s\S]*?<\/script>/g)].map((match) => match[0]);
  assert.deepEqual(scripts(html), scripts(original));
  const allowed = new Set(["build-seo-wave1.mjs", "seo-wave1-page-data.json", "resources/index.html", file, "tests/four-guide-ai-authority-cluster.test.mjs", "package.json", "tests/pest-guide-exact-copy.test.mjs", ...cityMarketCopy.pages.map((page) => page.source_file)]);
  const existing = new Set(git("ls-tree", "-r", "--name-only", parent).trim().split("\n"));
  const changed = git("diff", "--name-only", parent, "--").trim().split("\n").filter(Boolean);
  assert.deepEqual(changed.filter((name) => existing.has(name) && !allowed.has(name)), []);
  assert.equal(sha(await read("resources/blown-insulation-vs-rolled-insulation/index.html")), "ea5d660ffba931e1355fa53f8323b40812f270023ff1f000cfd802bf0f6adb37");
  assert.equal(await read("sitemap.xml"), before("sitemap.xml"));
  const oldData = JSON.parse(before("seo-wave1-page-data.json"));
  const newData = JSON.parse(await read("seo-wave1-page-data.json"));
  assert.deepEqual(oldData.map((page) => page.url), newData.map((page) => page.url));
  assert.deepEqual(oldData.filter((page) => page.url !== route), newData.filter((page) => page.url !== route));
});

test("pest-guide links and assets resolve without adding a second route", async () => {
  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => unescape(match[1]));
  for (const href of links) {
    const url = new URL(href, `https://goodattic.energy${route}`);
    if (url.origin !== "https://goodattic.energy") continue;
    const destination = decodeURIComponent(url.pathname).replace(/^\//, "") + (url.pathname.endsWith("/") ? "index.html" : "");
    await read(destination);
  }
  assert.ok(links.some((href) => new URL(href, metadata.canonical).pathname === "/resources/attic-insulation-removal-after-mice/"));
  assert.ok(links.some((href) => new URL(href, metadata.canonical).pathname === "/resources/bat-guano-attic-insulation-removal/"));
});

test("full generation remains reproducible and unrelated generated pages are byte-identical", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "good-attic-pest-generator-"));
  try {
    for (const name of ["build-seo-wave1.mjs", "scripts", "content", "data", "node_modules"]) await cp(path.join(root, name), path.join(temporary, name), { recursive: true });
    execFileSync(process.execPath, ["build-seo-wave1.mjs"], { cwd: temporary });
    const generated = git("ls-tree", "-r", "--name-only", parent).trim().split("\n").filter((name) => name.endsWith(".html") && !["index.html", "404.html"].includes(name));
    generated.push("seo-wave1-page-data.json", "sitemap.xml", "robots.txt");
    for (const name of generated) assert.equal(await readFile(path.join(temporary, name), "utf8"), await read(name), name);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
