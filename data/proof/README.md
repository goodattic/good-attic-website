# Proof Ingestion Workflow

These files let Good Attic load real review excerpts and documented attic evidence into the generated site without editing page templates.

## Files

- `approved-review-excerpts.json`
- `documented-project-proof.json`

## How to use them

1. Add only real, approved homeowner excerpts or real documented attic evidence.
2. Assign the right `market`, optional `serviceSlug`, and optional `city` so the generator can route the proof to the correct pages.
3. Add the best `targetUrl` for the proof item so the card reinforces the right market, service, city, or reviews page.
4. Run `node build-seo-wave1.mjs` to rebuild the site.

## Suggested review fields

- `quote`
- `reviewerLabel`
- `source`
- `focus`
- `market`
- `serviceSlug`
- `city`
- `image`
- `alt`
- `beforeImage`
- `beforeAlt`
- `afterImage`
- `afterAlt`
- `targetUrl`
- `targetLabel`

### Review example

```json
{
  "reviewerLabel": "St. Louis homeowner",
  "source": "Google review",
  "focus": "clarity and communication",
  "market": "st-louis-mo",
  "serviceSlug": "attic-insulation",
  "city": "chesterfield-mo",
  "quote": "The team explained what they found in the attic and why the insulation scope made sense for the house.",
  "image": "assets/good-attic-insulation-sales-appointment.png",
  "alt": "Homeowner review excerpt for attic insulation in St. Louis",
  "targetUrl": "/st-louis-mo/attic-insulation/",
  "targetLabel": "Open St. Louis insulation page"
}
```

## Suggested documented proof fields

- `title`
- `text`
- `kicker`
- `status`
- `assetType`
- `market`
- `serviceSlug`
- `city`
- `image`
- `alt`
- `targetUrl`
- `targetLabel`

### Documented proof example

```json
{
  "kicker": "Approved project evidence",
  "title": "Chesterfield attic before-and-after set 1",
  "text": "Real attic photos showing the documented attic condition before work and the finished attic afterward.",
  "status": "Real before/after photo set",
  "assetType": "before and after photos",
  "market": "st-louis-mo",
  "city": "chesterfield-mo",
  "image": "assets/proof/st-louis-mo/chesterfield-mo/project-1-after.jpg",
  "alt": "Finished attic condition from Chesterfield before-and-after photo set 1",
  "beforeImage": "assets/proof/st-louis-mo/chesterfield-mo/project-1-before.jpg",
  "beforeAlt": "Before attic condition from Chesterfield before-and-after photo set 1",
  "afterImage": "assets/proof/st-louis-mo/chesterfield-mo/project-1-after.jpg",
  "afterAlt": "Finished attic condition from Chesterfield before-and-after photo set 1",
  "targetUrl": "/st-louis-mo/service-areas/chesterfield-mo/",
  "targetLabel": "Chesterfield city page"
}
```

## Rules

- Do not add fake reviews.
- Do not add fake project claims.
- Do not add proof to a city or market it does not belong to.
