import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const pestGuideRoute = "/resources/when-attic-cleanup-becomes-restoration/";

export async function loadPestGuideCopy(directory, existingPage) {
  const json = async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8"));
  const manifest = await json("copy-manifest.json");
  const metadata = await json("page-metadata.json");
  const card = await json("resource-card.json");
  const faqSchema = await json("faq-jsonld.json");
  const manuscript = await readFile(path.join(directory, "01-pest-remediation-exact-copy.md"));
  assert.equal(createHash("sha256").update(manuscript).digest("hex"), manifest.public_markdown_sha256);
  assert.deepEqual(metadata, manifest.metadata);
  assert.deepEqual(card, manifest.resource_card);
  assert.equal(existingPage.url, pestGuideRoute);
  assert.equal(metadata.route, pestGuideRoute);
  assert.equal(card.destination, pestGuideRoute);

  const blocks = manifest.ordered_content_blocks;
  const block = (id) => {
    const matches = blocks.filter((item) => item.id === id);
    assert.equal(matches.length, 1, `Expected one exact-copy block: ${id}`);
    return matches[0];
  };
  const faq = block("faqs");
  assert.deepEqual(faq.items, faqSchema.mainEntity.map((item) => ({
    question: item.name, answer: item.acceptedAnswer.text,
  })));
  assert.deepEqual(block("primary-cta"), manifest.cta);
  assert.equal(manifest.cta.behavior, "open_existing_lead_form_modal");
  assert.equal(block("title").text, metadata.h1);
  assert.equal(block("eyebrow").text, metadata.eyebrow);

  const paragraphs = [];
  const sections = [];
  for (const item of blocks.slice(2, blocks.indexOf(block("primary-cta")))) {
    if (item.type === "h2") sections.push({ heading: item.text, body: [] });
    else if (!sections.length && item.type === "paragraph") paragraphs.push(item.text);
    else {
      const section = sections.at(-1);
      assert.ok(section, `Unexpected opening block: ${item.id}`);
      if (item.type === "paragraph") section.body.push(item.text);
      else if (item.type === "h3") section.body.push(`### ${item.text}`);
      else if (item.type === "ordered_steps") {
        section.body.push(item.items.map((step, index) => `${index + 1}. **${step.title}** ${step.body}`).join("\n"));
      } else throw new Error(`Unsupported pest-guide body block: ${item.type}`);
    }
  }
  const sourceGroups = [{
    heading: block("sources").heading,
    sources: block("sources").items.map((item) => ({ title: item.title, text: item.description, url: item.url })),
  }];
  const linkSection = (id) => {
    const section = block(id);
    return {
      heading: section.heading,
      intro: section.intro,
      items: section.items.map((item) => ({ title: item.title, text: item.description, cta: item.anchor, url: item.href })),
    };
  };
  const local = linkSection("local");
  local.links = block("services").items.map((item) => `[${item.anchor}](${item.href})`).join(" \u00b7 ");
  const closingCta = {
    eyebrow: manifest.cta.eyebrow,
    heading: manifest.cta.heading,
    body: manifest.cta.body,
    label: manifest.cta.label,
    url: null,
    openModal: true,
  };

  // Keep the existing route, image description, and keyword registration.
  // Only this record opts into the already-approved exact-copy components.
  const { hero, ...base } = existingPage;
  return {
    ...base,
    seo_title: metadata.seo_title,
    meta_description: metadata.meta_description,
    h1: metadata.h1,
    intro: paragraphs[0],
    page_purpose: "Homeowner guide to pest cleanup and full attic remediation",
    cta_primary: closingCta.label,
    canonical_url: metadata.canonical,
    social_image_alt: existingPage.h1,
    services_hub_card: { title: existingPage.h1, text: existingPage.meta_description },
    breadcrumb_items: existingPage.breadcrumb_items.map((item) => item.url === pestGuideRoute ? { ...item, label: metadata.breadcrumb_label } : item),
    faq_items: faq.items,
    faq_heading: faq.heading,
    trust_elements: [],
    sections: [],
    related_links: block("related").items.map((item) => ({ label: item.title, url: item.href })),
    suppress_related_links: true,
    source_groups: sourceGroups,
    cta: {
      title: closingCta.heading,
      text: closingCta.body,
      primary: { label: closingCta.label, url: null, openModal: true, kicker: closingCta.eyebrow, hideSecondary: true },
    },
    hub_card: { title: card.title, category: card.category, text: card.description, cta: card.cta, url: card.destination, alt: existingPage.h1 },
    exact_copy: {
      sourceFile: "01-pest-remediation-exact-copy.md",
      faqJsonFile: "faq-jsonld.json",
      hero: { eyebrow: metadata.eyebrow, paragraphs },
      sections: sections.map((section) => ({ heading: section.heading, markdown: section.body.join("\n\n") })),
      sourceGroups,
      faq: { heading: faq.heading, items: faq.items },
      related: linkSection("related"),
      local,
      closingCta,
    },
  };
}
