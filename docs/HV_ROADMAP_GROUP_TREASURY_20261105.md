# Group Treasury — roadmap #17

## Authority and scope

Valley Coin balances for Steam-linked players are authoritative in the automation service's `economy_wallets` and `economy_wallet_ledger`. The website's legacy wallet tables are not used for Treasury transfers. Website Groups use a separate database and remain the authority for active membership and ownership.

The full roadmap requires voluntary member donations and group spending for Territory entry, event registration and cosmetic purposes. Combat-power purchases are excluded. Treasury balances are separate from non-spendable group XP. This implementation does not authorize automated payouts or game commands.

## Local accounting foundation

`createGroupTreasury(economyStore)` adds group balances, immutable donation receipts and a group ledger to the authoritative economy database. A donation debits the player's existing wallet and credits the target website group in a single `BEGIN IMMEDIATE` transaction, retaining correlated personal/group ledger entries and a durable request key. A request replay returns the original receipt; different actor, group or amount under the same key fails. A receipt missing either accounting leg fails closed and does not create a replacement debit.

Amounts and balances must remain whole, nonnegative safe integers. Insufficient funds, overflow, namespace collisions and audit failures leave both balances unchanged. Group history is bounded to 50 entries without donor Steam IDs or request keys. Donors can retrieve only their own receipt. Both internal methods still require trusted-caller authorization; the service itself cannot assert website membership from a separate database.

The service defaults off behind `GROUP_TREASURY_ENABLED=1`. It is not mounted in the runtime and has no website donation controls. Local tests use synthetic balances only and exercise an actual new-process retry plus competing independent processes sharing SQLite. Existing wallet/marketplace test cleanup now closes SQLite handles before verified temporary-directory deletion, allowing those regressions to run on Windows.

46 local checks pass across Treasury accounting, the existing authoritative wallet and marketplace, retained roadmap ballots and homepage integration. Roadmap #17 has left the idea-stage ballot while historical votes remain recorded and free active slots. The homepage release register uses asset version 85. A dedicated hosted test workflow is prepared but has not been published.

## Required integration before rollout

- Website session, exact-origin JSON, preview restrictions and explicit donation confirmation must authorize a durable intent against the displayed website group ID. Retain actor, amount, request ID and authorization time before crossing services. A delayed action after a membership change must not target a replacement group.
- Define acceptance/reconciliation behavior when membership or ownership changes between authorization and execution. An ambiguous timeout must reuse the same immutable intent and request key; it must not create a new donation or an automatic refund.
- Mount a website-token-protected automation API and session-bound website proxy. Private group reads require current membership; receipt reconciliation must remain donor-scoped after leaving. Treat service availability and rollout flags independently.
- Resolve group closure, retained balance access and refund/cancellation rules before accepting real coins. No closure redistribution rule is inferred from the roadmap.
- Add owner-authorized spending with reviewed purpose/cost catalogs, recorded fulfillment and recovery. Territory/event registration is in the website database and cannot be claimed atomic with the automation ledger without an explicit reservation/fulfillment protocol. Cosmetics must remain cosmetic.
- Verify UI, privacy, concurrency, group transitions, backups, hosted CI and authenticated staging. Obtain separate merge/deployment approval before production. Original roadmap #17 remains Building / Testing, with no release date.
