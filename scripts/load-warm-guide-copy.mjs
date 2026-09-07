import { readFile } from "node:fs/promises";
import path from "node:path";

const keywordMap = {
  "attic-insulation-removal-after-mice": {
    primary: "attic insulation removal after mice",
    secondary: [
      "mouse contaminated attic insulation",
      "remove insulation after mice",
      "mouse attic remediation",
      "mouse exclusion and attic cleanup",
    ],
  },
  "bat-guano-attic-insulation-removal": {
    primary: "bat guano attic insulation removal",
    secondary: [
      "bat guano in attic insulation",
      "remove insulation after bats",
      "bat attic remediation",
      "bat exclusion and attic cleanup",
    ],
  },
  "wet-attic-insulation-remove-or-dry": {
    primary: "wet attic insulation remove or dry",
    secondary: [
      "wet cellulose insulation",
      "wet fiberglass attic insulation",
      "roof leak attic insulation",
      "remove water damaged insulation",
    ],
  },
  "replace-attic-insulation-when-replacing-roof": {
    primary: "replace attic insulation when replacing roof",
    secondary: [
      "new roof attic insulation",
      "roof replacement insulation removal",
      "coordinate roofing and attic insulation",
      "roof leak insulation replacement",
    ],
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitLevelTwoSections(markdown) {
  const matches = [...markdown.matchAll(/^## (.+)$/gm)];
  return matches.map((match, index) => ({
    heading: match[1].trim(),
    body: markdown
      .slice(match.index + match[0].length, matches[index + 1]?.index ?? markdown.length)
      .trim(),
  }));
}

function fieldValue(body, label) {
  const exactMatch = body.match(
    new RegExp(`^- \\*\\*${escapeRegExp(label)}:\\*\\* \\x60([^\\n\\x60]*)\\x60$`, "m"),
  );
  if (exactMatch) return exactMatch[1];

  const plainMatch = body.match(
    new RegExp(`^- \\*\\*${escapeRegExp(label)}:\\*\\* (.+)$`, "m"),
  );
  if (!plainMatch) throw new Error(`Missing exact-copy field: ${label}`);
  return plainMatch[1].trim();
}

function stripFieldLines(body, labels) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  return body
    .replace(new RegExp(`^- \\*\\*(?:${labelPattern}):\\*\\* \\x60[^\\n\\x60]*\\x60\\n?`, "gm"), "")
    .trim();
}

function plainParagraphs(body) {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && paragraph !== "---")
    .map((paragraph) => paragraph.replace(/\n/g, " ").replace(/\s+/g, " ").trim());
}

function parseSourceCards(block) {
  const sources = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (!current.url) throw new Error(`Missing source URL for ${current.title}`);
    current.text = current.descriptionLines.join(" ").replace(/\s+/g, " ").trim();
    delete current.descriptionLines;
    sources.push(current);
    current = null;
  };

  for (const sourceLine of block.body.split("\n")) {
    const line = sourceLine.trim().replace(/\s+$/, "");
    const start = line.match(/^- \*\*(.+?)\*\*(?: — (.*))?$/);
    if (start) {
      flush();
      current = {
        title: start[1],
        descriptionLines: start[2] ? [start[2].trim()] : [],
        url: "",
      };
      continue;
    }
    if (!current || !line || line === "---") continue;
    const url = line.match(/^`(https?:\/\/[^`]+)`$/);
    if (url) current.url = url[1];
    else current.descriptionLines.push(line);
  }

  flush();
  return { heading: block.heading, sources };
}

function parseFaqSection(block) {
  const eyebrow = fieldValue(block.body, "Eyebrow");
  const heading = fieldValue(block.body, "H2");
  const faqBody = stripFieldLines(block.body, ["Eyebrow", "H2"]);
  const matches = [...faqBody.matchAll(/^### (.+)$/gm)];
  const items = matches.map((match, index) => {
    const answer = faqBody
      .slice(match.index + match[0].length, matches[index + 1]?.index ?? faqBody.length)
      .replace(/^---$/gm, "")
      .trim()
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ");
    return { question: match[1].trim(), answer };
  });
  return { eyebrow, heading, items };
}

function parseLinkCards(block) {
  const eyebrow = fieldValue(block.body, "Eyebrow");
  const heading = fieldValue(block.body, "H2");
  const intro = fieldValue(block.body, "Intro");
  const body = stripFieldLines(block.body, ["Eyebrow", "H2", "Intro"]);
  const matches = [...body.matchAll(/^\d+\. \*\*(.+?)\*\*(.*)$/gm)];
  const items = matches.map((match, index) => {
    const chunk = `${match[2]}\n${body.slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? body.length,
    )}`
      .replace(/^---$/gm, "")
      .trim();
    const cta = chunk.match(/(?:^|— |\n\s*)CTA: `([^`]+)`/);
    const url = chunk.match(/(?:^|— |\n\s*)URL: `([^`]+)`/);
    if (!cta || !url) throw new Error(`Missing CTA or URL for ${match[1]}`);

    const text = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !/^—?\s*CTA: `/.test(line) &&
          !/^—?\s*URL: `/.test(line) &&
          !/^— CTA: `.*` — URL: `.*`$/.test(line),
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      title: match[1],
      text,
      cta: cta[1],
      url: url[1],
    };
  });
  return { eyebrow, heading, intro, items };
}

function parseClosingCta(block) {
  return {
    eyebrow: fieldValue(block.body, "Eyebrow"),
    heading: fieldValue(block.body, "H2"),
    body: fieldValue(block.body, "Body"),
    label: fieldValue(block.body, "CTA label"),
    url: fieldValue(block.body, "CTA destination"),
  };
}

function parseHubCards(markdown) {
  return splitLevelTwoSections(markdown)
    .filter((block) => /^Card \d+$/.test(block.heading))
    .map((block) => ({
      category: fieldValue(block.body, "Category"),
      title: fieldValue(block.body, "Title"),
      text: fieldValue(block.body, "Description"),
      cta: fieldValue(block.body, "CTA"),
      url: fieldValue(block.body, "URL"),
      imageDirection: fieldValue(block.body, "Image direction"),
    }));
}

function assertFaqParity(visibleFaq, schema) {
  const structured = schema.mainEntity.map((item) => ({
    question: item.name,
    answer: item.acceptedAnswer.text,
  }));
  if (JSON.stringify(visibleFaq.items) !== JSON.stringify(structured)) {
    throw new Error(`Visible and structured FAQ copy differ for ${visibleFaq.heading}`);
  }
}

async function parseGuide(packageDirectory, manifestPage, hubCard) {
  const markdownPath = path.join(packageDirectory, manifestPage.copy_file);
  const faqPath = path.join(packageDirectory, manifestPage.faq_json_file);
  const [markdown, faqJson] = await Promise.all([
    readFile(markdownPath, "utf8"),
    readFile(faqPath, "utf8"),
  ]);
  const blocks = splitLevelTwoSections(markdown);
  const getBlock = (heading) => {
    const block = blocks.find((candidate) => candidate.heading === heading);
    if (!block) throw new Error(`Missing exact-copy section: ${heading}`);
    return block;
  };
  const settings = getBlock("Page settings");
  const route = fieldValue(settings.body, "Route");
  if (route !== manifestPage.route || route !== hubCard.url) {
    throw new Error(`Route mismatch in exact-copy package: ${route}`);
  }
  const slug = route.split("/").filter(Boolean).at(-1);
  const heroParagraphs = plainParagraphs(getBlock("Hero introduction").body);
  const sections = blocks
    .filter((block) => /^Section \d+$/.test(block.heading))
    .map((block) => ({
      number: Number(block.heading.split(" ").at(-1)),
      eyebrow: fieldValue(block.body, "Eyebrow"),
      heading: fieldValue(block.body, "H2"),
      markdown: stripFieldLines(block.body, ["Eyebrow", "H2"]),
    }));
  const sourceGroups = blocks
    .filter((block) => block.heading.startsWith("Source cards"))
    .map(parseSourceCards);
  const faq = parseFaqSection(getBlock("FAQ section"));
  const faqSchema = JSON.parse(faqJson);
  assertFaqParity(faq, faqSchema);
  const related = parseLinkCards(getBlock("Related guides"));
  const local = parseLinkCards(getBlock("Local service section"));
  const closingCta = parseClosingCta(getBlock("Closing CTA"));
  const keywords = keywordMap[slug];
  if (!keywords) throw new Error(`Missing keyword registration for ${slug}`);

  return {
    slug,
    url: route,
    market: null,
    include_on_services_hub: false,
    primary_keyword: keywords.primary,
    secondary_keywords: keywords.secondary,
    seo_title: fieldValue(settings.body, "SEO title"),
    meta_description: fieldValue(settings.body, "Meta description"),
    h1: fieldValue(settings.body, "H1"),
    intro: heroParagraphs[0],
    faq_heading: faq.heading,
    suppress_related_links: true,
    page_purpose: "Homeowner guide",
    cta_primary: closingCta.label,
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: fieldValue(settings.body, "H1"), url: route },
    ],
    canonical_url: fieldValue(settings.body, "Canonical"),
    related_links: related.items.map((item) => ({ label: item.title, url: item.url })),
    faq_items: faq.items,
    trust_elements: [],
    sections: [],
    source_groups: sourceGroups.map((group) => ({
      heading: group.heading,
      sources: group.sources,
    })),
    cta: {
      title: closingCta.heading,
      text: closingCta.body,
      primary: {
        label: closingCta.label,
        url: closingCta.url,
        kicker: closingCta.eyebrow,
        hideSecondary: true,
      },
    },
    hub_card: hubCard,
    exact_copy: {
      sourceFile: manifestPage.copy_file,
      faqJsonFile: manifestPage.faq_json_file,
      hero: {
        eyebrow: fieldValue(settings.body, "Eyebrow"),
        paragraphs: heroParagraphs,
      },
      sections,
      sourceGroups,
      faq,
      related,
      local,
      closingCta,
      imageDirection: blocks.find((block) => block.heading === "Image direction")?.body || "",
    },
  };
}

export async function loadWarmGuidePackage(packageDirectory) {
  const [manifestJson, hubMarkdown] = await Promise.all([
    readFile(path.join(packageDirectory, "copy-manifest.json"), "utf8"),
    readFile(path.join(packageDirectory, "05-resource-hub-card-copy.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestJson);
  const hubCards = parseHubCards(hubMarkdown);
  if (manifest.pages.length !== 4 || hubCards.length !== 4) {
    throw new Error("The warm-guide package must contain exactly four guides and four hub cards");
  }

  const cardsByUrl = new Map(hubCards.map((card) => [card.url, card]));
  const pages = [];
  for (const manifestPage of manifest.pages) {
    const hubCard = cardsByUrl.get(manifestPage.route);
    if (!hubCard) throw new Error(`Missing hub card for ${manifestPage.route}`);
    pages.push(await parseGuide(packageDirectory, manifestPage, hubCard));
  }
  return { manifest, pages, hubCards };
}
