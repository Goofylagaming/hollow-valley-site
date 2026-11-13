# HVS BI construction opportunities pilot

Working isolated Node 24 / SQLite MVP for Hollow Valley Studios. No production deployment, DNS change, live payment, email send or scheduled service was enabled by this implementation.

## Start locally

```sh
npm ci --ignore-scripts
npm test
npm run sync
node src/cli.mjs customer you@example.com --local-preview
npm start
```

Open http://localhost:3080 and enter the access key printed by the customer command. It grants a **24-hour local preview**, not a paid subscription. Keys are stored as SHA-256 digests and kept only in browser memory; share securely, never in URLs or Git. The CLI is trusted operator access, not public signup. Local preview is rejected with `NODE_ENV=production`.

To use environment settings, copy `.env.example` to `.env` and run `node --env-file=.env src/server.mjs`. npm start does not implicitly load .env. For CLI commands with settings, use `node --env-file=.env src/cli.mjs sync`, etc.

Generate all current matching records: `npm run report`. Reports are written under `reports/sample`. The supplied six-record sample was generated from real source data; it is illustrative product output, not a claim that six jobs are open.

## What works

- Three official, openly licensed API/CSV connectors with runtime licence checks, HTTPS host allowlist, bounded pages/downloads, network retries and schema checks. No document scraping or personal applicant/contact harvesting.
- Source-specific normalization, stable identifiers, multi-parcel deduplication, content fingerprints, incremental database updates, source success/failure history and safe handling of disappeared records. Full snapshots are fetched because these feeds do not provide one reliable shared modification cursor. An empty/failed snapshot retains previous records and blocks weekly delivery.
- Saved customer trade/location preferences, protected dashboard, responsive layout, source links, quality flags and PDF/CSV exports. Rule-based relevance is explicitly inferred; no LLM calls or recurring AI compute.
- Weekly changed-record reports, Monday 07:00 Australia/Brisbane scheduling logic, durable job claims and delivery ledger, email preview files and optional Resend attachments. Sending requires explicit configuration, customer consent and a recipient allowlist.
- Dedicated Stripe test/sandbox Checkout, billing portal, signed raw-body webhooks, replay protection, current-state reconciliation, price validation and cancellation/expiry handling. Live keys/events/subscriptions are rejected. Separate BI entitlement tables; no game membership coupling.
- Tests for data mapping, deduplication, failure retention, filtering, CSV injection, PDF creation, webhook signature/timestamp/live-mode/replay, entitlement revocation, Monday timing, send gates, HTTP auth and customer isolation.

## Actual coverage and limitations

| Feed | Coverage / licence | Important limit |
|---|---|---|
| Logan City Council | Undecided development applications; CC BY 3.0 Australia | Application is not a job; old undecided records remain in the official feed. Decision due dates are not bid deadlines. |
| Brisbane City Council | City Plan LGIP future park upgrades; CC BY 4.0 | Infrastructure planning, **not Development.i applications**. July 2025 dataset version; historical delivery status must be checked. |
| Queensland | Forward procurement pipeline CSV; CC BY 4.0 | Future procurement, **not current open tenders**. “Open tender” in procurement method does not mean bidding is currently open. Only construction-related SEQ and explicitly statewide rows are retained. |

See [SOURCES.md](SOURCES.md) for exact endpoints and evidence. Brisbane DA bulk reuse and live QTenders collection are not enabled: a permitted feed or written reuse permission must be established first. No invented deadline, builder contact or project value is inferred. Queensland rows without a clearly matching region are excluded; multi-region rows use the first matching council label (a documented MVP limitation). Statewide is a separate customer selection.

Duplicates within a source are collapsed by application/reference ID; the Queensland CSV lacks an ID, so agency/business-unit/description/region form a deterministic hash. A description edit can therefore appear as a replacement record. Different sources are not automatically merged as if proven to be the same project. Multi-parcel addresses are combined; other attributes use the first source row and receive a quality flag.

This is a focused **private pilot**, not a production subscription platform. Access is operator-provisioned with private keys; there is no public registration, password recovery, MFA or existing HVS SSO integration. Test-only payment code is implemented and exercised with signed fixtures, but an actual Stripe sandbox Checkout/webhook round trip and real email delivery still require credentials and operator testing. Refund/dispute/fraud workflows, GST configuration, customer-key rotation UI, backups/restore automation, alerting and retention policy are production-launch work. A$99 is hypothetical, not a live offer; decide GST-inclusive/exclusive presentation and tax registration before any payment launch.

## Storage and quality behaviour

`src/store.mjs` defines the schema: opportunities (normalized JSON + content hash and observation timestamps), sources, customers (preferences/consent + hashed access token), subscriptions, webhook_events, deliveries and jobs. SQLite WAL and transactions protect updates. All SQL values are bound parameters.

`first_seen` means **first collected by HVS**, not newly lodged. Weekly reports include records whose content changed in the last seven days; the initial baseline can include old records. Provenance contains source/reference URL, dataset URL, licence, attribution and modified source version when supplied. No raw applicant/contact fields are stored. Dashboard flags include inferred trade, missing publication dates, aged applications, old dataset versions and stale collection. Source refresh does not imply the underlying plan was updated.

