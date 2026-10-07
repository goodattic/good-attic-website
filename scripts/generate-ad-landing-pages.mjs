import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("python3", [path.join(root, "scripts/process-lp-collage.py")], { stdio: "inherit" });
const collage = JSON.parse(await readFile(path.join(root, "data/lp-collage-manifest.json"), "utf8"));
const assetRoot = "../../../assets/";
const landingReviews = JSON.parse(await readFile(path.join(root, "data/proof/ad-landing-review-selection.json"), "utf8"));
const geoLookup = JSON.parse(await readFile(path.join(root, "data/ad-geo-lookup.json"), "utf8"));
const assetVersion = createHash("sha256")
  .update(await readFile(path.join(root, "assets/ad-landing.css")))
  .update(await readFile(path.join(root, "assets/ad-landing.js")))
  .digest("hex").slice(0, 8);
const choices = [
  "Attic Insulation",
  "Insulation Removal",
  "Attic Pest Issues",
  "Attic Air Sealing",
  "Other",
];
const markets = [
  {
    slug: "salt-lake-city-ut", key: "ut", name: "Salt Lake City",
    phone: "385-336-4442", e164: "+13853364442",
    contactLine: "Contact our salt lake team",
    reviews: [
      { by: "Kyle Norris · Utah customer", quote: "We needed to replace our attic’s insulation and the folks at Good Attic did an amazing job. They detailed the complete job as to how it would be done and were very transparent with their pricing. Very clean and careful. I’d recommend them heartily." },
      { by: "Katie Morris · Utah customer", quote: "From start to finish they are awesome! They are professional and take such great care of their customers. So happy we went with them for our insulation project!!" },
      { by: "Larry Litchfield · Utah customer", quote: "The team was very quick and professional. They cleaned everything up after they were finished. They did a great job. I would definitely recommend the Good Attic team for any insulation job." },
    ],
  },
  {
    slug: "st-louis-mo", key: "mo_stl", name: "St. Louis",
    phone: "314-931-2620", e164: "+13149312620",
    contactLine: "Contact our St. Louis team",
    reviews: [
      { by: "Bruce Petersen · St. Louis customer", quote: "Easy to work with. Very knowledgeable." },
      { by: "Teresa Kusgen · St. Louis customer", quote: "After speaking with Jim several times, I was impressed with his professionalism and attention to detail. His knowledge and kindness were so appreciated! The whole team impressed me from start to finish. Thank you Good Attic!" },
      { by: "ken keirsey · St. Louis customer", quote: "These guys are the real deal. This is a family run local business. They were genuinely friendly. Everything is up front. They answered every question. They cleaned up nicely. Even before we check our utility bills, the house is notably quieter. I would recommend Good Attic Insulation to anybody." },
    ],
  },
  {
    slug: "kansas-city-mo", key: "mo_kc", name: "Kansas City",
    phone: "816-434-0308", e164: "+18164340308",
    contactLine: "Contact our Kansas City team",
    proof: "Locally owned & operated",
    // Kansas City has no approved local excerpt. These are real site reviews
    // labeled with their actual markets; this preview makes no KC review claim.
    reviews: [
      { by: "Bruce Petersen · St. Louis customer", quote: "Easy to work with. Very knowledgeable." },
      { by: "Katie Morris · Utah customer", quote: "From start to finish they are awesome! They are professional and take such great care of their customers. So happy we went with them for our insulation project!!" },
      { by: "Larry Litchfield · Utah customer", quote: "The team was very quick and professional. They cleaned everything up after they were finished. They did a great job. I would definitely recommend the Good Attic team for any insulation job." },
    ],
  },
];
const services = [
  { slug: "attic-insulation", title: "Attic Insulation" },
  { slug: "insulation-removal", title: "Insulation Removal & Replacement" },
];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeInlineJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function townLookupScript(market) {
  const entry = geoLookup.markets[market.key];
  if (!entry || !entry.fallback || !entry.cities || !entry.postalCodes || !entry.otherObservedCities)
    throw new Error(`Missing reviewed geo lookup for ${market.key}`);
  const maps = safeInlineJson({city: entry.cities, postal_code: entry.postalCodes,
    other_city: entry.otherObservedCities, fallback: entry.fallback});
  return `<script>
    // Static lookup runs during parsing, before the headline exists or paints.
    window.goodAtticLpTownResolution = (function () {
      const map = ${maps};
      const id = new URLSearchParams(location.search).get('utm_location') || '';
      for (const type of ['city', 'postal_code', 'other_city']) {
        if (Object.prototype.hasOwnProperty.call(map[type], id))
          return { id, type, town: map[type][id] };
      }
      return { id, type: 'fallback', town: map.fallback };
    })();
  </script>`;
}

