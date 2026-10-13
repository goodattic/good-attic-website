import assert from "node:assert/strict";

// Patrick-approved copy from aeo-market-faq-drafts.md, 2026-10-12.
const byFile = new Map([
  ["salt-lake-city-ut/index.html", {
    heading: "Questions Salt Lake City homeowners ask us.",
    pairs: [
      ["How much does it cost to insulate an attic in the Salt Lake City area?", "Blown-in attic insulation from Good Attic costs about $2 per square foot in the Salt Lake City area before rebates and discounts, so a 1,000 sq ft attic runs about $2,000. The price depends on how much depth is needed to reach R-49 or R-60 and how easy the attic is to move around in, and utility rebates can lower it. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."],
      ["How much does it cost to remove and replace attic insulation in Utah?", "Removing old attic insulation and replacing it averages about $5 per square foot with Good Attic in Utah, or about $5,000 for a 1,000 sq ft attic. That covers the full job: removal, air sealing, sanitizing, baffles, sealing pest entry points and new insulation. Discounts, rebates and the complexity of the attic move the price. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."],
      ["What rebates can I get for attic insulation in Utah, and who handles the paperwork?", "Utah homeowners can get attic insulation rebates from Enbridge Gas's ThermWise program and Rocky Mountain Power's Wattsmart program, and Good Attic handles the paperwork for both. As of October 2026, ThermWise pays $0.32 per sq ft (Tier 1) and $0.08 per sq ft (Tier 2), which stack to $0.40 per sq ft when at least R-30 is added and the attic finishes between R-49 and R-60. Wattsmart pays $0.10 per sq ft for qualifying homes; homes built in the last 10 years do not qualify. Good Attic is an authorized contractor for both programs."],
      ["What R-value should my attic have in Utah?", "Good Attic recommends R-49 to R-60 for Utah attics. R-49 is the ENERGY STAR recommendation, and most of our customers choose R-60, the highest level we install. R-60 in cellulose is about 17.3 inches deep."],
      ["What should I look for in an attic insulation company near Salt Lake City, and how does Good Attic compare?", "Good Attic Utah is a family-owned attic company based in Lehi with a 4.9-star Google rating from more than 150 reviews and nearly four years in business. We hold Utah contractor license 12978960-5501, are insured, and back every job with a lifetime warranty on workmanship plus full support on any material warranty claim. Inspections and quotes are free and usually happen the same day."],
      ["Should I remove my old attic insulation or just add more on top?", "Remove the old insulation if there are signs of animals or pests, if it is more than about 10 years old, or if you want the attic air sealed properly. Air leaks in the attic floor can only be sealed fully once the old insulation is out. If none of those apply, adding insulation on top can work, and we check which it is at the free inspection."],
      ["What type of attic insulation does Good Attic install in Utah?", "Good Attic installs borate-treated cellulose in Utah attics. The borate treatment is there to resist pests, which most attics deal with at some point."],
      ["Can I insulate my attic myself, or should I hire a company?", "A small top-off in a clean, easy-to-reach attic is a reasonable do-it-yourself job; anything involving old or contaminated insulation, air sealing or baffles is better done by a company. Tight spaces, wiring and recessed lights make many attics harder than they look from below. A free Good Attic inspection will tell you which kind of attic you have before you decide."],
      ["My Utah house is older. Could the attic insulation contain asbestos?", "Some older Utah homes have attic insulation that contains asbestos, so it should be tested before anyone disturbs it. Good Attic provides that test at no charge."],
      ["Which areas does Good Attic cover in Utah, and how soon can you come out?", "Good Attic covers Salt Lake and Utah counties from Lehi and usually inspects within 24 hours, giving the quote on site at the same visit. Our phones are answered 24 hours a day. A typical job takes one day. We work in West Jordan, Sandy, Draper, South Jordan, Herriman, American Fork, Holladay, Millcreek, Cottonwood Heights and Sugar House, among others."],
    ],
  }],
  ["st-louis-mo/index.html", {
    heading: "Questions St. Louis homeowners ask us.",
    pairs: [
      ["How much does it cost to insulate an attic in St. Louis?", "Blown-in attic insulation from Good Attic costs about $2 per square foot in the St. Louis area before discounts, so a 1,000 sq ft attic runs about $2,000. The price depends on how much depth is needed to reach R-49 or R-60 and how easy the attic is to move around in. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."],
      ["How much does attic insulation removal and replacement cost in St. Louis?", "Removing old attic insulation and replacing it averages about $5 per square foot with Good Attic in St. Louis, or about $5,000 for a 1,000 sq ft attic. That covers the full job: removal, air sealing, sanitizing, baffles, sealing pest entry points and new insulation. Discounts and the complexity of the attic move the price. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."],
      ["I had squirrels, raccoons or mice in my attic. What does cleanup and new insulation cost, and who do I call?", "Attic cleanup and new insulation after animals averages about $5 per square foot with Good Attic in the St. Louis area. That covers removing the contaminated insulation, sanitizing, air sealing, baffles, sealing entry points and re-insulating. Good Attic works with partner companies on the animal side and coordinates the whole job for the homeowner. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."],
      ["How much insulation should a St. Louis attic have?", "Good Attic recommends R-49 to R-60 for St. Louis attics. R-49 is the ENERGY STAR recommendation, and most of our customers choose R-60, the highest level we install."],
      ["What should I look for in an attic insulation company in St. Louis or St. Charles County, and how does Good Attic compare?", "Good Attic of Saint Louis is a family-owned attic company with a 5.0-star Google rating and nearly three years in the St. Louis market. We are insured and back every job with a lifetime warranty on workmanship plus full support on any material warranty claim. Inspections and quotes are free and usually happen the same day."],
      ["Is the attic inspection free, and what does it include?", "Yes, Good Attic's attic inspection in the St. Louis area is free. You get a full presentation of what we found, a written report and a quote."],
      ["What does an attic clean-out include?", "A Good Attic clean-out in St. Louis is a full reset of the attic: removing the old insulation, air sealing, sanitizing, installing baffles, sealing pest entry points and blowing in new insulation."],
      ["My St. Louis house is about 100 years old. Can the attic still be insulated?", "Yes, a 100-year-old St. Louis house can be insulated. We inspect old wiring first and bring in a qualified electrician if it needs attention, and we have suspected vermiculite tested at no charge before any work. Brick construction makes no difference to attic insulation."],
      ["Which areas does Good Attic cover around St. Louis, and how soon can you come out?", "Good Attic covers St. Louis and St. Charles counties and usually inspects within 24 hours, giving the quote on site at the same visit. Our phones are answered 24 hours a day. A typical job takes one day. We work in Chesterfield, St. Charles, St. Peters, O'Fallon, Ballwin, Clayton, Des Peres, Frontenac, Town and Country and Wildwood, among others."],
    ],
  }],
]);

