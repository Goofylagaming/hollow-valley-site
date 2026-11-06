# Roadmap #21 — player skin trading

Local service/API/player-page implementation, not a delivered release. The
website and token-protected automation routes are mounted; the domain service is
initialized lazily after private source authentication. There is no automatic
worker. New sales require SKIN_TRADING_ENABLED=1 on both hosts plus
SKIN_SYSTEM_ENABLED=true in automation; the configuration example stays off.
An uninitialized source cannot create the trading schema while paused or in
read-only mode. Existing paused history uses initialize=false and performs only
reads; query-only SQLite tests verify this boundary. First writable initialization
and its schema/index cost still require the normal deployment/staging approval.
Nothing was executed
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
This was the earlier core checkpoint. Subsequent real-HTTP and browser checks
exercise the API and player page described below.

## Private APIs and player controls

The website's /api/skins/trading endpoints verify the current linked identity
against the users table. Capabilities provide a traderBinding, required in the
X-Skin-Trader header of every private operation. Actors come from the session;
body/query account overrides are rejected. Same-origin JSON is required, including
read RPCs. The automation source independently requires the configured website
bearer token. Both sides return private/no-store responses. Website preview safety
and SKIN_TRADING_READ_ONLY independently block mutations; the source has its own
read-only switch. These examples remain 0 with trading disabled.

Operations are list, eligible, history, offerReceipt, receipt, ownListing, offer,
buy and cancel. Read operations use POST transport but execute no settlement
mutations. Paused trading retains personal history, listing/receipt recovery and
seller cancellation; preview still prevents cancellation. The website rechecks
identity after asynchronous work and withholds late private results if it changed.
A mutation may already have committed before a late access/rollout change; the
caller must check its saved receipt, not infer rollback from the error response.
The fixed client bounds response bytes/time and does not forward credentials or
raw internal failures to the page.

/skin-trading, linked from Marketplace, shows eligible permanent skins, available
listings, personal listings and buyer/seller history. Review freezes the skin,
price, revision and operation key without writing. Confirm sends the frozen
request. Uncertain replies preserve it and offer explicit saved-status checks or
retry of the same request; there is no automatic replay. Listing and purchase
receipts recover original outcomes. Cancel recovery reads the exact own listing.
Refresh cannot discard an uncertain operation. New account/access/visibility
contexts clear private views and request state, with no browser storage. Source
reads happen only on explicit page load, refresh, pagination or status checking;
the periodic account check only revalidates sign-in.

Browse and history pages accept a bounded 1–50 size. The page requests twelve
records on desktop and six on phones; eligible skins page through fifty source
unlocks at a time. Indexed private histories preserve all records while replacing
the current visible page. Owned skins and the seller's own offers cannot present
a buy control. Names render as text, and the page suppresses the shared daily-login
claim. Unexpected API writes fail the browser fixture.

142 distinct combined trading/gifting/spectator/diplomacy and production-regression
tests pass locally. Real website/source HTTP tests verify current account binding,
receipt privacy, rejected overrides/origins, independent preview gates, paused
recovery and late account/rollout changes. Actual-page 1440px/390px checks pass for
review without writes, pagination, lost listing replies, status recovery, paused
cancellation, lost purchase replies, same-key retry, current wallet/unlock state,
read-only mode, held responses across account changes, guest clearing, safe text,
no browser storage or unexpected API writes, and page width. The phone layout was
visually inspected. Local runtime is Node 24.22 with Edge; these are synthetic
fixtures, not authenticated hosted staging or Linux browser evidence.
Delayed pagination is staged until the post-read account check succeeds; a
mutation-observer fixture confirms that zero late private rows enter the DOM
after an account switch.

The Dynamic challenge workflow now also triggers when its purchases browser
fixture changes, addressing the script-only coverage gap observed on #328.

Roadmap #21 remains Building / Testing. Original wording is preserved. Historical
votes remain stored but no longer consume an active ballot slot; seven ideas
remain eligible. Homepage roadmap asset is v161, with the visible development
label `Working on` per the user's standing instruction.

Staff listing withdrawal, design resale holds, private support history and the
review/confirm staff page now have local service/API and desktop/phone checks.
See HV_ROADMAP_SKIN_MARKET_REVIEWS_20261106.md for scope, separate disabled
management flags, audit consistency and role protections. The latest combined
local run passes 151 checks. Neither player trading nor moderation is delivered.

Remaining: real moderation/support operation verification, broader creator/palette
lifecycle compatibility, production terms,
policy/retention approval, performance measurements, authenticated staging and
production verification. The full feature is not delivered. No automatic rewards,
external messages, real transfers, merge, deployment or source activation are
included in this local checkpoint.
