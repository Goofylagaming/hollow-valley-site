# Skin-market support and moderation — local development

This follows the disabled #21 player market. It is not a production release.
SKIN_TRADING_MANAGEMENT_ENABLED=0 on website and automation keeps management
unavailable. SKIN_TRADING_READ_ONLY and the website's existing preview safety
independently block changes. Initial review-schema preparation is permitted only
in explicitly enabled writable source access; missing tables in preview remain
unavailable. The player market's writable schema preparation also creates empty
moderation tables so holds can be enforced on every sale. No production flag,
schema, wallet, skin, game state or source connection was changed here.

## Resulting behavior

Staff can inspect an exact listing reference, its seller, an existing buyer/price
receipt, the current design hold, and up to twenty recent listing/design reviews
each. Raw unlock receipts, palettes and ledger metadata are not returned. Player
cards provide a support reference and report link; private staff notes/identities
never appear in player market projections.

Withdrawing closes one active unsold listing. The seller keeps the unlock and may
create a different listing; withdrawal alone does not ban the design. A resale
hold instead blocks new listings and purchases for the design across owners and
listings. It does not revoke access, stop existing wear/gifting, refund a sale,
remove a skin, change a palette, alter a dinosaur or issue a game command. Seller
cancellation remains available while a design is held. Releasing a hold may make
existing active listings available again; cancelled/withdrawn listings stay
closed. Completed sales are never reversed by these controls.

Every change needs an exact target/revision, a private 5–500 character reason and
an operation key. State and immutable review/receipt commit in one SQLite immediate
transaction. A failed audit insertion rolls the change back. Exact retries return
the original receipt; changed inputs using the same key conflict. Holds enforce
their latest recorded revision even while management is paused. Missing, rolled
back or contradictory hold/request/receipt history fails closed instead of
silently authorizing a sale. Backward/future listing/hold clocks block affected
changes; historical completed purchase receipts remain recoverable.

Independent workers race purchases against hold/withdrawal. A purchase that commits
first remains paid; a hold/withdrawal that commits first blocks the purchase.
Neither ordering moves the unlock twice or creates an unmatched wallet entry.
These tests do not prove distributed game delivery, which is not part of this
website-only skin-unlock market.

## Private access and staff page

/api/admin/skin-market on automation requires the separate AUTOMATION_ADMIN_TOKEN,
not the website/player token. /api/admin-skin-market verifies current linked staff
against the website users table before and after asynchronous work. An exact
reviewer-binding header, same-origin JSON and strict request fields reject actor
overrides. Responses are private/no-store. A late role/account/rollout change can
withhold acknowledgement after a legitimate change already committed; callers
must inspect its saved receipt/history rather than infer rollback.

/adminskinmarket and its .html path use the existing admin-page gate and staff
navigation. Lookup is read-only. Review freezes the action, scope, private reason,
revision and operation key without writing; Confirm sends it explicitly. The
scope text distinguishes one listing from all resales of a design. Lost replies
retain the request and expose explicit receipt checking or same-request retry;
no automatic replay occurs. A saved action followed by a failed detail read stays
recoverable. Account/role/visibility changes clear private facts, reasons, reviews
and histories, with no browser storage. Names/notes are text, not HTML. The page
suppresses the shared daily-login write and polls only current access, not source
records. Each later listing lookup or recovery is explicit.

## Evidence and remaining gates

151 combined local checks pass across moderation, trading/gifts, private spectator,
diplomacy and production-page regressions. They include real website/source HTTP
access, separate credentials, actor overrides, role revocation, independent
preview gates, schema-free read-only failure, query-only support reads, audit
rollback, corrupt/reverted hold evidence and independent worker races. Actual
player and staff pages have desktop/phone fixtures for lost replies, exact retry,
scope reviews, paused/preview states, held reads during account/role changes,
private clearing, safe text, storage/write rejection and width. The staff phone
layout was visually inspected. Local runtime: Node 24.22 and Edge.

These are synthetic fixtures. Hosted checks for this follow-up, real staff/player
Steam staging, approved moderation/retention/trading terms, broader creator and
palette lifecycle compatibility, schema/index cost and capacity, backups/recovery
and production verification remain required. The user-approved 90-day report
chat/combat policy is unchanged and is not a financial-review retention policy.
No real financial reversal or compensation is authorized by this implementation.

Roadmap #21 stays `Working on`, original wording and historical votes remain, and
seven ideas remain eligible. Homepage roadmap asset is v161. The general register
now displays `Working on` for development/testing and reserves completion for
verified live delivery, per the user's explicit standing instruction.
