import assert from "node:assert/strict";

const factsByRoute = new Map([
  ["/salt-lake-city-ut/", {
    name: "Good Attic Utah",
    telephone: "385-336-4442",
    streetAddress: "3450 Triumph Blvd Suite 102",
    addressLocality: "Lehi",
    addressRegion: "UT",
    postalCode: "84043",
    counties: ["Salt Lake County, UT", "Utah County, UT", "Davis County, UT", "Summit County, UT", "Wasatch County, UT"],
    help: "Our Salt Lake City team serves homeowners in the surrounding communities. Contact us to check your address and ask about an attic assessment.",
    office: "Good Attic Utah is located at 3450 Triumph Blvd Suite 102, Lehi, UT 84043. We are open 24 hours a day, 7 days a week.",
  }],
  ["/st-louis-mo/", {
    name: "Good Attic of Saint Louis",
    telephone: "314-931-2620",
    streetAddress: "1608 S Big Bend Blvd",
    addressLocality: "Richmond Heights",
    addressRegion: "MO",
    postalCode: "63117",
    counties: ["St. Louis County, MO", "St. Charles County, MO"],
    help: "Our St. Louis team serves homeowners in the surrounding communities. Contact us to check your address and ask about an attic assessment.",
    office: "Good Attic of Saint Louis is located at 1608 S Big Bend Blvd, Richmond Heights, MO 63117. We are open 24 hours a day, 7 days a week.",
  }],
]);

const breadcrumbStart = '  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"';
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function exactOnce(html, fragment, label) {
  assert.equal(html.split(fragment).length, 2, `${label}: expected one exact match`);
}

function additions(route, facts) {
  const url = `https://goodattic.energy${route}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    "@id": `${url}#local-business`,
    name: facts.name,
    url,
    image: "https://goodattic.energy/assets/good-attic-mark-gradient.png",
    telephone: facts.telephone,
    address: {
      "@type": "PostalAddress",
      streetAddress: facts.streetAddress,
      addressLocality: facts.addressLocality,
      addressRegion: facts.addressRegion,
      postalCode: facts.postalCode,
      addressCountry: "US",
    },
    openingHoursSpecification: [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days,
      opens: "00:00",
      closes: "23:59",
    }],
    areaServed: facts.counties.map(name => ({ "@type": "AdministrativeArea", name })),
    parentOrganization: { "@id": "https://goodattic.energy/#organization" },
  };
  const schemaBlock = `  <script type="application/ld+json">${JSON.stringify(schema)}</script>\n\n`;
  const helpEnd = `              <h3>Help in Your Area</h3>\n              <p>${facts.help}</p>\n            </article>\n          \n`;
  const panelBlock = `            <article class="audience-panel reveal">\n              <h3>Office and Hours</h3>\n              <p>${facts.office}</p>\n            </article>\n\n`;
  return {
    beforeSchema: breadcrumbStart,
    afterSchema: schemaBlock + breadcrumbStart,
    beforePanel: helpEnd + "    </div>",
    afterPanel: helpEnd + panelBlock + "    </div>",
  };
}

// Apply or undo precisely the two reviewed insertions on either hub. Both
// directions are idempotent, and unexpected partial or altered additions fail.
export function applyLocalBusinessFacts(html, route, { reverse = false } = {}) {
  const facts = factsByRoute.get(route);
  if (!facts) return html;
  const { beforeSchema, afterSchema, beforePanel, afterPanel } = additions(route, facts);
  const hasSchema = html.includes("#local-business");
  const hasPanel = html.includes("<h3>Office and Hours</h3>");
  assert.equal(hasSchema, hasPanel, `${route}: partial local business addition`);

  if (hasSchema) {
    exactOnce(html, afterSchema, `${route} local business schema`);
    exactOnce(html, afterPanel, `${route} office panel`);
    if (!reverse) return html;
    return html.replace(afterSchema, beforeSchema).replace(afterPanel, beforePanel);
  }

  exactOnce(html, beforeSchema, `${route} breadcrumb anchor`);
  exactOnce(html, beforePanel, `${route} help panel anchor`);
  if (reverse) return html;
  return html.replace(beforeSchema, afterSchema).replace(beforePanel, afterPanel);
}
