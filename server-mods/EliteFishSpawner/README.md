# EliteFishSpawner

Hollow Valley UE4SS server mod for **The Isle: Evrima**.

## Default behaviour

- Targets **Elite Catfish** and **Elite Coelacanth only**.
- Effective spawn multiplier: **2×**.
- Each naturally spawned Elite Fish schedules **one** Hollow Valley supplemental Elite Fish.
- The supplemental fish uses a location learned from a naturally spawned Elite Fish, so the mod does not guess water coordinates.
- Supplemental fish do **not** recursively trigger more supplemental fish.
- Regular school fish and all land AI are untouched.

## Safety defaults

- 30-second delay before the bonus fish is created.
- Maximum 24 active tracked fish per elite species.
- Maximum 40 active tracked elite fish total.
- No `FindAllOf()` scans.
- No stored actor wrappers are reused later.
- No automatic actor destruction/cleanup from Lua.

## Deployment

Install as:

`TheIsle/Binaries/Win64/ue4ss/Mods/EliteFishSpawner/Scripts/main.lua`

Then enable the UE4SS mod using the same local mod-enablement method used by the other Hollow Valley server mods and restart/reload the server.

For the cleanest first activation, load this mod during a normal server startup so it observes natural Elite Fish BeginPlay events from the start of the world session.

## Expected log lines

```
[EliteFishSpawner v001] Natural catfish BeginPlay...
[EliteFishSpawner v001] Learned catfish water anchor...
[EliteFishSpawner v001] Spawned Hollow Valley bonus catfish...
```

The first live rollout should be watched for server stability and whether the spawned fish receives its default fish AI controller correctly in current Evrima.
