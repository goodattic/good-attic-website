import assert from "node:assert/strict";

// Patrick-approved copy from aeo-town-faq-drafts.md, 2026-10-13.
const byFile = new Map([
  [
    "kansas-city-mo/index.html",
    {
      "pairs": [
        [
          "How much does it cost to insulate an attic in Kansas City?",
          "Blown-in attic insulation from Good Attic costs about $2 per square foot in the Kansas City area before discounts, so a 1,000 sq ft attic runs about $2,000. The price depends on how much depth is needed to reach R-49 or R-60 and how easy the attic is to move around in. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."
        ],
        [
          "How much does attic insulation removal and replacement cost in Kansas City?",
          "Removing old attic insulation and replacing it averages about $5 per square foot with Good Attic in Kansas City, or about $5,000 for a 1,000 sq ft attic. That covers the full job: removal, air sealing, sanitizing, baffles, sealing pest entry points and new insulation. Discounts and the complexity of the attic move the price. Every attic is a little different, so treat these as ballpark figures as of October 2026. We'll come out, take a look at yours for free, and give you an exact price in writing."
        ],
        [
          "Which animals get into Kansas City attics, and what does cleanup involve?",
          "Squirrels and mice are the animals we find most often in Kansas City attics. Cleanup means removing the contaminated insulation, sanitizing, sealing the entry points and re-insulating."
        ],
        [
          "Is the attic inspection free, and how soon can you come out?",
          "Yes, Good Attic's attic inspection in the Kansas City area is free, and we can usually come out the same day. A typical job takes one day."
        ],
        [
          "What warranty does Good Attic give in Kansas City?",
          "Every Good Attic job in Kansas City comes with a lifetime warranty on workmanship, plus full support on any material warranty claim."
        ]
      ],
      "heading": "Questions Kansas City homeowners ask us."
    }
  ],
  [
    "kansas-city-mo/service-areas/leawood-ks/index.html",
    {
      "pairs": [
        [
          "What do attics in Leawood usually need?",
          "Most Leawood homes we see were built around 1989, and most have less than half the recommended R-49 to R-60. It is usually old shredded fiberglass that has broken down over time."
        ],
        [
          "Does anything about Leawood homes change the job?",
          "Leawood homes tend to have larger gaps on the outside that open up with age, so jobs there usually need extra work sealing entry points and air leaks."
        ]
      ]
    }
  ],
  [
    "kansas-city-mo/service-areas/olathe-ks/index.html",
    {
      "pairs": [
        [
          "What do attics in Olathe usually need?",
          "Most Olathe homes we see were built around 1994 and have cellulose that has broken down and settled a great deal."
        ],
        [
          "Does Good Attic offer neighborhood discounts in Olathe?",
          "Yes. Homes in the same Olathe neighborhood often have the same attic problems, so we offer neighborhood discounts when neighbors book with us."
        ]
      ]
    }
  ],
  [
    "kansas-city-mo/service-areas/overland-park-ks/index.html",
    {
      "pairs": [
        [
          "What do attics in Overland Park usually need?",
          "Most Overland Park homes we see were built around 1989 and have old cellulose or fiberglass that has broken down and settled. The biggest issue we find is large openings where pests get in."
        ],
        [
          "Are animals in the attic common in Overland Park?",
          "Yes. Many Overland Park homes sit close to large trees, which makes animals in the attic much more likely. On jobs there we take extra steps to find and seal the entry points."
        ]
      ]
    }
  ],
  [
    "salt-lake-city-ut/service-areas/cottonwood-heights-ut/index.html",
    {
      "pairs": [
        [
          "Who does attic insulation and insulation removal in Cottonwood Heights?",
          "Good Attic has worked in more than 150 Cottonwood Heights attics over the past three years. We usually inspect and quote the same day you call, and the inspection is free."
        ],
        [
          "What do attics in Cottonwood Heights usually need?",
          "Most Cottonwood Heights homes we work in were built around 1978 and have old fiberglass batts or worn-out cellulose. The most common problem is gaps in the attic floor that let air leak out of the living space and give pests a way in."
        ],
        [
          "Are pests a bigger problem in Cottonwood Heights attics?",
          "Yes, we see more squirrel and rodent activity in Cottonwood Heights attics than in most of the Salt Lake Valley. On jobs there we put extra emphasis on finding and sealing the places they get in."
        ]
      ]
    }
  ],
  [
    "salt-lake-city-ut/service-areas/draper-ut/index.html",
    {
      "pairs": [
        [
          "Who does attic insulation and insulation removal in Draper?",
          "Good Attic has worked in more than 50 Draper attics over four years. We usually inspect and quote the same day you call, and the inspection is free."
        ],
        [
          "What do attics in Draper usually need?",
          "Most Draper homes we see were built around 2000 and have fiberglass or cellulose well below today's recommended levels. Builders put in the minimum at the time, and it has settled since."
        ],
        [
          "How much insulation should a Draper attic have?",
          "We recommend R-60 for Draper homes. Draper sits higher than much of the valley and gets noticeably colder in winter, so the extra depth earns its keep."
        ]
      ]
    }
  ],
  [
    "salt-lake-city-ut/service-areas/sandy-ut/index.html",
    {
      "pairs": [
        [
          "Who does attic insulation and insulation removal in Sandy, Utah?",
          "Good Attic has worked in more than 100 Sandy attics over almost four years. We usually inspect and quote the same day you call, and the inspection is free."
        ],
        [
          "What do attics in Sandy usually need?",
          "Most Sandy attics we see have insulation that is more than 20 years old, usually blown rock wool or shredded fiberglass in homes built in the late 1970s and early 1980s. At that age it has broken down, the R-value is far below today's recommended levels, and the attic floor has almost never been air sealed. Many have had pests at some point too, so we check for that before recommending a top-off or a full removal."
        ]
      ]
    }
  ],
  [
    "st-louis-mo/service-areas/chesterfield-mo/index.html",
    {
      "pairs": [
        [
          "Who does attic insulation and insulation removal in Chesterfield?",
          "Good Attic has worked in more than 50 Chesterfield attics over three years. We usually inspect and quote the same day you call, and the inspection is free."
        ],
        [
          "What do attics in Chesterfield usually need?",
          "Most Chesterfield homes we work in were built around 1982 and have old shredded fiberglass that has broken down. Homes that age also tend to have gaps on the outside that have opened up over time and let pests in."
        ],
        [
          "How does Good Attic protect my home during the job?",
          "Before any work starts we cover floors, protect corners and cover furniture, on every job. Chesterfield homes often call for more of that, so we build extra prep time into jobs there."
        ]
      ]
    }
  ],
  [
    "st-louis-mo/service-areas/wildwood-mo/index.html",
    {
      "pairs": [
        [
          "Who does attic insulation and insulation removal in Wildwood?",
          "Good Attic works in about one Wildwood attic a week and has served Wildwood for two years. We can usually come out the same day for a free attic inspection and quote."
        ],
        [
          "What do attics in Wildwood usually need?",
          "Most Wildwood homes we see were built around 1992 and have old cellulose or fiberglass that has broken down and stopped doing much. Building codes then called for far less insulation than is recommended today, and after 30 years many of these attics have had animals in them as well."
        ],
        [
          "Are animals in the attic common in Wildwood?",
          "Yes. Wildwood is wooded and rural, and when it turns cold, attics are a go-to shelter for squirrels and mice."
        ]
      ]
    }
  ]
]);

