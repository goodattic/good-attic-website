# Good Attic SEO Operating Plan

Updated: 2026-05-13

## Primary Objective

Make Good Attic the strongest organic and local-search attic insulation brand in every active market without using fabricated reviews, unsupported office claims, fake local claims, or thin duplicate pages.

## Current Active Markets

- Salt Lake City, UT: `https://goodattic.energy/salt-lake-city-ut/`
- St. Louis, MO: `https://goodattic.energy/st-louis-mo/`
- Kansas City, MO: `https://goodattic.energy/kansas-city-mo/`

## Technical SEO Baseline

- Canonical domain: `https://goodattic.energy`
- Sitemap: `https://goodattic.energy/sitemap.xml`
- Current sitemap page count: 89
- Robots allows Googlebot, Bingbot, OAI-SearchBot, and GPTBot.
- `llms.txt` summarizes the canonical markets, services, resource hub, and proof policy.
- `_redirects` should map old Webflow/blog/location URLs into the new static architecture.
- `404.html` must remain present so random/deleted URLs return a real 404 instead of homepage fallback.

## Deployment Checklist

Run before deploy:

```bash
node build-seo-wave1.mjs
node scripts/check-launch-readiness.mjs
```

Deploy:

```bash
npx wrangler pages deploy . --project-name good-attic-website --branch main
```

After deploy:

```bash
node scripts/submit-indexnow.mjs https://goodattic.energy
```

Verify:

- Old URLs return `301` to the closest relevant new page.
- Random fake URLs return `404`.
- Sitemap count matches the generated local `sitemap.xml`.
- Market resource pages show local call/text paths where applicable.
- Market, service, city, and market-resource pages reinforce the home-service local path without publishing questionable storefront/address signals.

## GSC Audit Snapshot: 2026-05-13

Property checked: `sc-domain:goodattic.energy`

Current GSC read:

- Performance available for May 6-11, 2026: 78 clicks, 18.5K impressions, 0.4% CTR, average position 17.
- Pages report was stale as of May 7, 2026: 47 indexed and 101 not indexed.
- Sitemap was resubmitted on May 13, 2026. GSC still showed 75 discovered pages until Google reprocesses the refreshed sitemap.
- URL Inspection showed the homepage, resource hub, and all three market hubs indexed.
- URL Inspection showed the new St. Louis and Kansas City hot-upstairs market guides as discovered but not crawled. Indexing was requested for both.
- Manual actions: no issues detected.
- Security issues: no issues detected.
- HTTPS: 0 non-HTTPS URLs, 39 HTTPS URLs recognized, no issues.
- Core Web Vitals: no poor or needs-improvement URL groups visible. Desktop data is sparse but not failing.
- Links report: not ready yet; GSC is still processing data.

Immediate interpretation:

- The technical foundation is not the blocker.
- The main short-term SEO bottleneck is crawl/index latency for new market-specific resource pages.
- Broad resource topics and legacy blog replacements are already producing meaningful impressions.
- St. Louis and Kansas City need more first-party proof and stronger local authority signals before they can consistently rank at the top for competitive local terms.
- Salt Lake City is currently the closest to strong organic visibility based on early local query positions.

Actions taken from the audit:

- Added two GSC-driven replacement resources:
  - `/resources/cellulose-vs-fiberglass-attic-insulation/`
  - `/resources/diy-vs-professional-attic-insulation/`
- Tightened legacy redirects for high-impression old URLs:
  - `/post/cellulose-vs-fiberglass-insulation`
  - `/post/hire-vs-diy-attic-insulation`
  - `/post/does-spray-foam-insulation-reduce-noise`
  - `/post/closed-cell-vs-open-cell-attic-spray-foam-insulation`
- Submitted the updated 89-URL sitemap through IndexNow after deploy.

## Google Search Console Weekly Review

Review every Monday once data is available.