function phoneSnippet(market, configMarket, sendTo, number) {
  const callback = market.key === configMarket
    ? `, 'phone_conversion_callback': function(formattedNumber, mobileNumber) {
      window.goodAtticLpPendingCallNumber = [formattedNumber, mobileNumber];
      if (typeof window.goodAtticLpApplyForwardingNumber === 'function')
        window.goodAtticLpApplyForwardingNumber(formattedNumber, mobileNumber);
    }`
    : '';
  return `gtag('config', '${sendTo}', { 'phone_conversion_number': '${number}'${callback} });`;
}

function headlineFitScript() {
  return `<script>
    // Match the approved mobile headline fit before the next content parses.
    (function () {
      const headline = document.currentScript.previousElementSibling;
      const fit = () => {
        headline.style.removeProperty('font-size');
        if (innerWidth > 640) return;
        for (let size = 32; size >= 26; size -= 0.5) {
          headline.style.fontSize = size + 'px';
          if (headline.getBoundingClientRect().height <= parseFloat(getComputedStyle(headline).lineHeight) * 3 + 1) break;
        }
      };
      fit();
      let lastWidth = innerWidth;
      addEventListener('resize', () => {
        if (innerWidth === lastWidth) return;
        lastWidth = innerWidth;
        requestAnimationFrame(fit);
      }, { passive: true });
    })();
  </script>`;
}

function form(market, service, suffix) {
  const formName = `${market.name} ${service.title} short ad form ${suffix}`;
  return `<form class="lp-form" aria-label="Request a free attic inspection" data-lead-form data-form-name="${escapeHtml(formName)}" data-lead-endpoint="/api/leads" action="/api/leads" method="post">
    <input type="hidden" name="form_variant" value="short_ad_landing">
    <input type="hidden" name="form_name" value="${escapeHtml(formName)}">
    <input type="hidden" name="source_page" data-source-page>
    <label class="lp-field">Name<input name="name" type="text" autocomplete="name" placeholder="Your name" maxlength="160" required></label>
    <label class="lp-field">Phone<input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="Your phone" required></label>
    <label class="lp-field">ZIP<input name="zip" type="text" autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="5-digit ZIP" required></label>
    <div class="lp-field lp-service-field"><span>Services Needed?</span><details class="lp-service-picker" data-service-picker><summary aria-label="Services Needed? Select one or more"><span data-service-summary>Select services</span></summary><fieldset class="lp-service-options" popover="manual"><legend class="screen-reader-text">Services Needed? Select all that apply</legend><div class="lp-service-actions"><button class="lp-service-apply" type="button" data-service-apply>Apply selection</button><button class="lp-service-close" type="button" data-service-apply aria-label="Apply selection and close">×</button></div><p>Select all that apply</p>${choices.map((choice) => `<label><input type="checkbox" name="project_type" value="${escapeHtml(choice)}"><span>${escapeHtml(choice)}</span></label>`).join("")}</fieldset></details></div>
    <details class="lp-optional"><summary>Add a note (optional)</summary><label class="lp-field">Notes<textarea name="additional_notes" rows="2" maxlength="2000" placeholder="Anything we should know?"></textarea></label></details>
    <button class="lp-button" type="submit">Get My Free Attic Inspection</button>
    <p class="lp-form-reassurance">Free · No obligation · Same-day quote <a href="/privacy-policy/">Privacy Policy</a></p>
    <p class="lp-form-status" data-form-status role="status" aria-live="polite"></p>
  </form>`;
}

function closingBlock(market) {
  const reviews = landingReviews[market.slug] || [];
  return `<section class="lp-section lp-closing"><div class="lp-shell">
    ${reviews.length ? `<h2>What our customers say</h2><div class="lp-reviews">${reviews.map((review) => {
      const parts = review.name.trim().split(/\s+/);
      const name = `${parts[0]} ${parts.at(-1)[0]}.`;
      return `<figure class="lp-review"><blockquote>“${escapeHtml(review.quote)}”</blockquote><figcaption>${escapeHtml(name)}${review.town ? ` · ${escapeHtml(review.town)}` : ""} · Google review</figcaption></figure>`;
    }).join("")}</div>` : ""}
    <div class="lp-closing-actions"><a class="lp-button lp-inspection-cta" href="#quote">Get My Free Attic Inspection</a><a class="lp-button" data-lp-call href="tel:${market.e164}">Call</a></div>
  </div></section>`;
}

