# AdminActions

Hollow Valley administrator-only live player actions for The Isle: Evrima.

## v004

- keeps the proven `admin_slay` path unchanged: resolve the target by Steam ID, set live dinosaur health to zero, force a network update
- removes the experimental `BP_SmiteEffect` call from Slay because the dedicated-server test produced no player-visible/audio lightning
- adds a read-only, one-shot lightning/weather reflection probe
- logs parameter names/types for native candidates: `Smite`, `ServerSmite`, `SetSmited`, `IsThunderstorm`, and `SetWeather`
- the probe runs only when `Saved/lightning-probe.flag` is present
- searches loaded UE objects for: `lightning`, `thunder`, `storm`, `weather`, `strike`, and `smite`
- filters on FName first, then logs full names only for matches
- when a matching UClass/Blueprint class is found, enumerates its reflected UFunctions so generic callable methods are visible
- caps diagnostic logging and makes no game-state writes

Install at:

`ue4ss/Mods/AdminActions/Scripts/main.lua`

Existing installations can hot-reload AdminActions with `Saved/reload.flag`; no full game-server restart is required.

## Running the probe

Create:

`ue4ss/Mods/AdminActions/Saved/lightning-probe.flag`

with any non-empty token. AdminActions consumes the flag once and logs lines beginning with:

`[AdminActions] LightningProbe`

The probe is diagnostic only. It does not change weather, spawn VFX, damage players, or call any discovered function. v004 also logs UFunction metadata/signatures for the native Smite/weather candidates so they can be invoked safely later.

## Performance note

UE4SS registry enumeration requires a pass over the loaded global UObject array. Run this manually and only when needed. The implementation keeps the per-object work minimal by checking FName before requesting full object names, and caps logged output.