- Indexing: confirm submitted vs indexed sitemap URLs.
- Pages: inspect soft 404s, duplicate without user-selected canonical, crawled but not indexed, discovered but not indexed.
- Queries: export top 1,000 queries by impressions for the last 28 days.
- Pages: export landing-page impressions, clicks, CTR, and average position.
- Compare market hubs, market service pages, city support pages, and resource guides separately.
- Use old URL inspection for high-value legacy paths until Google fully transfers signals.

Priority URL groups:

- Market hubs: `/salt-lake-city-ut/`, `/st-louis-mo/`, `/kansas-city-mo/`
- Service pages by market: attic insulation, insulation removal, air sealing, fans, pest issues
- Market problem guides: cost, hot upstairs rooms, cleanup/restoration, pest contamination, air sealing
- Review hub: `/reviews/`

## Local SEO And GBP Checklist

Only create or optimize a Google Business Profile when the business can meet Google’s real-world eligibility requirements for that market.

Current address posture:

- Good Attic should be treated publicly as a home-service/service-area business first.
- Do not use coworking addresses as the primary SEO signal unless each address has the required real-world support: staffed by Good Attic during stated hours, signage where required, and a customer-facing policy that matches the profile.
- Website pages should emphasize local market teams, local phone/text paths, real service coverage, project proof, and in-home attic assessments.
- Market hubs and city pages should use service-area/schema language, not separate `PostalAddress` or branch markup for every city.
- If an office address is later published, label it conservatively as appointment-only or operations-based unless it is truly a walk-in storefront.

For each active market:

- Confirm the real business entity, service-area setup, phone number, and eligible address rules.
- Primary category: Insulation contractor.
- Secondary categories only when accurate.
- Add services: attic insulation, insulation removal, attic air sealing, attic fan installation/support, attic cleanup/restoration.
- Add real photos: team, vehicles, equipment, attic before/after, insulation installs, finished conditions.
- Add Q&A using real homeowner questions.
- Request reviews after completed jobs; never gate or script fake sentiment.
- Respond to every review with local specificity and no private information.
- Keep NAP consistent across major citations.

## Proof Collection Workflow

Every completed job should ideally produce one proof packet:

- Market and city.
- Service type.
- Home age/type if useful and non-identifying.
- Problem statement.
- Inspection findings.
- Before photos.
- After photos.
- Scope summary.
- Homeowner-approved review excerpt, if available.
- Internal notes on what claims are safe to publish.

Publish proof first to:

- The relevant market hub.
- The relevant market service page.
- The closest city support page.
- The reviews hub.

## Content Expansion Rules

Do not create a new page just because a keyword exists.

Create a page when at least one is true:

- The search intent is meaningfully different from existing pages.
- The market has real proof or review support.
- The page can answer a high-value GSC query better than current content.
- The page strengthens an existing local service path without cannibalizing it.

Avoid:

- Unsupported storefront or office pages.
- Thin city pages with only swapped city names.
- Review claims borrowed into another market without neutral labeling.
- Awards, project counts, or savings claims that are not documented.

## Future Market Launch Gate

Before launching a new market SEO set:

- Confirm local phone number and routing.
- Confirm real service availability.
- Build one market hub.
- Build five market service pages.
- Build 5-10 priority city support pages only if service area is real.
- Build 3-5 market problem guides based on likely demand.
- Add at least one real proof packet as soon as possible.
- Prepare local citation and GBP plan.

## Priority KPIs

- Market hub clicks and impressions.
- Market service page rankings for `attic insulation`, `insulation removal`, `attic air sealing`, `attic fans`.
- City support page impressions for nearby service-area searches.
- Resource page impressions for problem-intent searches.
- GBP calls, messages, direction requests, and website clicks.
- Phone/text/dropdown clicks by market.
- Quote form submissions by landing page.

## Near-Term Priorities

1. Deploy redirect and 404 cleanup.
2. Monitor GSC indexing and old URL transfer.
3. Improve market hub performance and image loading.
4. Add more first-party proof to St. Louis and Kansas City.
5. Build citations and review velocity market by market.
6. Use GSC data before creating the next content layer.