function jobPhoto(market, service) {
  const tiles = (group, description) => {
    const set = collage[group];
    return `<div class="lp-collage-grid">${set.images.map((src, i) => `<img src="${assetRoot}${src}" alt="${description} — Good Attic job photo ${i + 1}" width="240" height="240" loading="lazy" decoding="async">`).join("")}${Array.from({length: set.placeholder}, () => '<div class="lp-collage-placeholder" role="img" aria-label="Job photo placeholder"></div>').join("")}</div>`;
  };
  return `<figure class="lp-collage">${service.slug === "insulation-removal" ? `<div class="lp-collage-block"><p>Before</p>${tiles("removal/before", "Attic before insulation removal")}</div><div class="lp-collage-block"><p>After removal</p>${tiles("removal/after", "Cleaned-out attic after insulation removal")}</div><div class="lp-collage-block"><p>After new insulation</p>${tiles("attic-insulation/after", "Attic after new blown-in insulation")}</div>` : `<div class="lp-collage-block"><p>Before</p>${tiles("attic-insulation/before", "Attic before insulation work")}</div><div class="lp-collage-block"><p>After</p>${tiles("attic-insulation/after", "Attic after insulation work")}</div>`}<figcaption>Recent Good Attic jobs</figcaption></figure>`;
}