export const townFaqFiles = [...byFile.keys()];
const count = (html, fragment) => html.split(fragment).length - 1;
const detailStart = '            <details class="faq-item reveal">';
const schemaPattern = /^  <script type="application\/ld\+json">(\{"@context":"https:\/\/schema.org","@type":"FAQPage".*\})<\/script>$/gm;
const breadcrumbStart = '  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"';
const contactStart = '    <section id="contact" class="section contact">';

const entity = ([name, text]) => ({
  "@type": "Question",
  name,
  acceptedAnswer: { "@type": "Answer", text },
});
const item = ([question, answer]) => `            <details class="faq-item reveal">\n              <summary>${question}</summary>\n              <p>${answer}</p>\n            </details>`;

function hubAdditions({ heading, pairs }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map(entity),
  };
  const schemaBlock = `  <script type="application/ld+json">${JSON.stringify(schema)}</script>\n\n`;
  const items = pairs.map(item).join("\n\n");
  const sectionBlock = `    <section id="faq" class="section">\n      <div class="section-heading reveal">\n        <p class="eyebrow">FAQ</p>\n        <h2>${heading}</h2>\n      </div>\n\n    <div class="faq-list">\n\n${items}\n\n    </div>\n\n    </section>\n\n`;
  return { schemaBlock, sectionBlock };
}

