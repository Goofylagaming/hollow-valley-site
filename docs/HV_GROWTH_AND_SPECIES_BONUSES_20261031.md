# Hollow Valley growth controls and species spotlight bonuses

## Scope (2026-10-31)

The growth selector under `/adminoperations` is unavailable in this release.
The unverified executable command has been removed; environment flags cannot
unlock it. Discord announcements remain separately available for verified changes.

Security / behavior:

- Website `requireAdmin` gate; request forwarded server-to-server using
  `AUTOMATION_ADMIN_TOKEN`. Never place bearer tokens in the browser.
- Automation `requireAdminToken` gate, `SET GROWTH` confirmation, validated
  allowlisted multiplier, and audit entry.
- Growth writes are hard-disabled, even with `RCON_GROWTH_MULTIPLIER_WRITE_ENABLED=true`.
- `RCON_DISABLED=true` remains the emergency kill switch.
- Removed the guessed payload for opcode `0x22`, reportedly `SetGrowthMultiplier`; **protocol
  references disagree on whether it takes a single multiplier or
  `SteamID,value`**. Do NOT enable in production until the current game build
  and BinaryLane-local host are verified using a non-production environment.
- An RCON send/response does not prove gameplay effect. Verify by observing
  an actual character's growth rate in-game; never report as persistent.
- **Does not write Windows `Game.ini`**. The authoritative persistent setting
  is `[/Script/TheIsle.TIGameSession]` / `GrowthMultiplier=3`.
  Until a separately authenticated Windows host config editor is installed,
  edits and restarts are performed on the game host.
- Current Render topology uses **private BinaryLane-local RCON**, not a public
  Render-to-game RCON connection. The control will stay disabled unless the
  verified transport and explicit action gate are available. Do not open RCON
  to the internet to make this control work.
- No automatic game-server restart and no modification to wallets,
  subscriptions, Prime, DinoStorage, or stored progression.

### Operator verification

1. Validate the current Evrima version's 0x22 arguments on staging.
2. Confirm the connection executes via private BinaryLane-local transport;
   do not turn on public RCON.
3. Reconcile the in-game effective growth rate with `Game.ini`.
4. Verify tests, code review, startup readiness, and rollback.
5. Implement and validate a narrowly allowlisted private host integration before
   enabling this control. A flag alone cannot enable the current implementation.

## Future feature: Featured Species bonus weeks

Goal: let admins select one or more dinosaur species that earn extra Valley
Coins and/or have faster growth while played, without changing baseline
multipliers for other species.

Suggested first event: **Omniraptor Week**
- Server base: 3× growth.
- Featured species: +50% playtime Valley Coins (50 → 75 per 5 minutes for
  eligible continuous playtime, before separate supporter effects).
- Featured species: additional 1.25× over server baseline (3× → 3.75×)
  **only if per-player growth overrides are proven supported in the current
  Evrima server**. Otherwise this remains a cosmetic/planned reward and
  must not be advertised as applied.

Implementation requirements:

1. Add admin UI: species search, active period in Australia/Brisbane, coin
   multiplier, additional growth multiplier, activation/deactivation.
   Default OFF. Display active rules publicly and per-player payout receipts.
2. Server-side canonical species ID mapping. Do not rely on browser-supplied
   dinosaur name, and do not apply bonuses to parked characters or cached
   absent characters.
3. The existing BinaryLane RCON presence feed provides authoritative
   `SteamID64`, species, character identity, online state, and sample times.
   Require continuity, freshness, and no species swaps before awarding.
4. Persist a durable event version + an **idempotency key**
   `steamId:sessionId:intervalStart:eventVersion` for each earning interval.
   Reconcile races, reconnection and incomplete RCON samples. Never award
   twice for the same 5-minute interval.
5. Use an additive or multiplicative stacking policy documented for
   supporter tiers, quests and event boosts; define a cap to prevent
   runaway rewards. Do not retroactively modify historical wallet ledgers.
6. Growth must use a verified **per-player** server override, with
   reconciliation on login, dinosaur species change, respawn, expiry,
   logout, entomb, storage, and event removal. The global `Game.ini`
   multiplier is never changed for a single featured species. If no
   supported per-player mechanism is available, do not attempt to
   simulate it by editing unsupported save files.
7. Record admin actor, config version, change history, payouts, and
   growth override receipts. Expose a dry-run preview (eligible users,
   anticipated coin costs) and force-disable switch.

Acceptance: one species can earn the extra coins exactly once per
eligible interval; other species remain at baseline; existing wallets,
quest rewards, subscriptions, Prime and parked dinosaurs remain intact;
event expiry returns to baseline without requiring user action.

## Release communications (Admin Hub)

The Admin Operations page includes a **Feature Announcements** composer:

1. After confirming the feature is actually active on the game server,
   choose the growth rate or enter another real, verified event message.
2. Choose Community Announcements (HerbyBot `announcement`) and/or
   Server Progress & Updates (HerbyBot `progress`).
3. Tick "I verified this change is active" and confirm the exact preview.
4. The website enqueues a single idempotent request, secured by Steam-linked
   admin login and the private automation admin token.
5. The automation service persists the pending message in its SQLite-backed
   HerbyBot outbox and the bot delivers asynchronously. The UI says "queued",
   never "posted", until independent delivery evidence exists.

Existing HerbyBot channel mapping:
- Community `announcement` → `DISCORD_ANNOUNCEMENT_CHANNEL_ID`.
- Server progress `progress` → `DISCORD_PROGRESS_CHANNEL_ID`
  (previously nominated channel 1550133934871023679).

`HERBYBOT_AUTOMATION_TOKEN` is required. The bot must be running with the
corresponding destination IDs configured; a queued receipt does not guarantee
the bot will post, and failures appear in the existing outbox state.
Never send announcement credentials or Discord token to the browser.

This action is **not automatically invoked** on an RCON send because that
would imply that an unverified gameplay change is live. For future
species event enable/disable handlers, call the same server-side verified
queue only after durable state commit and downstream acknowledgement. Reuse
an event-version-bound request ID to avoid duplicate announcements.

For in-game notices, the `0x10` Announce command must execute on the
Windows game host's private RCON listener. The current Render web/automation
pipeline does not open an RCON connection to that localhost address. Do not
open its port publicly. The UI offers a copy button; a secure command-poll
extension on BinaryLane is needed for website-triggered in-game delivery.

### Validation and rollback

Tests cover: unauthenticated users, destination allowlist, confirmation,
bounded multipliers, stable request ID dedupe and conflict protection,
and separate Discord vs in-game claims. A feature announcement makes no
changes to `Game.ini`, players, wallet, or active dinosaurs.
If the bot bridge is unavailable, the action refuses the request instead
of claiming success.
