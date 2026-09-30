# SafeLogRecovery

Non-destructive recovery insurance for Hollow Valley EVRIMA safe logs.

## What it does

- Hooks `/Script/TheIsle.TIPlayerController:PrepareSafeLogout` and captures the live dinosaur on the next game-thread tick.
- Correlates `/Game/TheIsle/Core/GameModes/BP_SurvivalGameMode.BP_SurvivalGameMode_C:K2_OnLogout` within 75 seconds to mark the snapshot as a completed safe log.
- Keeps an unconfirmed `pending` snapshot if the server restarts before the completion hook is observed.
- Never calls `SetHealth(0)`, never parks, never destroys, never despawns and never moves the dinosaur.
- Restores only after an admin explicitly requests it, and only into a connected live dinosaur of the same species and gender.
- Retains the snapshot after restore until an admin clears it.

## Files

Runtime snapshots are written under:

- `Mods/SafeLogRecovery/Saved/completed/<steam>.json`
- `Mods/SafeLogRecovery/Saved/pending/<steam>.json`

The mod receives admin actions through:

- `Mods/SafeLogRecovery/Saved/inbox.ndjson`

Results are written to the existing shared CommandBridge result stream.

## Enable on the game server

Copy the `SafeLogRecovery` folder into the UE4SS `Mods` directory and add `SafeLogRecovery : 1` to `Mods/mods.txt`, then restart UE4SS/the game server.

After boot, `UE4SS.log` should contain:

- `[SafeLogRecovery] PrepareSafeLogout hook registered`
- `[SafeLogRecovery] Blueprint K2_OnLogout hook registered`
- `[SafeLogRecovery] Boot; version=v001`

## Recovery policy

A `completed` snapshot is preferred. A `pending` snapshot means safe-log initiation was captured but completion was not observed; the Admin Hub requires an explicit restore confirmation for either source and displays which source is being used.