function applyHub(html, file, content, reverse) {
  const { schemaBlock, sectionBlock } = hubAdditions(content);
  const hasSchema = count(html, '"@type":"FAQPage"');
  const hasSection = count(html, '<section id="faq" class="section">');
  assert.ok((hasSchema === 0 && hasSection === 0) || (hasSchema === 1 && hasSection === 1), `${file}: partial or duplicated town FAQ`);

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

function applyTown(html, file, pairs, reverse) {
  const schemas = [...html.matchAll(schemaPattern)];
  assert.equal(schemas.length, 1, `${file}: expected one FAQPage schema`);
  const schemaLine = schemas[0][0];
  const schema = JSON.parse(schemas[0][1]);
  const newCount = pairs.length;
  assert.ok(Array.isArray(schema.mainEntity), `${file}: invalid FAQPage`);
  const faqListStart = html.indexOf('<div class="faq-list">');
  assert.ok(faqListStart >= 0 && count(html, '<div class="faq-list">') === 1, `${file}: FAQ list anchor`);
  const faqListEnd = html.indexOf('    </div>', faqListStart);
  assert.ok(faqListEnd > faqListStart, `${file}: FAQ list end`);
  const firstItem = html.indexOf(detailStart, faqListStart);
  assert.ok(firstItem > faqListStart && firstItem < faqListEnd, `${file}: first FAQ item`);
  const itemCount = count(html.slice(faqListStart, faqListEnd), detailStart);
  const oldCount = 3;
  const isBase = schema.mainEntity.length === oldCount && itemCount === oldCount;
  const isAdded = schema.mainEntity.length === oldCount + newCount && itemCount === oldCount + newCount;
  assert.ok(isBase || isAdded, `${file}: partial or duplicated town FAQ`);

  const original = { ...schema, mainEntity: isAdded ? schema.mainEntity.slice(newCount) : schema.mainEntity };
  const applied = { ...original, mainEntity: [...pairs.map(entity), ...original.mainEntity] };
  const originalLine = `  <script type="application/ld+json">${JSON.stringify(original)}</script>`;
  const appliedLine = `  <script type="application/ld+json">${JSON.stringify(applied)}</script>`;
  assert.equal(schemaLine, isAdded ? appliedLine : originalLine, `${file}: altered FAQ schema`);
  const visibleBlock = pairs.map(item).map(value => `${value}\n\n`).join("");

  if (isAdded) {
    assert.equal(html.slice(firstItem, firstItem + visibleBlock.length), visibleBlock, `${file}: altered visible FAQ`);
    if (!reverse) return html;
    const withoutSchema = html.replace(schemaLine, originalLine);
    const position = withoutSchema.indexOf(detailStart, withoutSchema.indexOf('<div class="faq-list">'));
    return withoutSchema.slice(0, position) + withoutSchema.slice(position + visibleBlock.length);
  }

  if (reverse) return html;
  const withSchema = html.replace(schemaLine, appliedLine);
  const position = withSchema.indexOf(detailStart, withSchema.indexOf('<div class="faq-list">'));
  return withSchema.slice(0, position) + visibleBlock + withSchema.slice(position);
}

// Reproduce or undo exactly the approved visible FAQ and JSON-LD changes.
// Both directions are idempotent; partial or altered additions fail.
export function applyTownFaq(html, file, { reverse = false } = {}) {
  const content = byFile.get(file);
  if (!content) return html;
  if (content.heading) return applyHub(html, file, content, reverse);
  return applyTown(html, file, content.pairs, reverse);
}
