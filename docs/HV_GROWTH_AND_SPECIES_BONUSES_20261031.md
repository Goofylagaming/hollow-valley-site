# Hollow Valley growth controls and species spotlight bonuses

## Scope (2026-10-31)

This release adds an **admin-only live growth-rate request** UI under
`/adminoperations`, with presets 1×, 2×, 3×, 4×, 5× and 10×.

Security / behavior:

- Website `requireAdmin` gate; request forwarded server-to-server using
  `AUTOMATION_ADMIN_TOKEN`. Never place bearer tokens in the browser.
- Automation `requireAdminToken` gate, `SET GROWTH` confirmation, validated
  allowlisted multiplier, and audit entry.
- Dedicated `RCON_GROWTH_MULTIPLIER_WRITE_ENABLED=true` override required,
  regardless of broad `RCON_WRITE_ENABLED`. OFF by default.
- `RCON_DISABLED=true` remains the emergency kill switch.
- Uses Evrima opcode `0x22`, reportedly `SetGrowthMultiplier`; **protocol
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
5. Only after verification explicitly enable the action gate on the
   automation service. If unsupported, keep it OFF and hide/disable the
   action pending Windows-side config-bridge implementation.

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