export const marketFaqFiles = [...byFile.keys()];

const breadcrumbStart = '  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"';
const contactStart = '    <section id="contact" class="section contact">';

function additions({ heading, pairs }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map(([name, text]) => ({
      "@type": "Question",
      name,
      acceptedAnswer: { "@type": "Answer", text },
    })),
  };
  const schemaBlock = `  <script type="application/ld+json">${JSON.stringify(schema)}</script>\n\n`;
  const items = pairs.map(([question, answer]) => `            <details class="faq-item reveal">\n              <summary>${question}</summary>\n              <p>${answer}</p>\n            </details>`).join("\n\n");
  const sectionBlock = `    <section id="faq" class="section">\n      <div class="section-heading reveal">\n        <p class="eyebrow">FAQ</p>\n        <h2>${heading}</h2>\n      </div>\n\n    <div class="faq-list">\n\n${items}\n\n    </div>\n\n    </section>\n\n`;
  return { schemaBlock, sectionBlock };
}

const count = (html, fragment) => html.split(fragment).length - 1;

// Apply or undo precisely the approved FAQ schema and visible section on the two hubs.
// Both directions are idempotent; partial or altered additions fail.
export function applyMarketFaq(html, file, { reverse = false } = {}) {
  const content = byFile.get(file);
  if (!content) return html;
  const { schemaBlock, sectionBlock } = additions(content);
  const hasSchema = count(html, '"@type":"FAQPage"');
  const hasSection = count(html, '<section id="faq" class="section">');
  assert.ok((hasSchema === 0 && hasSection === 0) || (hasSchema === 1 && hasSection === 1), `${file}: partial or duplicated market FAQ`);

  if (hasSchema) {
    assert.equal(count(html, schemaBlock + breadcrumbStart), 1, `${file}: altered FAQ schema`);
    assert.equal(count(html, sectionBlock + contactStart), 1, `${file}: altered visible FAQ`);
    if (!reverse) return html;
    return html.replace(schemaBlock + breadcrumbStart, breadcrumbStart).replace(sectionBlock + contactStart, contactStart);
  }

  assert.equal(count(html, breadcrumbStart), 1, `${file}: breadcrumb anchor`);
  assert.equal(count(html, contactStart), 1, `${file}: contact anchor`);
  if (reverse) return html;
  return html.replace(breadcrumbStart, schemaBlock + breadcrumbStart).replace(contactStart, sectionBlock + contactStart);
}
