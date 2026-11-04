# HV-UX03 — Hollow Valley News, Patch Notes & Development Updates

**Development only:** October 27, 2026 (Australia/Brisbane).
Branch: feature/hv-ux03-news-updates-20261027.
Based on HV-UX02 (PR #240), which is based on HV-UX01 (PR #239).
There are no changes to production, payment flows or game commands.

## Purpose

Provide a first-party, chronological changelog accessible from the Hollow Valley
homepage, Community dropdown and Help page. Staff can publish sourced development
and staging notes; the system prevents staff-authored claims that a feature is
LIVE before a verified deployment.

Use existing Hollow Valley colours, art, Steam sign-in and admin access.
DinoDen is an information-architecture inspiration only; no external site's
text, CSS, images, rule definitions or features are copied.

## Public website

- /updates: search, category and stage filters, pagination, GitHub source links,
  explicit release-date labels shown in Australia/Brisbane.
- Homepage: the three newest published news posts, or an honest empty state.
- Stage legend: **In Development**, **Testing**, **Blocked**,
  **Ready to Deploy**, **Live** and **Fix Released**.
- No feature is labeled Live due to a PR opening, CI passing or staff draft.
  Live means a **verified deployed website revision only**, and the page states
  that it does not verify the independent game server, HerbyBot or RCON health.
- Public feed exposes only published fields; never the admin's Steam ID,
  internal draft history, notes, token, or private log content.

## Admin editing

- /adminupdates: protected by server-side requireAdmin; guest, non-admin and
  expired sessions cannot access this HTML or its API.
- POST /api/site-updates/admin: create private draft.
- PUT /api/site-updates/admin/:id: modify unpublished draft with optimistic
  revision checks; a conflict rejects stale edits.
- POST /api/site-updates/admin/:id/publish: requires exact PUBLISH confirmation.
  The saved draft must contain a Hollow Valley GitHub PR, commit or workflow
  reference; after publishing it is immutable. Corrections require a new note.
- GET /api/site-updates/admin and /admin/:id/history: private staff view,
  append-only audit snapshots recording admin Steam IDs privately.
- Supported manually published statuses: building, testing, blocked, ready.
  Stage live and fixed cannot be selected or submitted by an admin.
- All public page content uses DOM textContent rather than inserting
  untrusted update titles or messages as HTML.

## Verified release publisher (default OFF)

**Separate from Discord.** The GitHub Actions workflow
.github/workflows/hv-verified-site-updates.yml is designed to publish ONE
generic website release marker per verified production commit SHA.

The following requirements must all be met:

1. Website production: SITE_UPDATES_AUTO_RELEASE_ENABLED=true (explicit,
   controlled activation after approval), NODE_ENV=production and
   RENDER_GIT_COMMIT available from Render.
2. A new 32+-character random HV_SITE_UPDATES_TOKEN is set on the website
   Render service, and the matching value is added as a GitHub repository
   Actions secret. Never use the Stripe, Discord, RCON, automation or
   Command Bridge token for this purpose.
3. GitHub workflow runs on master (or manual dispatch), waits for three
   /readyz responses at the exact $GITHUB_SHA with the existing
   verify-readiness.cjs release gate.
4. If automation-platform files changed, it also waits for that exact
   revision's automation readiness before recording a release.
5. GitHub POSTs only the verified SHA over HTTPS to
   /api/site-updates/release with the dedicated bearer token.
6. The website validates its **own running RENDER_GIT_COMMIT** matches
   the supplied SHA, confirms the release feature flag and production mode,
   and inserts the event once using a unique release_sha constraint.
7. The published notice explicitly states what the proof covers:
   **website revision readiness**, not overall external-service uptime.

When the GitHub secret is missing, the workflow skips without a POST.
When the server flag/token is missing, ingestion is unavailable.
Retries cannot create duplicate published entries or audit events.
No old production releases are backfilled or asserted live automatically.

## Discord channel integration

Requested progress channel: 1550133934871023679 (#server-progress-and-updates).
HV-C01 PR #236 has a separate dedicated HerbyBot outbox destination,
acknowledgment, retry and safe publishing workflow.

HV-UX03 does **not** use direct Discord REST requests, start a Discord
client, send a bot message or install secrets on the website. The public
Updates feed and the Discord outbox can coexist and share verified GitHub
release provenance once both are independently approved and activated.

Do not claim a Discord message was delivered until HerbyBot's real outbox
ack confirms delivery. Avoid re-posting every commit or announcing pending
PRs as Live.

## Preserved production systems and data

No changes to existing Valley Coin ledgers, Stripe members, Steam/Discord OAuth,
DinoStorage, BodyDrop, player account identities, Friends, Marketplace,
Territory Wars, progression, game RCON, Command Bridge, skins or game server.

New tables are additive:
- site_updates: immutable published posts and editable private drafts
- site_update_events: private immutable audit events and snapshots

These tables use the existing website SQLite disk; do not provision a new
empty production database or detach existing disks. Back them up with
SQLite-consistent backups (including WAL) before release.

## Release and testing checklist

1. CI: test/siteUpdates.test.js, production stability, role/Origin checks,
   nonce-like release SHA idempotency, no private draft leaks.
2. Isolated staging Chromium at 390/820/1440px: public /updates, empty feed,
   homepage cards, links, shared mobile dropdown; guest cannot open /adminupdates.
3. Test staff login/admin publishing against an isolated staging session,
   including drafts, edits, version conflicts and immutable publication.
4. Resolve website homepage/nav conflicts with HV-UX01 and any parallel
   #233 Status Page release. Never force-overwrite master.
5. Merge only after reviewed tests and explicit production deployment approval.
   The existing master can auto-deploy from Render, so branch merge is a
   production action and requires appropriate backups and coordination.
6. Activate staff posting and verified release feed only after staff review.
   The website supports development notes immediately after deployment, but
   does not invent historical release notes.
7. Coordinate HV-C01 HerbyBot activation separately, validate channel
   permissions and delivery receipt. No Discord posts before approval.
