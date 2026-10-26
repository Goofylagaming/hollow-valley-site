# Brand website staging — 26 October 2026

Two independent static outputs in the existing public website repository. No change to the existing Express portal, automation service, gameplay source, accounts, databases, environment variables or DNS.

Build: `node brand-sites/build.mjs`
Verify: `node brand-sites/verify.mjs`
Publish directories: `brand-sites/dist/primalbound` and `brand-sites/dist/hollow-valley`.
No dependency installation required. Render settings: `SKIP_INSTALL_DEPS=true`, auto deploy off. Use separate staging services and staging branches; never master or the existing gameplay preview branch.

## Inspection

- hollow-valley-site master is the live Docker/Node Express portal with a persistent SQLite disk and separate automation service. Its runtime has account, Discord, Steam and payment integrations. Leave all untouched.
- primalbound main contains historical Unreal source; README identifies World on ai/primalbound-world-m18. Public binaries are in primalbound-downloads.
- ai/primalbound-independent-web runs the existing React 19 / Vite 7 browser preview and Node cloud server, with pg and S3 backup dependencies. Do not substitute this preview for the Floot game.
- Render workspace confirmed by user: Herby Death Squad. Existing production and preview branches inspected through Render connector.
- Verified public release metadata: M36.4, tag m36-4-build-40183013083. ZIP SHA-256: d75235105f2e561b9cae213502f63ee255ddfe2d0319d9fb8f21ebd4ccdbbb0a. The website links to the public latest release, with a pinned inspected release for reference. The binary itself was not downloaded or tested in this task.
- Floot URL is documented in private source README. The web fetch tool could not load it; verify availability in a browser before cutover.
- Cloudflare account configuration has not been inspected. No Cloudflare connector is available in this session. No DNS changes are required for onrender.com staging.

## Changes for staging review

- New Primalbound homepage, World downloads, Web entry and distinct World/Web wiki foundations.
- New Hollow Valley Studios homepage with games, studio introduction and contact.
- Responsive layouts, keyboard focus, skip links, page titles and noindex/robots exclusions.
- Original CSS landscape illustration labelled as brand illustration, not game footage.
- No analytics, authentication, embeds, gameplay API calls or data writes.

## Migration gate — NOT COMPLETE

Keep Floot published and serving accounts and progression. Marketing staging is not evidence that game migration is safe.

1. Inventory Floot identity provider, account IDs, saves, inventories, currencies, purchases, progression schemas and ownership. Establish a supported complete export and consent/identity mapping; do not assume preview JSON import transfers Floot accounts.
2. Take encrypted, access-controlled backups of Floot data and the target database. Record timestamps, record counts, checksums and retention. Restore copies into isolated test environments and compare every entity/count. Do not put player data in this repository.
3. Write idempotent migration with dry-run reconciliation, collision/conflict handling and rollback. Preserve source IDs and saves. Plan writes during cutover to avoid lost progress.
4. Test representative anonymised accounts: sign-in, ownership isolation, new/existing saves, inventory/currency/progression equality, password recovery, concurrent saves, failed/interrupted imports and restore. Verify the documented cloud backup recovery window and perform an actual restore rehearsal.
5. Verify cookies, origin checks, route/assets under /web, redirects, account callbacks, accessibility and mobile behavior on staging. The current preview's root-relative API/assets must be audited before hosting under /web.
6. Obtain explicit approval for production deploy/DNS cutover and a separate decision about Floot retirement only after verified migration, rollback and monitoring. Never delete or unpublish the source game as part of marketing deployment.

No migration, backup or restore rehearsal has been performed by this task. All remain release blockers.

## Studios expansion — separate staging release

- `studio-expand.mjs` adds Hollow Valley and Primalbound as top-level studio projects, with dedicated project landing pages, a news foundation, and project-specific support links.
- `/merch/` is an **interest-only** catalogue (three Hollow Valley and three Primalbound concepts). Its email links are not orders, subscriptions, payments, a marketing database, or a live store.
- Merch artwork is conceptual CSS-only branding. Any future sellable products need original art, IP review, Australian GST/shipping/returns checks, print-on-demand samples, and profitability testing before approval.
- The existing Hollow Valley portal keeps player logins, Wallet, Valley Coins, dinos, Marketplace, Live Map, server bridge, Stripe, and Discord; no gameplay or account code is changed.
- `node brand-sites/build.mjs && node brand-sites/verify.mjs` tests the staging build. The planned production release is subject to separate approval; no production DNS or services are changed.
