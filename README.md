# Good Attic Website

Static marketing site for Good Attic.

## Project Structure

- `index.html` - site markup
- `styles.css` - site styles
- `script.js` - site interactions
- `assets/` - images, logo files, and visual assets

## Local Preview

Open `index.html` in a browser, or serve the folder with a simple local web server:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Wave 1 SEO Build

The wave-one SEO architecture is generated from the reusable route/data layer in `build-seo-wave1.mjs`.

To regenerate the non-home routes, sitemap, robots file, and page model JSON:

```bash
node build-seo-wave1.mjs
```

## Launch Readiness

Run the launch audit:

```bash
node scripts/check-launch-readiness.mjs
```

After the live domain is active, submit the current sitemap URLs to IndexNow:

```bash
node scripts/submit-indexnow.mjs https://goodattic.energy
```

Launch and owner handoff steps are documented in `LAUNCH-CHECKLIST.md`.

## Cloudflare Pages

Recommended production setup:

- Source: GitHub repository
- Framework preset: None
- Build command: leave blank
- Build output directory: `/`

### GoHighLevel Lead Form

Lead forms submit to the Cloudflare Pages Function at `/api/leads`. The function forwards the normalized lead payload to GoHighLevel without exposing the CRM webhook in browser code.

In Cloudflare Pages, add this production environment variable:

```text
GHL_WEBHOOK_URL=<your GoHighLevel inbound webhook URL>
```

The simple local preview command serves static files only, so it does not run Cloudflare Pages Functions. Test the CRM submission on a Cloudflare preview/production deployment or with Cloudflare Pages local tooling.

Before launch, confirm the live canonical domain in `build-seo-wave1.mjs` and confirm the GoHighLevel workflow receives and maps the submitted fields correctly.
