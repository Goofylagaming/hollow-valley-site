# Roadmap #23 — player skin gifting

Local branch: `feature/hv-roadmap-gifting-20261105`, following the prepared
collections branch. Authenticated APIs and website controls are locally implemented; no deployed settings enable gifting.
The default gate requires `SKIN_GIFTING_ENABLED=1` and the skin-system flag.

A sender offers a permanent non-membership unlock to a particular Steam account.
The sender keeps ownership while the seven-day offer is pending. The recipient
may accept or decline; the sender may cancel. Only one pending offer per sender
and skin is allowed, with up to ten offers per day. Exact request retries return
the existing offer. Expired offers free that slot without transferring anything.

Acceptance rechecks the current palette/creator fingerprint, original unlock
receipt, sender access and recipient ownership. It atomically moves the existing
unlock row to the recipient and stores the original receipt in an immutable
decision record. It does not duplicate skin definitions, move coins or change
wallet transaction history. The recipient may receive an empty wallet row needed
by the existing unlock schema. Declines, cancellations, expiry and errors preserve
the sender's unlock. Only the two participants can list a gift.

Borrowed grants, creator-owned designs, membership skins and freely accessible
skins are excluded. Already applied dinosaur appearances are not changed by this
service; it does not send game commands. Live-application lifecycle compatibility
still needs review before enabling player transfers.

Six service tests pass: ownership movement, exact retries, participant isolation,
conflicting offers, terminal decisions, expiry, changed palettes/receipts,
recipient ownership, rollback and eligibility. Replaying a promotional code after
gifting cannot regrant the skin; its response/UI now distinguishes previous
redemption from current ownership. Five existing promotion tests also pass.

Remaining: parked-edit concurrency and live game verification, authenticated staging and production
verification. The full roadmap remains unfinished.

## Website/API integration

`/skin-gifts` is linked from profile collections. The sender chooses an eligible
permanent unlock, enters a 17-digit recipient Steam ID and confirms they checked
it. Only that recipient can accept or decline; acceptance asks for confirmation.
Senders can cancel. Exact request retries retain the original request ID, and
failed offers retain their form fields. Text is rendered without HTML injection.

Private APIs bind every read/write actor to the authenticated session, ignoring
forged body/query identities. Same-origin JSON, linked Steam and the existing
read-only preview guard protect writes. A read-only eligible-skin endpoint omits
pending gifts and returns only name/species/ID summaries for up to 500 recent
unreserved unlocks. No automatic friends or recipient-directory lookup is added.

Eight service/HTTP tests pass. Isolated browser fixtures pass at 1440px and 390px
for offer retry, cancellation, recipient acceptance, safe text, preview/guest/
disabled states and layout. These do not substitute for authenticated staging or
real game verification. `SKIN_GIFTING_ENABLED` remains off by default on both
website and automation services.

## Transfer concurrency and Wear Live

Independent SQLite workers now verify competing offers for one unlock, duplicate
acceptance, retry after reopening and acceptance racing cancellation. Exactly one
receipt and decision survive. Wear Live now repeats its ownership/skin check under
a write lock immediately before recording a queued job, after its async server
snapshot read. Gift eligibility and acceptance reject skins with queued or
awaiting-confirmation applications. No network call runs inside the write lock.

Tests prove that a gift committed during the snapshot wait stops the former owner
from queueing a command, and that a pending application blocks gift acceptance
until terminal status. The existing seven Wear Live tests still pass. These use
a mocked command bridge and do not prove in-game application/reconciliation.
Parked-dinosaur skin editing has a separate async flow and still requires review
before gifting is enabled. No production feature flags were changed.
