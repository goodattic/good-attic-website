# Live-site release baseline

`scripts/live-site-baseline.json` freezes the exact public build and runtime source for Cloudflare Pages production deployment `d0acd4af-738d-4dee-9f4b-5df4612bd4b0`. The 288 public file hashes were captured from the verified live checkout. The live HTML references `script.40559d41a6b61dc2.js`; the guard also checks that every page references the reviewed active script and that all regional pages retain the correct Quo call links and displayed numbers.

The active JavaScript source is `src/site-interactions.js`, which is byte-for-byte
identical to the live hashed script in this baseline. The public `script.js` is a
legacy URL and does **not** contain all current live behavior. Edit the canonical
source for future interactions. `npm run build` creates a new content-addressed
script and updates only the built HTML references and `_headers` when that source
changes; an unchanged build reproduces all 288 live files exactly.

The Git source commit named in Cloudflare metadata is `24e8665`, but the live
static improvements were deployed from uncommitted files. Commit `4919386` on
`baseline/live-site-2026-09-30` captures those exact static bytes. Starting a
release from `24e8665`, the old `main`, or `stage1-shadow` without this snapshot
would restore older content and phone numbers.

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

The online check aborts if the newest production deployment ID differs from the frozen baseline. It is read-only. It does not publish anything.

Every intentionally changed, added, or removed public or runtime file needs an entry in `scripts/live-site-reviewed-changes.json` with its exact candidate SHA-256 and a review reason. Use `null` for an intentional removal. A changed active script also needs an `activeScript` entry; all 96 HTML pages must reference it. Entries for unchanged files are rejected. The guard is included in the test suite and fails on any unreviewed difference. It also checks `functions/`, `server/`, `workers/`, Cloudflare configuration, package manifests, and the build script, so an API-only change cannot quietly replace existing backend behavior.

The `Live site release guard` GitHub Actions workflow runs the build, full test
suite, and local hash guard on this baseline branch and on pull requests into
it. It has no deployment step. Its green result does not replace the online
deployment-ID preflight or review of the exact proposed change list.

Once a new release is verified live, capture a **new** baseline from that deployment, update the deployment ID, and empty the reviewed-change list. Do not refresh the baseline from an unshipped candidate just to make a failing guard pass. This guard detects byte changes and protected phone/script invariants; ordinary tests and a post-deploy check still matter for behavior.
