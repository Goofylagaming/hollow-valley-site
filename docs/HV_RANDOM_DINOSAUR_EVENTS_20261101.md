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

## Queensland time display

Event windows are always stored and compared as absolute UTC instants. Automatic
HerbyBot start/end notifications show the Queensland wall-clock date and time
in the unambiguous format **DD-MM-YYYY HH:mm (QLD time)** using the IANA
`Australia/Brisbane` time zone. Brisbane does not observe daylight saving,
so Sydney/Render time zones cannot shift an event's displayed deadline.

For example, `2026-11-01T02:01:00Z` appears as
`01-11-2026 12:01 (QLD time)`. The public Events page and Admin Operations
list use the same convention, and the timed payout/expiry comparisons continue
to use the original UTC timestamps.

Previously **queued or delivered** event messages retain their original
contents. This format applies to announcements generated after deployment.
Do not delete/re-enqueue old HerbyBot outbox records just to restyle them.

## Random Event member pings — November 2026

Random Event Admin Hub now offers an explicit **event START ping** selector:

- `@Community Member` (default in the form): tags members holding the
  existing Community Member Discord role.
- `@everyone`: explicitly requests Discord's guild-wide mention.
- `No ping`: posts normally without notifying a role or everyone.

Pings are emitted **only** in the community `announcement` destination
when the event actually enters its active window; the final event notification
and the `progress` destination never ping. Manual notices, other automation
alerts, and historic event messages also remain mention-free. Unchecking
automatic event announcements disables pings for that event.

The automation service stores only the allowlisted `ping_mode` value
(`none`, `community`, `everyone`) in a new SQLite column, defaulting to
`none` for every existing event. When the event starts, the outbox nonce
has an authenticated, tightly scoped suffix `-ping-community` or
`-ping-everyone` for the *announcement* channel only. Existing nonces
are unchanged for old/silent events, preserving deduplication. No manual
browser-supplied role ID or arbitrary user mention text is accepted.

The **existing production Python HerbyBot** (`hds-dashboard`, main)
validates the nonce, exact start-message prefix, and destination before
enabling Discord `allowed_mentions`. For `Community Member`, the bot
resolves `COMMUNITY_MEMBER_ROLE_ID` if set, otherwise exactly one role
matching `COMMUNITY_MEMBER_ROLE_NAME` (default `Community Member`).
It checks channel permission before sending; `@everyone` requires the
bot's Mention Everyone permission. If permissions or the named role are
missing, the outbox reports a delivery failure rather than pretending a
notification was sent. Discord member-level notification preferences may
still suppress alerts.

No member ping is generated by deployment. A newly created event with its
opt-in setting is required. Both bot and website/automation releases are
tested and deployed separately, bot support first.

## Prepared dedicated Discord channel routing and global growth pings (1 Nov 2026)

**Preparation only; not a live channel cutover until the corresponding
Hollow Valley and HerbyBot pull requests are deployed in the right order.**

- The owner selected Discord channel `1566412715864358973`
  ("event start and finish") for future Random Event start/end notices.
- New events persist `announce_route=event-announcement` and queue **one**
  message per phase to a dedicated `event-announcement` HerbyBot destination.
  They no longer double-post start/end to generic announcements and
  server-progress updates.
- Existing events migrate to `announce_route=legacy`. Their original
  channel/nonce remains unchanged, so a previously delivered start is
  not sent again and old pending end notices remain consistent.
- The Python HerbyBot worker maps `event-announcement` to
  `DISCORD_EVENT_START_FINISH_CHANNEL_ID`, falling back to the exact
  owner-approved channel ID above. It never accepts a channel ID from a
  browser, wallet payload or announcement message.
- A new Random Event may opt into one `@Community Member` / `@everyone`
  ping at START, on the dedicated channel only. End notices never ping.
  Normal messages remain silent; the bot checks guild role permissions.
- Global growth change announcements are separate: under Admin Operations
  → Feature Announcements → Global growth multiplier, staff can select
  **No ping** (default), **@Community Member** or **@everyone**.
  The automation service only queues a ping with the verified-growth,
  admin-confirmed request nonce to the existing community
  `announcement` destination. Server progress remains mention-free.
  A successful experimental RCON send is **not** considered verification.
- New mention settings cannot be attached to an already-queued request.
  The durable HerbyBot outbox and per-request nonce prevent conversion
  of a historical silent notice into a second mass ping.

### Deployment and acceptance

1. Validate the configured Discord channel is in the correct Hollow Valley
   guild and that HerbyBot has View Channel, Send Messages and relevant
   mention permission.
2. Run existing Python bot test suite and Node integration/economy/UI tests.
3. Deploy HerbyBot FIRST; verify it can safely handle the new destination.
4. Deploy Hollow Valley website and automation in their established
   readiness-gated order; keep existing event/coin data backed up.
5. Verify new Random Events post only to the new channel and no bot
   re-announces active/historic events.
6. Confirm no growth notice is automatically published on an RCON command.
   An admin must tick the verified-change confirmation and choose the ping.

**Separate issue:** per-dinosaur growth acceleration is not implemented.
The confirmed global growth multiplier is server-wide, and `pawn:SetGrowth`
is used elsewhere for restoring dinosaur state, not as a safe,
tested per-pawn growth-rate override. It can recalculate vitals.
A supported per-pawn growth-accumulation hook must be identified and tested
on an isolated game host, including switching species, death, entomb,
DinoStorage, disconnect and expiry. No speculative global opcode or
repeating `SetGrowth` loop should go live.
