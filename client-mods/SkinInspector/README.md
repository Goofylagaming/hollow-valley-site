# Hollow Valley SkinInspector v001

Client-side, read-only UE4SS metadata capture for Skin Studio calibration.

## What it captures

- local dinosaur pawn object/class
- current species class
- growth and ElderReplicationStacks when available
- current `pawn.CustomizerData`:
  - sex
  - PatternIndex
  - ThemeIndex
  - SkinVariation
  - Body / Markings / Flank / Underbelly / Detail / Eyes
  - Teeth / Mouth / Claws / Male Display
- skeletal mesh component identity
- skeletal mesh asset identity
- material count, material object/class and slot name when exposed

## What it deliberately does NOT do

- no writes to the dinosaur
- no ForceNetUpdate
- no save-file edits
- no other-player enumeration
- no `SkinCode` access — current EVRIMA/UE4SS safety research identifies that FString field as unsafe to marshal
- no raw UV/vertex-buffer extraction in Lua v001

Raw UV extraction is the planned v002 C++ sidecar after v001 proves the reflected mesh/material metadata on a real EVRIMA client.

## Install

Install UE4SS on your **EVRIMA client** first.

Copy this folder to:

```
<The Isle client>\TheIsle\Binaries\Win64\ue4ss\Mods\SkinInspector\
```

The important file is:

```
Mods\SkinInspector\Scripts\main.lua
```

Enable the mod in the UE4SS mod list, then restart EVRIMA.

## Capture

1. Join Hollow Valley.
2. Spawn/select the dinosaur you want to inspect.
3. Wait until the dinosaur is fully loaded in world.
4. Press **Ctrl + Alt + F8**.
5. Check the UE4SS console/log for a line beginning with `[SkinInspector v001] Captured`.

Files are written under:

```
Mods\SkinInspector\Saved\captures\
Mods\SkinInspector\Saved\latest.json
```

Start with **Triceratops**. Send/upload `latest.json` back into ChatGPT and we can use the real EVRIMA mesh/material/customizer identities to plan v002.

## Safety

The mod is read-only and uses `UEHelpers:GetPlayerController()` to inspect only the local player's pawn. It never calls `FindAllOf` for players and never writes reflected game state.
