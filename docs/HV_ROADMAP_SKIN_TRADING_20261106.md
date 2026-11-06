# Roadmap #21 — player skin trading

Local core checkpoint only. There is no mounted HTTP API, website controller,
automatic worker or default service instance. New sales require
SKIN_TRADING_ENABLED=1 plus SKIN_SYSTEM_ENABLED=true when the domain service is
eventually called; the configuration example stays off. Nothing was executed
against production wallets, skin ownership or game state.

The initial permanent-skin market uses the same transfer eligibility as gifting.
Borrowed grants, premium/membership/free-access and creator-owned designs are
excluded. A permanent unlock must have its original receipt, with no unresolved
live or parked application. Creating a listing retains the seller's unlock and
does not move coins. A listing freezes its price, palette/creator fingerprint and
original unlock receipt. One active listing per seller/skin is allowed. Local
development defaults are seven-day listings and twenty new listings per day;
production trading terms and retention still require review.

Buying requires the exact displayed price and revision. A single SQLite immediate
transaction rechecks ownership, palette, receipt, recipient access, pending gifts
and application holds, verifies both wallet balances against their ledger sums,
then moves the existing unlock, writes a buyer debit and equal seller credit,
stores the original unlock receipt and closes the listing. No fee or new currency
is created. These ledger kinds are distinct from gameplay coin rewards. Unsafe
balances and accounting drift block settlement. Any error rolls back all effects.

Successful purchase retries recover the same receipt and do not debit again;
changed inputs using the same key conflict. Receipt recovery and a seller's own
listing reads/cancellation work while new trading is paused. Browse projections
and receipts omit seller/buyer Steam IDs, raw unlock receipts and internal keys.
Stale listings never promise ownership: the transaction checks current evidence.
A pending gift blocks buying, and a completed gift makes an old listing invalid.
Confirmed old dinosaur appearances are not removed and no game command is sent.

Local tests use real store/skin-purchase schemas and synthetic accounts. They
cover paired zero-sum ledger entries, original unlock preservation, retries,
conflicting quotes, eligibility, missing funds, failed-receipt rollback, expiry,
paused cancellation, private projections, wallet drift and overflow. Independent
database workers compete for a listing, retry the same purchase and race a sale
against cancellation. Existing gifting/live/parked concurrency tests also pass.
The checkpoint's dedicated workflow command passes 65 local checks, including
gift compatibility, voting/history preservation and production-page regressions.
These checks do not verify an HTTP/API boundary or player trading UI, which have
not yet been implemented.

Roadmap #21 remains Building / Testing. Original wording is preserved. Historical
votes remain stored but no longer consume an active ballot slot; seven ideas
remain eligible. Homepage roadmap asset is v158.

Remaining: private account-bound APIs and quote/receipt recovery, player listing
and purchase controls, paginated buyer/seller trade history, moderation and
support operations, creator/palette lifecycle compatibility, production terms,
policy/retention approval, performance measurements, authenticated staging and
production verification. The full feature is not delivered. No automatic rewards,
external messages, real transfers, merge, deployment or source activation are
included in this local checkpoint.
