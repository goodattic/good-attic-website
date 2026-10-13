# Live-site release baseline

`scripts/live-site-baseline.json` freezes the public build and runtime source for Cloudflare Pages production deployment `2de2ed51-7bb0-44d7-a86f-98a4d2e71134`. Cloudflare identifies it as a direct upload from clean canonical merge commit `87e8ef64cbf6389c0b05b6414027d23ea8b37e13` on 2026-10-13, with Pages Functions enabled. Of its 328 published static files, only the eight town HTML pages and Kansas City hub HTML differ from the prior `d4c1eed9` deployment; they contain the approved FAQs and matching `FAQPage` data. The Pages runtime is unchanged. The local guard also hashes `_headers` and `_redirects`, for 330 build files total. The live HTML references `script.e0b6cf2323b054a8.js`; the guard checks that every page references the reviewed active script and that all regional pages retain the correct Quo call links and displayed numbers.

The active JavaScript source is `src/site-interactions.js`, which is byte-for-byte
identical to the live hashed script in this baseline. The public `script.js` is a
legacy URL and does **not** contain all current live behavior. Edit the canonical
source for future interactions. `npm run build` creates a new content-addressed
script and updates only the built HTML references and `_headers` when that source
changes; an unchanged build reproduces the live static files exactly.

The backup branch `backup/live-site-d2d9c1d5-2026-10-07` diverged before this
release. Its commit `c6d241f` includes three Quo runtime changes that were not
in the clean `8ae1d56` release. Start new website work from the current
`baseline/live-site-2026-09-30` tip, not the backup branch. Reintroduce any
pending Quo changes through the reviewed-change guard before a future release.

`baseline/live-site-2026-09-30` is the canonical GitHub default and Cloudflare
Pages production branch. Start each website change from its current tip. The
older `main` remains as history. Automatic Cloudflare Pages production and
preview builds are intentionally disabled so pushing a branch cannot publish
an unreviewed checkout. Publish explicitly only after approval, the full tests,
the local guard, and the online deployment-ID preflight below pass.

Before a release, build and run:

```sh
npm run build
node scripts/check-live-site-baseline.mjs
```

For a final online preflight immediately before deployment, use the existing
Wrangler login:

```sh
node scripts/check-live-site-baseline.mjs --check-live-deployment
```

Alternatively, supply a Cloudflare API token with **Pages Read** permission as
`CLOUDFLARE_API_TOKEN`. The command reads deployment metadata only.

The online check aborts if the serving production deployment ID differs from the frozen baseline. It permits newer idle deployment records and is read-only.

Every intentionally changed, added, or removed public or runtime file needs an entry in `scripts/live-site-reviewed-changes.json` with its exact candidate SHA-256 and a review reason. Use `null` for an intentional removal. A changed active script also needs an `activeScript` entry; all 96 HTML pages must reference it. Entries for unchanged files are rejected. The guard is included in the test suite and fails on any unreviewed difference. It also checks `functions/`, `server/`, `workers/`, Cloudflare configuration, package manifests, and the build script, so an API-only change cannot quietly replace existing backend behavior.

The `Live site release guard` GitHub Actions workflow runs the build, full test
suite, and local hash guard on this baseline branch and on pull requests into
it. It runs after a push, so it is not a pre-deployment gate by itself and has
no deployment step. Its green result does not replace the online deployment-ID
preflight or review of the exact proposed change list. Use an explicit guarded
publish from the canonical branch only after approval.

Every production publish, from any session or workstream, must re-baseline
`baseline/live-site-2026-09-30` in the same sitting. Verify the serving
deployment, capture its static and runtime source, update the deployment ID,
empty the reviewed-change list, and merge the re-baseline into the canonical
branch before the session ends. A release is not finished until the canonical
branch records the new deployment ID. Do not refresh the baseline from an
unshipped candidate just to make a failing guard pass. This guard detects byte
changes and protected phone/script invariants; ordinary tests and a post-deploy
check still matter for behavior.
