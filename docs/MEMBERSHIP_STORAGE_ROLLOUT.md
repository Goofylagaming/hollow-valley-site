# Membership storage: prepared, disabled pending server validation

## What this change does

The automation service can add **1 / 2 / 4** storage slots for Valley Supporter,
Guardian and Legend respectively. It asks the website's trusted
`POST /api/internal/membership-rewards/entitlements` endpoint for **non-coin**
membership entitlement and its expiry. An active paid period can retain storage
benefits after automatic renewal is cancelled; coin eligibility is a separate
existing rule.

No production configuration, stored file, dinosaur, membership, wallet or game
mod is changed by this implementation. The rollout is off by default.

## Baseline finding and activation gates

The checked repository has **no enforced finite standard allowance** in its
website/automation store paths. The DinoStorage Lua file declares a
`maxSlotsPerPlayer = 1` setting, but `cmdStore` does not use it. That declaration
is not evidence that current players have a one-slot limit. Imposing a small
base now could reduce their current access.

Before enabling, verify the actual production storage rules and approve a base
allowance that preserves existing promises. Also verify enforcement across all
BinaryLane entry points, including direct game/chat/mod commands. These external
entry points are not covered by this website/automation patch.

Activation requires all of:

- `DINOSTORAGE_MEMBERSHIP_CAPACITY_ENABLED=true`.
- Explicit positive integer `DINOSTORAGE_BASE_SLOTS`; there is **no default**.
- Existing trusted `HOLLOW_VALLEY_API_BASE_URL` (or `HOLLOW_VALLEY_SITE_URL`) and
  `HOLLOW_VALLEY_API_TOKEN`.
- `DINOSTORAGE_CAPACITY_SERVER_ACK=all-storage-intake-paths-verified`, set only
  after the production game entry points have been reviewed/tested and the
  baseline approved. This acknowledgement is deliberately not configured here.

With the rollout disabled, existing storage behaviour is unchanged. Enabling
the flag without completing configuration fails closed for new admissions;
existing retrieval and recovery remain available.

## Covered automation paths

| Path | Behaviour |
|---|---|
| Normal store requests | Reserve capacity before accepting/publishing `dino_store`. |
| Direct command publication | Guard `dino_store`, `dino_grant`, and marketplace transfer commands. |
| Official catalog purchase | Reserve before deducting coins; synchronous purchase cannot bypass admission. |
| Official fulfillment | Honour already-paid pending orders, including orders from before rollout. |
| P2P purchase | Reserve before wallet hold; failed admission leaves buyer balance unchanged. |
| Direct stored file creation / P2P transfer | Require the same reservation before writes. |
| Listed dinosaurs / cancelled listings | Escrow remains counted as the seller's property until sale/return; returning their property is always allowed. |
| Admin restore | Trusted recovery is exempt. Restored dinosaurs count in the next snapshot and may leave the account withdraw-only. |
| Retrieve, delete, existing-dino edits | Do not require an active membership or a free slot. |

`GET /api/website/membership-storage/:steamId` requires the website service
token and reports configuration, base/bonus/total allowance, stored/escrow/pending
counts, and whether new deposits are blocked. Responses are private/no-store.

## Data and concurrency behaviour

- No expiry routine deletes dinosaurs. At/above the allowance, new admissions
  are blocked while retrieval remains available.
- Capacity decisions use a fresh list, not cached or coalesced pre-write data.
  Oversized/unverifiable FTP slot files fail the check without modifying them.
- A durable per-player admission lock serializes the read/check/reserve phase.
  Its bounded lease is rechecked transactionally before insertion, so a stale
  process cannot write after losing the lock.
- Reservations persist across restarts and count pending/uncertain writes.
  Successful stored evidence replaces a reservation; a confirmed completed write
  can be retired after a newer snapshot shows it has subsequently been consumed.
- A timed-out or partial transfer does not silently free its reserved capacity.
  Investigate uncertain operations using their existing request/order receipt;
  do not replay commands or delete reservations just because a timeout elapsed.
- Failed pre-payment transactions release the reservation. Existing paid orders
  keep their delivery rights after a downgrade or expiry.
- Slot comparisons respect Windows case-insensitive filenames.

## Verification before activation

Run `node --test automation-platform/test/membershipStorageCapacity.test.js`
and the existing storage/marketplace regression suites. The focused tests use
in-memory data and mocks, including expiry, admission races, stale snapshots,
raw/file intake bypasses, escrow, unchanged balances on rejection and already-paid
order delivery. Then perform controlled staging tests for each real transport,
including expiry/downgrade with occupied bonus slots, failed/missing membership
lookups, restart during admission, direct game entry points, and P2P return.

The local tests do not verify BinaryLane's currently installed mod, production
storage settings, or real game restoration. Do not advertise extra slots as live
until those checks and the baseline decision are complete.
