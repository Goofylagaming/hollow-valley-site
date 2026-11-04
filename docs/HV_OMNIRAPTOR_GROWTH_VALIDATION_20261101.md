# Omniraptor growth validation — read-only preparation

**State:** The Isle server has NOT been changed. The 1×–10× values are
requested **effective growth-speed targets**, not real personal growth
overrides and not additional multipliers stacked on top of the server's
current rate.

## Scope

An authenticated Hollow Valley administrator may open
`/adminoperations` → **Omniraptor Growth Validation**, choose a value from
1× through 10×, then click **Start read-only observation**. The backend only
reads the currently logged-in admin's SteamID64 using the existing private
automation read API and existing BinaryLane presence snapshots.

The tool verifies the target is an ONLINE Omniraptor with a fresh, numeric
growth sample, then takes a baseline and reads for at most ten minutes at
30-second intervals. It reports growth percentage, health, stamina,
hunger, thirst, mutation count, and the observed growth percentage
points per minute. A copyable report stays in the browser; it is NOT
persisted in a new database table or shared with other players.
No automatic event, RCON write, character state mutation or server restart
is performed. The button stops immediately when the tab is hidden,
character is offline/the wrong species, the snapshot is stale, or growth
decreases.

## Presets (future effective growth-rate targets)

| Requested growth speed | Meaning |
| --- | --- |
| 1× | Vanilla-speed target |
| 2× | Twice vanilla |
| 3× | Three times vanilla |
| 4× | Four times vanilla |
| 5× | Five times vanilla |
| 6× | Six times vanilla |
| 7× | Seven times vanilla |
| 8× | Eight times vanilla |
| 9× | Nine times vanilla |
| 10× | Ten times vanilla |

These are target labels only. A selected 10× option will NOT currently make
the Omniraptor grow 10 times faster.

## Operator test using your own Omniraptor

1. Join Hollow Valley in The Isle with your Steam-linked administrator
   account and a **growing** Omniraptor. If it is already 100% grown,
   natural growth-speed testing is not meaningful.
2. Preserve a backup of your original dinosaur before later game-side
   experiments. Do not entomb, swap dinosaurs, change mutations, change
   diet or park while the baseline is being measured.
3. Confirm your global `Game.ini` setting is known:
   `Select-String -Path "C:\HollowValley\TheIsleServer\TheIsle\Saved\Config\WindowsServer\Game.ini" -Pattern 'GrowthMultiplier'`
   (read-only command, no restart).
4. On the Admin Operations panel, select a target 1×–10× and start
   read-only observation. Keep the browser tab visible for up to ten
   minutes. Confirm only your own Omniraptor is displayed.
5. Copy the baseline report and compare it to a second five-minute run
   with the same diet and server growth setting. Check whether growth
   data has sufficient precision to estimate percentage points/min.
6. Halt if the character changes, disconnects, growth resets,
   or a timestamp gap exceeds 90 seconds. Observe that any unrelated
   player's growth is unchanged; the application does not have a way
   to read another player's private growth from this screen.

## Before any real per-dinosaur speed write can be enabled

A per-pawn growth-accumulation hook must be established from **the
currently installed Evrima server build** and validated on an isolated
game host. The global RCON `setgrowthmultiplier` command has
server-wide effect; it must not be used to simulate a personal growth
event. `pawn:SetGrowth` in the existing storage/recovery modules sets
a character's growth state rather than a growth **rate** and can
recalculate vitals. Never use it as a repeating growth-rate workaround
on a live dinosaur.

Acceptance criteria for the later **active** test:
- Only the explicitly authorized SteamID64 and its current Omniraptor
  pawn are affected, never every Omniraptor/player.
- Rate can move to 1–10× without losing health, stamina, diet, mutations,
  Prime, stored characters, or owner progression.
- The effective growth speed is measured independently of the UI
  selection; compare the same character/diet before and after.
- On logout, species swap, death, storage, entomb, expiration, outage,
  or operator stop, the override stops deterministically and no residual
  configuration survives.
- Zero writes to global `Game.ini` and no server restart.
- No real game mutation is exposed until the host-side hook has been
  verified and a separate explicit enablement switch is approved.

## Rollback

Closing the panel or clicking Stop ends its browser polling. The
read-only observation code has no game state to roll back. Remove
the panel asset/endpoints via a normal website/automation rollback if
needed, leaving all existing player and economy data intact.
