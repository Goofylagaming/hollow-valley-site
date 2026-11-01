# Hollow Valley Random Dinosaur Events (1 Nov 2026)

**Scope:** temporary, species-specific extra Valley Coin payouts, with no
The Isle game-server restart and no global growth edits.

## Feature gates

`SPECIES_COIN_EVENTS_ENABLED=false` is the default, deliberately denying
all new event activation and credit until the automation release is tested and
the operator explicitly enables it on Render. Changing the Render feature
flag may restart the *automation service*, but does not restart the game.

This is independent of `WALLET_PLAYTIME_REWARDS_ENABLED`: a future
event-only test is possible without changing the existing 5-minute wallet
baseline. Every event credit is additional, as a separate ledger kind
`species_event_bonus` with idempotency and exact source metadata.

## Website

- Admin → Operations → **Random Dinosaur Events**.
- Select a playable species from Hollow Valley's roster.
- Enter a name, bonus (1–1000 VC per eligible minute), duration
  (5–720 minutes), and optional future start. No restart is involved.
- The creator must have an authenticated Steam-linked administrator session.
- View active, scheduled, stopped and expired events; stop one immediately.
- Event expiry is computed from its absolute UTC deadline and is effective
  even if the automation scheduler isn't running.
- Public Events page lists active/upcoming species coin bonuses with
  countdowns, without exposing SteamIDs or protected settings.
- **Species-only growth is explicitly unsupported.** Evrima's native
  `setgrowthmultiplier` affects all species; do not claim it isolates a
  single dinosaur or restore settings unverified.

## Economy design

The live BinaryLane presence feed already supplies accepted RCON snapshots
approximately every 17–26 seconds during recent observation.
Credits are computed against the server-authoritative sampled timestamp,
SteamID64 and canonical playable species, never user/client submissions.

- Require two successive valid presence samples, with <=90-second gap,
  from the same SteamID with matching species.
- Accrue eligible overlap with the configured event start/end times.
- Pay only whole completed 60-second periods. No retroactive rewards for
  disconnects, stale scans, wrong dinosaurs, pending events, stopped events
  or after expiry.
- Once an eligible minute is credited, insert an idempotent entry in the
  existing Valley Coin ledger. A retry of the same event/player/minute
  cannot duplicate the payment. Transaction metadata records the event ID
  and eligible species.
- A change in species or missing class resets the event streak.
- Different species may have overlapping events. Two overlapping coin
  events for the same species are rejected to prevent double payouts.
- The event payout is flat, not separately multiplied by supporter/quest
  boosts; those remain part of the normal existing reward stream.
- A cancelled supporter remains eligible for a **public event's flat
  reward**, but loses supporter-exclusive multipliers under supporter
  cancellation fix PR #273. This is deliberate: events are available to
  all eligible players unless a future event declares a specific tier.

## Announcements

When **Automatically announce start and end** is selected, the existing
automation scheduler runs a 15-second sweep and queues start/end notices
to the community announcement and server-progress Discord destinations,
using unique event+phase+channel nonces. The existing durable HerbyBot
outbox makes repeated scheduler sweeps idempotent; delivery is asynchronous
and requires the bot's configured channel IDs. Failure to post a Discord
message does not stop a legitimate event or issue duplicate coin credits.

The existing Admin Hub Feature Announcements composer remains available for
additional verified manual messages; a 'Prepare announcement' action
populates that composer. Do not queue a second manual post for an event
that already had automatic notices, unless an additional announcement is
intended. In-game announcements still require a separate verified RCON path.


## Rollout and rollback

1. Run website and automation tests, inspect CI and Render health.
2. Back up existing website/automation SQLite data before any merge.
3. Deploy normally through master and readiness-gated branch synchronization.
4. Keep `SPECIES_COIN_EVENTS_ENABLED=false` until a disposable Steam user
   tests 1–2 bonus minutes and exact-once credit, reconnect, species
   switching, stop and expiry on the live feed.
5. Enable feature flag only after the controlled test is approved.
6. Preserve historic wallet ledger and reward progress; never delete
   database tables to revert the feature. Disable the flag for immediate
   reward isolation.

Issue #268 tracks later, verified species-only growth acceleration.