All source failures block the week's email run. The dashboard continues showing the last successful snapshot with health information. Disappeared rows are retained in storage but excluded from current results; disappearance is not labelled “approved” or “canceled.” Review suspicious count drops in the sources table before distribution. Relevance rules deliberately avoid pretending all buildings confirm a roofing/plumbing/electrical job.

## Billing: sandbox only

1. Create a dedicated Stripe sandbox; do not reuse game payments or production credentials. Configure a restricted test key with minimum necessary Customer, Price, Checkout, Subscription and Billing Portal permissions in the host's secret settings.
2. Create an HVS BI product and recurring monthly **AUD 9900-cent** test price. Set `BI_STRIPE_ENABLED=true`, `BI_STRIPE_KEY`, `BI_STRIPE_PRICE_ID`, `BI_STRIPE_WEBHOOK_SECRET` and the exact `BI_PUBLIC_URL`. This code accepts `rk_test_` and `sk_test_` only. Never commit secrets.
3. Enable a sandbox Billing Portal with cancellation available. The dashboard uses Stripe-hosted Checkout/Portal. No payment fields are collected by this app.
4. Configure snapshot events on `/api/stripe/webhook`: `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`; `invoice.paid`, `invoice.payment_failed`; `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Use the API version used by the pinned SDK. Local testing can use `stripe listen --forward-to localhost:3080/api/stripe/webhook` with the sandbox selected.
5. Verify successful checkout, failed payment, cancellation now and at period end, webhook duplicates and delayed delivery. Success redirects never grant access. The handler verifies the raw body and a 300-second signature tolerance, then fetches current subscription state instead of trusting event order. A failed fetch returns non-2xx for Stripe retry.

Entitlement requires a matching price, active/trialing status, future period end and verification within 24 hours. Portal cancellation at period end retains access until that end; canceled, past_due, unpaid, incomplete, paused or pause_collection revoke access. Access checks refresh Stripe state after 12 hours; weekly delivery refreshes immediately. If Stripe is unavailable and refresh is needed, access fails closed. Subscription item period-end fields are used by the current Stripe API. The email address in BI is the operator-provisioned destination, not a synchronized copy of Stripe contact details.

## Weekly schedule and email

`BI_SCHEDULE_ENABLED=true` makes the single web process check once per minute. Monday 07:00 Brisbane equals Sunday 21:00 UTC year-round. It catches up later on Monday after a restart, but not after Monday ends. Collection starts at/after 07:00, so delivery follows processing; exact inbox arrival at 07:00 is not guaranteed. For a strict delivery SLA, schedule collection earlier in a later release.

`npm run weekly` executes manually. A durable `weekly:YYYY-MM-DD` claim prevents overlap/replay. Failed jobs can be reset with `node src/cli.mjs retry-week`; inspect the error first. A process killed mid-run leaves `running` for operator inspection; do not blindly retry or remove sending/uncertain email rows. This conservative choice avoids duplicate deliveries.

With email disabled, report files and `email-preview.json` are generated for entitled customers without calling Resend. To test sending, explicitly set `BI_EMAIL_ENABLED=true`, a verified `BI_EMAIL_FROM`, `RESEND_API_KEY`, exact comma-separated `BI_EMAIL_ALLOWLIST`, and customer opt-in in the dashboard. Use only approved test recipients. No email was sent during implementation. Provider requests use a deterministic idempotency key. Timeouts leave `uncertain`, which requires manual provider reconciliation rather than automatic resending.

## Staging deployment (not applied)

Use `render.staging.yaml` only for a new isolated service on `feature/hvs-bi-pilot-20261113`, root directory `hvs-bi`. It uses a separate persistent disk and no custom domain. Starter service/disk may incur costs; review Render's quoted cost before applying. Set `BI_PUBLIC_URL` to its assigned staging URL. Use **one instance and one process**: SQLite and in-process scheduling are intentionally small-pilot choices. Do not add a separate Render cron job with its own filesystem or share the production database.

Keep email, scheduler and Stripe off for first boot. Run sync manually, inspect source health, provision pilot customers, configure sandbox billing and perform acceptance checks before enabling a schedule. Back up the SQLite file consistently with SQLite's backup facilities; restore-test it before customer launch. Stop the isolated service to roll back. No existing service, domain or route needs modification to review staging.

Do not deploy to the existing `hollow-valley-site` service or change its master branch. It auto-deploys. Do not modify the separate game automation or HerbyBot services. After a future production approval, the studio marketing site could link to a dedicated BI subdomain; DNS and that link are intentionally absent here.

## Verification recorded 13 November 2026

- Official live sync: 1,036 Logan applications, 103 Brisbane plans and 42 filtered Queensland procurement records. Counts are observations, not available-job counts.
- Repeat Logan/Brisbane sync: zero inserts/updates before subsequent relevance-rule changes.
- Automated tests: 13 passing; pinned dependency audit: zero known vulnerabilities at time of check.
- Hidden-browser acceptance check: saved civil/Brisbane filters returned 103 records; no browser errors and no horizontal overflow at 390px width. Desktop/mobile screenshots inspected.
- Real-data six-record PDF: two pages, rendered and visually inspected; CSV provided alongside it.
- No production deployment, live charges, actual email or active hosted schedule.

Read [BUSINESS.md](BUSINESS.md) for workflow, hypothetical pricing and initiative comparisons, and [INFRASTRUCTURE.md](INFRASTRUCTURE.md) for the read-only inspection.