function page(market, service) {
  const heading = `${service.title} in ${market.name}`;
  const removal = service.slug === "insulation-removal";
  const fallbackTown = geoLookup.markets[market.key].fallback;
  const townMarkup = `<span data-lp-town><script>document.currentScript.replaceWith(document.createTextNode(window.goodAtticLpTownResolution?.town || ${safeInlineJson(fallbackTown)}));</script></span>`;
  const headline = removal ? `Old or pest-damaged insulation in ${townMarkup}? We remove and replace it.` : `Attic insulation that keeps your ${townMarkup} home comfortable`;
  const support = removal ? "A clean, sealed, freshly insulated attic." : "Lower energy bills. No more hot and cold rooms.";
  const subhead = removal ? "Free attic inspection. We remove old insulation, seal pest entry points, sanitize and re-insulate." : "Free attic inspection, air sealing and blown-in insulation. Clear, honest pricing.";
  const proof = market.key === "ut" ? "Over 100 five-star reviews" : market.key === "mo_stl" ? "Numerous 5-star reviews" : "Family-owned · Free photo-documented attic inspection";
  return `<!doctype html>
<html lang="en" data-lp-market="${market.key}" data-lp-phone="${market.phone}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="description" content="${escapeHtml(service.title)} in ${escapeHtml(market.name)}. Get a free, thorough attic inspection and clear, honest pricing from Good Attic.">
  <meta name="theme-color" content="#24715a">
  <title>${escapeHtml(heading)} | Good Attic</title>
  <link rel="icon" type="image/png" sizes="32x32" href="${assetRoot}favicon-32.png">
  <link rel="stylesheet" href="../../../styles.72e38ccd660523f9.css">
  <link rel="stylesheet" href="${assetRoot}ad-landing.css?v=${assetVersion}">
  ${townLookupScript(market)}
  <script async src="https://www.googletagmanager.com/gtag/js?id=AW-10789892066"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'AW-10789892066');
    gtag('config', 'G-P7T219JFV6');
    ${phoneSnippet(market, 'ut', 'AW-11103039262/_4E-CN313tIaEJ7eq64p', '385-336-4442')}
    ${phoneSnippet(market, 'mo_stl', 'AW-11103039262/-7syCOa6-e0aEJ7eq64p', '314-931-2620')}
    ${phoneSnippet(market, 'mo_kc', 'AW-11103039262/35RYCNWL7bgcEJ7eq64p', '816-434-0308')}
    window.goodAtticPhoneConversionNumbersConfigured = true;
    window.goodAtticGoogleTagConfigured = true;
    window.goodAtticGa4Configured = true;
  </script>
  <script src="../../../script.40559d41a6b61dc2.js" defer></script>
  <script src="${assetRoot}ad-landing.js?v=${assetVersion}" defer></script>
</head>
<body>
  <!-- Compatibility nodes required by the unchanged live script; never rendered or interactive. -->
  <div data-lp-script-compat hidden inert aria-hidden="true" style="display:none!important">
    <button type="button" data-menu-toggle disabled tabindex="-1" aria-hidden="true"></button>
    <nav data-nav hidden inert aria-hidden="true"></nav>
  </div>
  <header class="site-header lp-header lp-header--floating" data-header>
    <div class="lp-header__bar">
      <span class="lp-brand-logo"><img src="${assetRoot}good-attic-white-logo-lp.webp" alt="Good Attic" width="336" height="144"></span>
      <a class="nav-cta lp-header-call" data-lp-call href="tel:${market.e164}">Call <span data-lp-call-number>${market.phone}</span></a>
    </div>
  </header>
  <main class="lp-main">
    <section class="lp-hero lp-hero--after-floating-header"><div class="lp-shell lp-hero__inner">
      <div class="lp-hero-copy">
        <p class="lp-first-proof${market.key === "mo_kc" ? "" : " lp-first-proof--reviews"}">${market.key === "mo_kc" ? "" : `<svg class="lp-first-proof__google" viewBox="0 0 24 24" role="img" aria-label="Google"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"/></svg><span class="lp-first-proof__stars" aria-label="5 stars">★★★★★</span>`}<span>${escapeHtml(proof)}</span></p>
        <h1 data-lp-fit-headline>${headline}</h1>
        ${headlineFitScript()}
        <p class="lp-hero-support">${escapeHtml(support)}</p>
        <p class="lp-hero-subhead">${escapeHtml(subhead)}</p>
      </div>
    </div></section>
    <section class="lp-section lp-form-section" id="quote"><div class="lp-shell lp-form-wrap">
      ${form(market, service, "top")}
      <div class="lp-contact-actions"><a class="lp-button" data-lp-call href="tel:${market.e164}">Call</a><a class="lp-button" data-lp-text href="sms:${market.e164}">Text</a></div>
      ${jobPhoto(market, service)}
    </div></section>
    <section class="lp-section"><div class="lp-shell lp-inspection">
      <h2>What the free, in-depth attic inspection covers</h2>
      <ul><li>Current insulation condition and depth</li><li>Pest activity and entry points</li><li>Air leaks and problem areas</li><li>Clear, honest pricing for the next step</li></ul>
    </div></section>
    <section class="lp-section lp-section--cream"><div class="lp-shell">
      <h2>What we do in 4 steps</h2>
      <ol class="lp-steps">
        ${removal ? `<li class="lp-step"><span class="lp-step-number">1</span><h3>Remove old insulation</h3><p>Take out material that is dirty, damaged, or no longer doing its job.</p></li>
        <li class="lp-step"><span class="lp-step-number">2</span><h3>Seal pest entry points</h3><p>Find and close the openings pests use to reach the attic.</p></li>
        <li class="lp-step"><span class="lp-step-number">3</span><h3>Sanitize</h3><p>Clean affected areas before installing fresh insulation.</p></li>
        <li class="lp-step"><span class="lp-step-number">4</span><h3>Air seal and re-insulate</h3><p>Close air leaks and add blown-in insulation to the right depth.</p></li>` : `<li class="lp-step"><span class="lp-step-number">1</span><h3>Inspect and measure</h3><p>Check insulation depth, air leaks and pest activity.</p></li>
        <li class="lp-step"><span class="lp-step-number">2</span><h3>Air seal</h3><p>Close the leaks that let heated and cooled air escape.</p></li>
        <li class="lp-step"><span class="lp-step-number">3</span><h3>Remove old insulation if needed</h3><p>Only when it is dirty, damaged or pest-affected.</p></li>
        <li class="lp-step"><span class="lp-step-number">4</span><h3>Blow in new insulation</h3><p>Bring the attic to the right depth.</p></li>`}
      </ol>
    </div></section>
    ${closingBlock(market)}
  </main>
  <footer class="lp-footer"><div class="lp-shell">© <span data-year>2026</span> Good Attic</div></footer>
</body>
</html>\n`;
}

for (const market of markets) {
  for (const service of services) {
    const directory = path.join(root, market.slug, "lp", service.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), page(market, service));
  }
}
console.log("Generated six ad-only landing pages.");
