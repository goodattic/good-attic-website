# Good Attic Launch Checklist

This file separates the launch tasks Codex can handle in-repo from the steps that require business access, live-domain control, or real proof assets.

## Already prepared in the repo

- Canonical domain is set to `https://goodattic.energy`
- `robots.txt` references the live sitemap and explicitly allows major crawlers
- `sitemap.xml` is generated from the current page set
- page metadata and schema are in place
- proof ingestion files exist under `data/proof/`
- IndexNow key file is present at the site root
- launch audit script: `node scripts/check-launch-readiness.mjs`
- IndexNow submission helper: `node scripts/submit-indexnow.mjs`

## Launch command sequence

1. Rebuild the site:

```bash
node build-seo-wave1.mjs
```

2. Run the launch check:

```bash
node scripts/check-launch-readiness.mjs
```

3. Push `main` so Cloudflare Pages rebuilds production.

4. After the live domain is active, submit IndexNow:

```bash
node scripts/submit-indexnow.mjs https://goodattic.energy
```

## Owner-only tasks

### 1. Point the domain live

- Connect `goodattic.energy` to the Cloudflare Pages production project.
- Confirm the production branch is the correct branch.
- Confirm HTTPS is active.

### 2. Verify search platforms

- Verify `goodattic.energy` in Google Search Console.
- Verify `goodattic.energy` in Bing Webmaster Tools.
- Submit `https://goodattic.energy/sitemap.xml` in both.

### 3. Confirm crawler access

- Make sure Cloudflare bot/security settings are not blocking:
  - `Googlebot`
  - `Bingbot`
  - `OAI-SearchBot`
- If you use WAF rules, confirm they do not challenge these crawlers.

### 4. Load real proof

- Add approved homeowner excerpts to:
  - `data/proof/approved-review-excerpts.json`
- Add real photos and documented project evidence to:
  - `data/proof/documented-project-proof.json`

### 5. Confirm lead handling

- Confirm `GHL_WEBHOOK_URL` is set in Cloudflare Pages production.
- Run one real production form test after launch.
- Confirm the lead lands in the intended GHL workflow and opportunity path.

### 6. Strengthen local entity trust

- Update and verify Google Business Profiles for real locations only.
- Start collecting review excerpts you can approve for the site.
- Keep phone, service-area, and business details consistent across citations.

## Recommended first real proof batch

- 3 approved review excerpts per market
- 2 before-condition photo sets per market
- 1 after-condition photo set per core service
- 1 documented inspection-findings summary per market
