import assert from "node:assert/strict";
import { parse } from "parse5";
import { adapter } from "parse5-htmlparser2-tree-adapter";
import { selectAll } from "css-select";

export const homepageBaseline = "6839180050b3f4df6033f41bf3a80c50de42ff2e";
export const homepageBaselineSha256 = "026ba62a6f21b8a1bae3957bd6d8cc16cf004208f4adac2df46a1b5d5d7c8d57";

export const homepageChanges = [
  {
    id: "A",
    selector: "[data-process-carousel] [data-carousel-track] > article:nth-of-type(2) > p",
    before: "Once you get in touch with us, we will collect a full scope understanding of your project, either in-person, or virtually if you'd like. We will then create a tailored quote to meet your needs.",
    after: "A Good Attic advisor inspects the attic at your home, shows you the findings, answers your questions, and builds the quote with you onsite.",
  },
  {
    id: "B",
    selector: "#services + section > .section-heading > p.eyebrow",
    before: "High-intent search paths",
    after: "COMMON ATTIC QUESTIONS",
  },
  {
    id: "C",
    selector: "#services + section > .section-heading > h2",
    before: "The attic searches homeowners use right before they call.",
    after: "Understand Your Attic Options",
  },
  {
    id: "D",
    selector: "#services + section > .section-heading > p.section-subcopy",
    before: "These themes come from real paid-search performance and are worked into the site where they naturally help a homeowner make the next decision.",
    after: "These are common questions homeowners ask when deciding whether an attic needs added insulation, removal, air sealing, ventilation, or a more complete restoration.",
  },
  {
    id: "E",
    selector: "#contact > .contact-info > p.contact-note",
    before: "Lead source, page URL, and project type are captured so every request can route into the right follow-up path.",
    after: "Our team will review the details and follow up to help arrange the right next step for your attic.",
  },
  {
    id: "F",
    selector: "#trust > .audience-panels > article:nth-of-type(2) > h3",
    before: "Day 1 accuracy",
    after: "Helpful details from the start",
  },
  {
    id: "G",
    selector: "#trust > .audience-panels > article:nth-of-type(2) > p",
    before: "The form below helps homeowners share the right details, so Good Attic can respond with useful next steps.",
    after: "Tell us what you have noticed so our team can follow up with useful next steps.",
  },
];

export const homepageCleanupAddedTests = [
  "tests/homepage-cleanup-helpers.mjs",
  "tests/homepage-cleanup.test.mjs",
];

// Each adapted guard is pinned to its reviewed bytes in homepage-cleanup.test.mjs.
export const homepageCleanupAdaptedTests = [
  "tests/asset-delivery.test.mjs",
  "tests/modal-focus.test.mjs",
  "tests/protected-guide-header.test.mjs",
  "tests/release-synchronization.test.mjs",
];

export function homepageNodes(html, side) {
  assert.ok(side === "before" || side === "after");
  const document = parse(html, { treeAdapter: adapter, sourceCodeLocationInfo: true });
  return homepageChanges.map(change => {
    const nodes = selectAll(change.selector, document);
    assert.equal(nodes.length, 1, `homepage ${change.id}: unique intended node`);
    const node = nodes[0];
    assert.equal(node.children.length, 1, `homepage ${change.id}: one plain-text child`);
    assert.equal(node.children[0].type, "text", `homepage ${change.id}: plain text only`);
    assert.equal(node.children[0].data, change[side], `homepage ${change.id}: exact ${side} text`);
    const start = node.sourceCodeLocation.startTag.endOffset;
    const end = node.sourceCodeLocation.endTag.startOffset;
    assert.equal(html.slice(start, end), change[side], `homepage ${change.id}: exact source text`);
    return { change, node, start, end };
  });
}

export function replaceHomepageNodes(html, from, to) {
  assert.notEqual(from, to);
  const nodes = homepageNodes(html, from);
  for (const { change, start, end } of nodes.sort((a, b) => b.start - a.start)) {
    html = html.slice(0, start) + change[to] + html.slice(end);
  }
  return html;
}

// Historical release comparisons still check every byte, after undoing only
// this separately verified homepage text approval. Other files are untouched.
export function beforeHomepageCleanup(html, file) {
  return file === "index.html" ? replaceHomepageNodes(html, "after", "before") : html;
}
