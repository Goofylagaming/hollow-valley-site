# Group Treasury — roadmap #17

## Authority and scope

Valley Coin balances for Steam-linked players are authoritative in the automation service's `economy_wallets` and `economy_wallet_ledger`. The website's legacy wallet tables are not used for Treasury transfers. Website Groups use a separate database and remain the authority for active membership and ownership.

The full roadmap requires voluntary member donations and group spending for Territory entry, event registration and cosmetic purposes. Combat-power purchases are excluded. Treasury balances are separate from non-spendable group XP. This implementation does not authorize automated payouts or game commands.

## Local accounting foundation

`createGroupTreasury(economyStore)` adds group balances, immutable donation receipts and a group ledger to the authoritative economy database. A donation debits the player's existing wallet and credits the target website group in a single `BEGIN IMMEDIATE` transaction, retaining correlated personal/group ledger entries and a durable request key. A request replay returns the original receipt; different actor, group or amount under the same key fails. A receipt missing either accounting leg fails closed and does not create a replacement debit.

Amounts and balances must remain whole, nonnegative safe integers. Insufficient funds, overflow, namespace collisions and audit failures leave both balances unchanged. Group history is bounded to 50 entries without donor Steam IDs or request keys. Donors can retrieve only their own receipt. Both internal methods still require trusted-caller authorization; the service itself cannot assert website membership from a separate database.

New donations default off behind `GROUP_TREASURY_ENABLED=1` on both services. The accounting API and website proxy are mounted, with no website donation controls yet. Local tests use synthetic balances only and exercise actual new-process retries plus competing independent processes sharing SQLite. Existing wallet/marketplace test cleanup now closes SQLite handles before verified temporary-directory deletion, allowing those regressions to run on Windows.

Roadmap #17 has left the idea-stage ballot while historical votes remain recorded and free active slots. The homepage release register uses asset version 86. A dedicated hosted test workflow is prepared but has not been published.

## Durable website consent and recovery

The website binds every request to the authenticated Steam session, exact-origin JSON and writable deployment settings. Preparing a donation stores a draft with the displayed website group ID, snapshot name, amount and durable server request ID. Client retry keys are donor-scoped. Reusing a key with different details fails; one unresolved draft/submission per donor prevents a new request from bypassing an uncertain outcome. Preparation never debits coins. Confirmation requires a separate explicit boolean and the saved group ID, then validates current membership and records authorization plus its audit event atomically before calling automation.

An authorized submission can already be in flight when membership changes. Later confirmation attempts query the existing outcome and never resend a donation to a former group. An ambiguous transport or receipt/audit failure retains submitted state, with the same immutable ID and a safe error code. Reconciliation only queries accounting evidence. Matching receipts settle the local state; mismatched group, amount or request ID remains pending. Donors retain access to their own requests after leaving. Current group balances require current membership, including a second membership check after the network read. Group responses and donor responses omit Steam IDs.

Cancellation before submission is local and permanently blocks confirmation. Cancellation of an uncertain submission uses the same accounting lock as donation: it either returns the already-committed receipt or stores a durable cancelled request that prevents later debit under that ID. It never refunds a committed donation. Cancellation and outcome reads remain available when new donations are switched off. Deployment preview protections still block state-changing website endpoints.

The automation endpoints require the private website integration token and trust the website's membership/consent authorization. They do not expose a browser credential. New request-outcome records, website intents and their audit events are additive. No automatic retry scheduler, automatic refund, payout or game command is installed.

62 local checks cover accounting, wallet/marketplace regressions, website-to-automation HTTP authorization, lost responses, coordinator reinitialization, immutable consent, membership replacement, cancellation races across processes, mismatched evidence, failed audits, retained votes, homepage integration and website startup. These use temporary databases and synthetic balances. Production Steam sign-in and hosted behavior remain unverified.

## Required integration before rollout

- Add donation review, confirmation, cancellation and recovery controls to the website. Explain the stored group/amount, in-flight uncertainty and committed-donation cancellation behavior. Verify desktop/mobile behavior without performing real coin transfers.
- Resolve group closure, retained balance access and refund/cancellation rules before accepting real coins. No closure redistribution rule is inferred from the roadmap.
- Add owner-authorized spending with reviewed purpose/cost catalogs, recorded fulfillment and recovery. Territory/event registration is in the website database and cannot be claimed atomic with the automation ledger without an explicit reservation/fulfillment protocol. Cosmetics must remain cosmetic.
- Verify UI, privacy, concurrency, group transitions, backups, hosted CI and authenticated staging. Obtain separate merge/deployment approval before production. Original roadmap #17 remains Building / Testing, with no release date.
