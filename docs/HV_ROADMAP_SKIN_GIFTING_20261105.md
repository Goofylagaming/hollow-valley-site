# Roadmap #23 — player skin gifting

Local branch: `feature/hv-roadmap-gifting-20261105`, following the prepared
collections branch. Service only so far; no deployed routes or UI enable gifting.
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

Remaining: API and website controls, recipient selection/confirmation, concurrent
worker races, live-skin lifecycle review, authenticated staging and production
verification. The full roadmap remains unfinished.
