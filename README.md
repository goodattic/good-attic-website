# Good Attic Website

Static marketing site for Good Attic.

## Project Structure

- `index.html` - site markup
- `styles.css` - site styles
- `script.js` - site interactions
- `assets/` - images, logo files, and visual assets

## Local Preview

Build the public-only output and serve that directory:

```bash
npm run build
python3 -m http.server 8080 --directory dist
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
- Build command: `npm run build`
- Build output directory: `dist`

The build copies only an explicit allowlist of public site files into `dist`.
Internal functions, tests, migrations, source data, scripts, and documentation are
never placed in the static output. Preview deployments also fail closed for every
API route except the read-only `/api/site-config`; only the production environment
sets `EXTERNAL_API_WRITES_ENABLED=true`.

### Jobber Direct Lead Routing

Lead forms submit to the Cloudflare Pages Function at `/api/leads`. The function keeps the existing website form fields, infers the correct market, refreshes a Jobber OAuth access token, and sends the lead directly to that market's Jobber account. GoHighLevel is no longer required for website form submissions.

In Cloudflare Pages, add these production secrets/environment variables before deploying this routing live:

```text
JOBBER_CLIENT_ID=<Jobber OAuth app client id>
JOBBER_CLIENT_SECRET=<Jobber OAuth app client secret>
JOBBER_GRAPHQL_VERSION=2025-04-16
```

If a market needs its own Jobber app credentials instead of the shared app credentials, use:

```text
JOBBER_CLIENT_ID_SLC=<optional Salt Lake City app client id>
JOBBER_CLIENT_SECRET_SLC=<optional Salt Lake City app client secret>
JOBBER_CLIENT_ID_STL=<optional St. Louis app client id>
JOBBER_CLIENT_SECRET_STL=<optional St. Louis app client secret>
JOBBER_CLIENT_ID_KC=<optional Kansas City app client id>
JOBBER_CLIENT_SECRET_KC=<optional Kansas City app client secret>
```

Routing priority:

1. Use the page market captured by the form, such as `ut`, `mo_stl`, or `mo_kc`.
2. Use the page URL/path if the page market is missing.
3. Use the submitted property state and ZIP code for general pages.

Fallback rules route Utah leads to Salt Lake City, Kansas leads to Kansas City, Missouri ZIPs starting with `630`, `631`, or `633` to St. Louis, and Missouri ZIPs starting with `640`, `641`, `644`, `645`, `646`, or `647` to Kansas City.

The function currently creates a Jobber client record through the direct GraphQL API, using name, email, and phone. Before production cutover, use the authenticated Jobber schema to confirm the exact `Request` and property-address mutation fields for each account, then extend the function so the full form detail appears as a Jobber request/work intake record.

The `ANGI_ROUTER_DB` D1 binding is the sole runtime token authority. Each market must be connected through the OAuth helper before traffic is enabled. The lead router fails closed if D1 is absent, if an account has no authoritative row, if a rotating refresh has an unknown outcome, or if the inferred market is outside `ut`, `mo_stl`, and `mo_kc`. There is no general-account token fallback. `JOBBER_TOKEN_STORE` is compatibility-only and is never used as a production refresh fallback.

### Canonical Website Attribution

The lead endpoint classifies Good Attic website forms on the server and does not
trust the editable `lead_source` form value. There are exactly two canonical
website outcomes:

- `Google Ads | google | google_ads` requires fresh, validated Google paid
  evidence: a plausible `gclid`, `gbraid`, or `wbraid`; a numeric `gad_source`;
  or `utm_source=google` with a supported paid-search medium.
- `Organic Online | website | organic_online` is the default for every other
  website submission, including missing or stale attribution, direct traffic,
  referrals, social, email, and organic search.

Only canonical Google Ads leads may use a market's enabled Google Jobber OAuth
app. Organic Online and every other non-PPC website lead use that market's
website Jobber app. HighLevel and the PII-minimized Fieldflow attribution record
receive the same server-classified label, key, and detail. HighLevel receives
the raw attribution payload. Fieldflow receives paid markers only after the
server has validated them; stale or future paid markers are withheld so they
cannot override the canonical Organic Online classification. The separate Angi
webhook and routing pipeline are not part of this website classification
contract.

### Jobber OAuth Setup Helper

The protected setup helper starts a Jobber OAuth connection for one market at a time:

```text
/api/jobber/oauth/start?market=slc&setup_key=<JOBBER_OAUTH_SETUP_KEY>
/api/jobber/oauth/start?market=stl&setup_key=<JOBBER_OAUTH_SETUP_KEY>
/api/jobber/oauth/start?market=kc&setup_key=<JOBBER_OAUTH_SETUP_KEY>
```

Add these setup-only environment variables on the Cloudflare deployment used for authorization:

```text
JOBBER_OAUTH_SETUP_KEY=<long random setup password>
JOBBER_OAUTH_REDIRECT_URI=https://<deployment-host>/api/jobber/oauth/callback
```

In the Jobber Developer Center, the app callback URL must exactly match `JOBBER_OAUTH_REDIRECT_URI`. Then log into one market's Jobber account, open the matching setup URL, and authorize the app. The callback verifies the exact Jobber account and checkpoints the access token, rotating refresh token, expiry, and refresh fence in D1. A KV mirror is best-effort compatibility data only. Repeat while logged into each separate Jobber account.

For read-only schema inspection, provide a short-lived access token directly. This tool never refreshes OAuth credentials:

```bash
JOBBER_ACCESS_TOKEN_KC=... node scripts/inspect-jobber-schema.mjs kc
```

The simple local preview command serves static files only, so it does not run Cloudflare Pages Functions. Test Jobber submission with Cloudflare Pages local tooling or a Cloudflare preview deployment after the Jobber secrets are configured.

### Address Autocomplete

Lead forms support Google Places address autocomplete when a restricted browser key is available. In Cloudflare Pages, add this production environment variable:

```text
GOOGLE_MAPS_BROWSER_KEY=<your restricted Google Maps Platform browser key>
```

Restrict the key to the live domain, enable the Maps JavaScript API and Places API needed for address autocomplete, and keep manual address entry as the fallback.

Before launch, confirm the live canonical domain in `build-seo-wave1.mjs` and confirm a real form test lands in the intended Jobber account with the expected customer and request details.
