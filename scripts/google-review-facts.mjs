import assert from "node:assert/strict";

const profiles = {
  ut: {
    name: "Good Attic Utah",
    rating: "4.9",
    starsLabel: "4.9 out of 5 stars",
    count: "151",
    href: "https://www.google.com/maps?cid=11350776469553360031",
    oldHubCount: "100",
    oldHubText: "100 verified reviews",
    oldTownText: "100 reviews across Salt Lake City",
  },
  stl: {
    name: "Good Attic of Saint Louis",
    rating: "5.0",
    starsLabel: "5 out of 5 stars",
    count: "15",
    href: "https://www.google.com/maps?cid=15635551309830472435",
    oldHubCount: "12",
    oldHubText: "12 verified reviews",
    oldTownText: "12 reviews across St. Louis",
  },
};

const utTowns = ["american-fork-ut", "cottonwood-heights-ut", "draper-ut", "herriman-ut", "holladay-ut", "millcreek-ut", "sandy-ut", "south-jordan-ut", "sugar-house-ut", "west-jordan-ut"];
const stlTowns = ["ballwin-mo", "chesterfield-mo", "clayton-mo", "des-peres-mo", "frontenac-mo", "o-fallon-mo", "st-charles-mo", "st-peters-mo", "town-and-country-mo", "wildwood-mo"];

const byFile = new Map([
  ["index.html", { kind: "home" }],
  ["reviews/index.html", { kind: "reviews" }],
  ["salt-lake-city-ut/index.html", { market: "ut", hub: true }],
  ...utTowns.map(town => [`salt-lake-city-ut/service-areas/${town}/index.html`, { market: "ut", hub: false }]),
  ["st-louis-mo/index.html", { market: "stl", hub: true }],
  ...stlTowns.map(town => [`st-louis-mo/service-areas/${town}/index.html`, { market: "stl", hub: false }]),
]);
assert.equal(byFile.size, 24);
export const googleReviewFactsFiles = [...byFile.keys()];

const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${text}</a>`;

function heroBanner(rating, starsLabel, count, indent = "    ") {
  return `${indent}<div class="hero-review-banner" aria-label="Google review rating">
${indent}  <span class="hero-review-banner__google">G</span>
${indent}  <strong>${rating}</strong>
${indent}  <span class="hero-review-banner__stars" aria-label="${starsLabel}">★★★★★</span>
${indent}  <span class="hero-review-banner__volume"><span class="hero-review-banner__count">${count}</span><span>Google Reviews</span></span>
${indent}</div>`;
}

function ratingRow(ariaLabel, rating, countText, href = null, linkText = "See all reviews on Google", indent = "        ") {
  return `${indent}<div class="review-widget__rating" aria-label="${ariaLabel}">
${indent}  <strong>${rating}</strong>
${indent}  <span class="stars" aria-hidden="true">★★★★★</span>
${indent}  <span>${countText}</span>${href ? `\n${indent}  ${link(href, linkText)}` : ""}
${indent}</div>`;
}

function homepageRatingRow() {
  return `            <div class="review-widget__rating" aria-label="4.9 out of 5 stars across 166 Google reviews for Good Attic Utah and Good Attic of Saint Louis">
              <strong>4.9</strong>
              <span class="stars" aria-hidden="true">★★★★★</span>
              <span>166 Google reviews across Utah and St. Louis</span>
              <span>See them on Google: <a href="${profiles.ut.href}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;white-space:nowrap">Utah</a> · <a href="${profiles.stl.href}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;white-space:nowrap">St. Louis</a></span>
            </div>`;
}

function changesFor(file, scope) {
  if (scope.kind === "home") {
    return [
      {
        label: "homepage hero rating badge",
        before: heroBanner("5.0", "Five star rating", "100+", "        "),
        after: heroBanner("4.9", "4.9 out of 5 stars", "166", "        "),
      },
      {
        label: "homepage review widget rating row",
        before: ratingRow("5 out of 5 stars on Google Reviews", "5.0", "100+ Google Reviews", null, "See all reviews on Google", "            "),
        after: homepageRatingRow(),
      },
    ];
  }
  if (scope.kind === "reviews") {
    return [{
      label: "reviews page profile rows",
      before: ratingRow("5 out of 5 stars on Google Reviews", "5.0", "112 verified reviews"),
      after: [profiles.ut, profiles.stl].map(profile => ratingRow(
        `${profile.starsLabel} on Google Reviews for ${profile.name}`,
        profile.rating,
        `${profile.count} Google reviews for ${profile.name}`,
        profile.href,
        "See them on Google",
      )).join("\n"),
    }];
  }

  const profile = profiles[scope.market];
  const oldCount = scope.hub ? profile.oldHubCount : "3";
  const oldText = scope.hub ? profile.oldHubText : profile.oldTownText;
  const changes = [
    {
      label: "hero rating badge",
      before: heroBanner("5.0", "Five star rating", oldCount),
      after: heroBanner(profile.rating, profile.starsLabel, profile.count),
    },
    {
      label: "review widget rating row",
      before: ratingRow("5 out of 5 stars on Google Reviews", "5.0", oldText),
      after: ratingRow(`${profile.starsLabel} on Google Reviews`, profile.rating, `${profile.count} Google reviews`, profile.href),
    },
  ];
  if (scope.hub) {
    const parent = '"parentOrganization":{"@id":"https://goodattic.energy/#organization"}';
    changes.push({
      label: "local business profile links",
      before: `${parent}}</script>`,
      after: `${parent},"hasMap":"${profile.href}","sameAs":["${profile.href}"]}</script>`,
    });
  }
  return changes;
}

const count = (html, fragment) => html.split(fragment).length - 1;

// Apply or undo only the reviewed 24-page Google profile changes. A partial,
// duplicate, or altered replacement fails before any bytes are changed.
export function applyGoogleReviewFacts(html, file, { reverse = false } = {}) {
  const scope = byFile.get(file);
  if (!scope) return html;
  const changes = changesFor(file, scope);
  const states = changes.map(({ label, before, after }) => {
    const oldCount = count(html, before), newCount = count(html, after);
    assert.ok(
      (oldCount === 1 && newCount === 0) || (oldCount === 0 && newCount === 1),
      `${file}: ${label} is missing, duplicated, or conflicting`,
    );
    return newCount ? "after" : "before";
  });
  assert.equal(new Set(states).size, 1, `${file}: partial Google review facts change`);
  if (states[0] === (reverse ? "before" : "after")) return html;
  for (const { before, after } of changes) {
    html = reverse ? html.replace(after, before) : html.replace(before, after);
  }
  return html;
}
