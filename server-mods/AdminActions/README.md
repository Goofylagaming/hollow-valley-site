# AdminActions

Hollow Valley administrator-only live player actions for The Isle: Evrima.

## v002

- accepts audited `admin_slay` commands from CommandBridge
- resolves the target by 17-digit Steam ID
- requires the player to be connected with a live dinosaur
- spawns the verified Evrima `BP_SmiteEffect` at the target dinosaur's live location
- enables replication and calls the effect's `CustomEvent` trigger before the kill
- never caches or manually destroys the Smite actor; the Blueprint owns its own lifetime
- treats lightning as best-effort so an effect failure never blocks the proven Slay action
- sets the current dinosaur's health to zero and forces a network update
- writes a confirmed `AdminActions` result back to CommandBridge

Install at:

`ue4ss/Mods/AdminActions/Scripts/main.lua`

Because this is a new UE4SS mod, first installation requires enabling the mod and restarting the game server. Later updates can use `Saved/reload.flag`.


### Smite safety

The Smite actor class is resolved with:

`/Game/TheIsle/Core/Spawnables/BP_SmiteEffect.BP_SmiteEffect_C`

`CustomEvent()` is intentionally the final call made on the spawned effect actor. Do not add delayed cleanup or `K2_DestroyActor`: the effect Blueprint can destroy itself, and touching a stale UE4SS wrapper after that can crash the server.

Lightning is diagnostic/best-effort. If the effect cannot be resolved, spawned, replicated, or triggered, AdminActions logs the reason and still applies the existing `SetHealth(0)` Slay path.
