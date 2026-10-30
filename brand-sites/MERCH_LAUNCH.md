# Hollow Valley Studios merchandise storefront

## Which site is this?

The customer-facing store is built in the **actual parent-site repository**:

- GitHub: `Goofylagaming/hollow-valley-site`
- Production Render static site: `hollow-valley-studios` (`srv-dbfd3ue7bikc73d2nac0`)
- Production deployment branch: `production/brand-websites-20261026` (auto-deploy **off**)
- Staging Render static site: `hollow-valley-studios-staging` (`srv-dbfccc7b9u1s73cd84f0`)
- Staging deployment branch: `staging/hollow-valley-studios-20261026` (auto-deploy **off**)
- Intended customer route: `https://hollowvalleystudios.com/merch/`
- Staging URL: `https://hollow-valley-studios-staging.onrender.com/merch/`
- Owner-provided public Fourthwall shop URL: `https://hvs-e-commerce-shop.fourthwall.com/`

The parent site is a static Render site. Do not deploy this route to `hollow-valley-site` (the separate live The Isle server), `primalbound-site` or an unrelated repository/service. This change does **not** touch databases, accounts, Discord, Steam, Valley Coins, live maps, support subscriptions, or the game backend.

## What is implemented?

- **Book 1 remains the sole upcoming product under active development.** The user-approved, already-existing Hollow Valley Chromie Hoodie is displayed with a direct link to its Fourthwall product listing. Books 2–5, **new** hoodie designs, T-shirts, stickers, sourced products and all other expansion remain on hold until 10 verified profitable Book 1 customer orders.
- Original CSS-made sample illustrations; **not** finished designs, mockup proofs or photos of items.
- Explicit draft/preparation statuses on all products; no implied stock, real prices, live product URLs or checkout on this site.
- One public link to the existing Fourthwall storefront **and** a direct link to the existing Chromie Hoodie listing: https://hvs-e-commerce-shop.fourthwall.com/en-aud/products/hollow-valley-chromie-hoodie . This user-provided product URL does not confer API or admin access, and price, stock, product images, size and shipping have **not** been independently verified.
- A `/merch/` navigation link on the production parent homepage.
- A source file publisher copies `brand-sites/merch/{index.html,styles.css,app.js}` into `brand-sites/dist/hollow-valley/merch/` after regular site generation. Only this output is modified.
- Staging adds `noindex,nofollow` metadata; production does not.
- JS is confined to a same-origin copyright year display. No cookies, forms, PII, payment handling, ecommerce SDK, external tracking or personal data collection.
- `node --test brand-sites/test/merch.test.cjs` enforces Book 1-only *new-product* development plus one existing Chromie Hoodie listing, hold-state copy, link accuracy, static safety and script behavior.

## Build and verify

```bash
node --test brand-sites/test/merch.test.cjs
node brand-sites/build.mjs
node brand-sites/verify.mjs
node brand-sites/build.mjs --production
node brand-sites/verify.mjs --production
```

The generated `dist/` output is ignored and must not be committed. The production static site uses `node brand-sites/build.mjs --production && node brand-sites/verify.mjs --production`, publishing `brand-sites/dist/hollow-valley`. Do not edit deployed files manually.

## Deployment approval and rollback

1. CI passes on the PR. Verify unchanged World and Web wikis, patch notes and parent homepage.
2. Check staging or a preview release on desktop/mobile for HTTP 200, style and JS assets, keyboard navigation and genuine Fourthwall link. Render build status alone doesn't prove external browser verification.
3. Obtain explicit owner approval before merging/publishing to the existing production branch and triggering `hollow-valley-studios` deploy. No DNS edits should be needed for the route if the domain already maps to this service.
4. Re-verify `https://hollowvalleystudios.com/merch/` after production deploy, using real browser testing.
5. If release fails, roll back the **static studio site** to its previous successful Render deployment. Never roll back the live The Isle portal to change this page.

## Becoming a shop (not yet complete)

Fourthwall administrative authorization is **not** configured; a public URL is not sufficient. The owner needs to authenticate directly to Fourthwall to create real listings, approve download assets/rights and pricing, and see platform-reported orders and costs.

For the first Primalbound book, complete the printable/digital PDF and cover, check content ownership and age suitability, inspect real listing fees, tax/GST, download fulfilment, refunds, and final AUD price before adding a direct product checkout link. Book 1 remains NOT FOR SALE until these pass. Record verified order profit privately and keep customer identifiers out of GitHub. Do not lift the hold on any other product line until 10 paid, fulfilled and profitable real-customer orders are confirmed. Check that the earlier exposed Fourthwall Open API account was revoked/rotated before any store automation resumes.

Only real fully paid orders with a positive contribution after direct costs count towards **10 genuinely profitable orders**. Never fabricate product availability, customers, sales counters or profit. No customer details belong in GitHub or frontend JS.

The existing HVS E-Commerce Windows helper is a separate **local-only drafting app**, not the customer storefront or a connected payment processor.
