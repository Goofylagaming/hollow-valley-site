# Hollow Valley UI-v2: production release checklist (2026-10-17)

## Scope and source of truth

- **Current live production:** Render `hollow-valley-site`, branch `master`, deployed commit `86499c14d1e587714dcd2e4ab9ec91a85284aa15`.
- **Git rollback reference:** `backup/production-before-ui-v2-20261017` points to that commit. This is a **code snapshot only** and is **NOT a database backup**.
- **Candidate:** `release/ui-v2-production-20261017` is based on that exact live production commit. Do not merge `test-ui-v2` into `master` wholesale.
- **Reference UI:** current `test-ui-v2`, including header, mobile menu, My Stuff rail, green theme and updated homepage.
- **Not in scope:** feature changes to Stripe, authentication, database, game automation, Territory Wars gameplay, or the isolated `skin-studio-persistence-v012` preview.
- **Render services not to modify:** `hollow-valley-automation`, `HerbyBot`, `hollow-valley-skin-v012-preview`, `hollow-valley-site-test`, and `herbybot-territory-preview`.

## What is already reconciled into the candidate

1. Kept all existing production `server/` and `automation-platform/` files. This preserves current SQLite migrations, Stripe webhooks and subscriptions, Steam/Discord/Owner sign-in, Wallet, Dino Storage and Marketplace APIs.
2. Added the UI-v2 and snapshot theme stylesheets and production-local Hollow Valley banner.
3. Modernized navigation with the existing production branding normalization and retained a route to `/owner-login` for non-Steam owner access.
4. Ported the new homepage while preserving the playable-species guide, dialog and `site.js` features.
5. Updated the existing production HTML templates to preload UI-v2 styles while retaining all existing functional script references, including Marketplace storage fixes and Dino Storage hydration/status fixes.
6. Excluded preview-only Territory Wars administration links and endpoints.
7. Added `test/productionUiRelease.test.js` and a release-specific GitHub Actions workflow.

## Required before approving production deploy

### 1. Test verification
- [ ] GitHub release workflow passes, including `node --test test/productionUiRelease.test.js` and `npm test`.
- [ ] Confirm branch diff includes **zero** modifications under `server/` and `automation-platform/`.
- [ ] Preview the **actual release candidate**, not only the UI-v2 source preview. Render auto-PR previews are currently disabled; without a candidate deployment, do not claim visual/runtime validation.
- [ ] Check desktop (wide + 1280px), tablet (820px), iPad portrait and phone: navigation, account chip, sidebar, headers, scroll, buttons, accessibilty.
- [ ] Verify Wallet balance/history and supporter multiplier read without mutation; no manual coin credits or forced purchases.
- [ ] Verify official Marketplace catalog/growth values, player listings and filters; do not make a real purchase while testing.
- [ ] Verify Dino Storage cards/stats; **do not park/redeem dinos solely for this UI test**.
- [ ] Verify Admin hub, Player Directory, event deletion permissions and owner login availability (without action commands).
- [ ] Verify Live Map map controls, overlay visibility, map zoom and refresh.

### 2. Production data protection
- [ ] Confirm Render production disk `dsk-dajsk9nqj5pc73euebtg` is still mounted at `/app/data` and check `DB_PATH` points to that persistent mount (default Node `server/db.js` resolves to `/app/data/hollowvalley.sqlite` in its production Docker image).
- [ ] Obtain and **export off the service** a consistent SQLite backup (including associated WAL state), e.g. via SQLite's online `VACUUM INTO` or backup API, not a naive hot-file copy. Confirm `PRAGMA quick_check` on the copy and record the snapshot timestamp.
- [ ] Keep current production persistent disk attached. **Never replace, delete or merge disks** as part of a visual UI deployment.
- [ ] Check sufficient disk space for snapshot, and preserve old backup until full post-deploy acceptance.

### 3. Payments and account protection
- [ ] Keep `STRIPE_SECRET_KEY`, webhook signing secret, Stripe price IDs and subscription settings **unchanged**. Avoid publishing secrets in PRs, logs or screenshots.
- [ ] Keep `STEAM_RETURN_URL`, `STEAM_REALM`, `DISCORD_REDIRECT_URI`, `SESSION_SECRET` and OAuth client credentials unchanged. Candidate does not edit server authentication modules.
- [ ] Check existing logged-in session, Steam account linking, Discord role connection and owner admin access after cutover. Do not generate new OAuth clients or change redirect URLs.

## Deployment and rollback

1. Confirm the production source `master` has not advanced beyond the pinned pre-release commit; if it has, rebase/reconcile again.
2. With tests, candidate runtime/visual smoke tests and exported SQLite backup complete, merge the isolated candidate PR into `master`.
3. Render production's `master` auto-deploys. Observe deploy status, health, errors, payment webhook handling, login and site endpoints.
4. At any issue, stop further feature work and restore **code** using `backup/production-before-ui-v2-20261017` (via rollback PR/revert or deployment of the pinned SHA). Keep the existing persistent disk **unchanged**; do not restore an older SQLite database unless a database corruption/schema issue is actually confirmed.
5. Recheck Wallet, Dino Storage, Admin, Stripe and Steam/Discord after rollback.
6. Only after release acceptance, separately tackle Render service consolidation; it is not part of this UI release.

## Current limitations

GitHub branch and tests can be updated here, but the connected Render management API **does not expose current environment-variable values, shell access, disk snapshots/backups or branch changes to an existing service**. A live SQLite backup and a candidate-only Render runtime smoke test require additional authorized access, a supported management action, or human verification in Render.

**Release gate:** No production deployment until the SQLite backup and end-to-end smoke test are confirmed.
