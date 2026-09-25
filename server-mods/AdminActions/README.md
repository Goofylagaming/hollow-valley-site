# AdminActions

Hollow Valley administrator-only live player actions for The Isle: Evrima.

## v001

- accepts audited `admin_slay` commands from CommandBridge
- resolves the target by 17-digit Steam ID
- requires the player to be connected with a live dinosaur
- sets the current dinosaur's health to zero and forces a network update
- writes a confirmed `AdminActions` result back to CommandBridge
- does not include the lightning effect yet; that will be added only after the relevant Evrima function/effect is verified

Install at:

`ue4ss/Mods/AdminActions/Scripts/main.lua`

Because this is a new UE4SS mod, first installation requires enabling the mod and restarting the game server. Later updates can use `Saved/reload.flag`.
