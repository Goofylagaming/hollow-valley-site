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

## Parked storage-read ownership check

Parked skin application now rechecks ownership and palette after the asynchronous
stored-dinosaur lookup. Tests simulate gift acceptance and palette modification
during that lookup and verify that neither sends an edit. The 24 targeted parked,
preset and membership-skin checks pass.

This closes only the lookup gap. Parked `runImmediateCommand` currently publishes
and then waits for an outcome without a skin-specific durable reservation. A
timeout is uncertain, not proof of failure. Before enabling gifting, the
publication phase still needs a durable command/ownership reservation and
reconciliation that does not release a transfer hold merely because time elapsed.
No actual game commands or runtime flag changes were made during these tests.

## Durable parked-command holds

The parked publication gap described above now has a local implementation. Before
queueing, the storage command hook rechecks ownership under a SQLite write lock
and records the exact command ID, payload, account, skin and slot in an additive
`economy_skin_parked_applications` table. Pending records block gift offers and
acceptance. Acknowledgements, timeouts and uncertain publication errors do not
release the hold. Only a confirmed or failed outcome for that command can resolve
it. No network operation runs while the write lock is held.

The gifting page adds an explicit Check pending skin applications action. Its
session-bound POST reconciles up to 25 pending records by reading outcomes, never
by publishing another command; previews cannot invoke it. A later parked apply
also checks pending outcomes before trying to reserve a new command.

Thirteen focused service, storage-hook and HTTP checks pass, plus the gifting
browser fixture at 1440px and 390px. They cover storage lookup races, durable holds
after service reinitialization, unchanged command IDs, withheld transfers while
acknowledged, publication errors, and reserve-before-queue ordering. Existing
preset and membership-skin regressions also passed after the integration.

An interrupted process before publication may leave a hold with no game outcome.
It is deliberately not expired automatically; operator reconciliation needs
verified evidence before such a hold can be resolved. True process-restart tests
for parked holds and authenticated staging/live-server verification remain pending.
Gifting remains disabled; these tests did not send actual game commands.

## Process-exit verification

A new test writes the parked hold in a child process and exits without closing
its database connection. Subsequent, independent child processes reopen the same
file. Missing, acknowledged and unreachable outcomes preserve the hold even with
the reconciliation clock advanced by a year. The original command ID is the only
one queried. Ownership stays with the sender until a confirmed outcome resolves
the hold, then one acceptance transfers the existing unlock and a restarted retry
is a duplicate. This test passes locally and is included in Membership Rewards CI.
It does not contact a game server. Authenticated staging, live outcome behavior
and operator handling of a never-published interrupted command remain unverified.

## Proven pre-publication rejection

CommandBridge now marks errors from publisher/configuration/capacity preflight
with `commandNotPublished=true`, before either HTTP enqueue or file publication
is invoked. Parked skin application resolves its newly reserved hold as
`not_published` only on that explicit evidence. It does not label the skin applied.
Errors after invoking either publisher remain uncertain and keep the hold.
Reconciliation accepts only confirmed/failed game outcomes; it does not infer a
not-published state from missing or unrecognized responses.

Fourteen bridge/parked tests pass, including both transports, preflight failure,
uncertain publication, ownership checks and real process reopening. A process
crash without a caught rejection still cannot be safely treated as unpublished;
those holds remain unresolved pending authoritative evidence.

Wear Live publication uncertainty: publishing errors now retain an awaiting-confirmation job unless the bridge explicitly proves the command was not published. The original request ID is retained on the error. Missing or acknowledged outcomes continue to block transfer; an explicit confirmed outcome resolves the hold without republishing. Local regression fixtures cover both uncertain publication and proven pre-publication rejection. Live game and staging verification remain pending.
