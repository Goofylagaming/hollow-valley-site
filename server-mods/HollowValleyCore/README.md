# HollowValleyCore v001-recovery

This is a **reconstruction**, not a recovered copy of the 23 September original.

The earliest creation code in PowerShell history was a four-line UE4SS loading test. Logs from 24 September proved that a later version received `NEW PAWN` and `NEW PLAYER CONTROLLER` events. This version restores **only the confirmed read-only diagnostic watchers**.

## Scope

- Registers `NotifyOnNewObject` once for each of `/Script/Engine.PlayerController` and `/Script/Engine.Pawn`.
- Logs each object's descriptive UE4SS name with bounded output (60 controllers, 120 pawns per 60 seconds).
- Uses `pcall` to isolate Lua read/formatting errors.
- Makes **no gameplay changes** and does not touch storage, Steam account records, player/dinosaur persistence, Render or CommandBridge.
- A Pawn is not necessarily a player dinosaur; AI and other actors can also derive from Pawn.
- No Steam ID extraction, controller-pawn ownership matching, or account resolution is claimed.

## Stage safely without enabling

From the Windows server, download this folder (or use its GitHub Raw contents), and run:

```powershell
& "C:\path\to\HollowValleyCore-v001\install-staged.ps1"
```

The installer refuses to proceed unless `mods.txt` contains exactly one disabled `HollowValleyCore : 0` entry. It takes a timestamped backup of the existing core folder and replaces **only** `Scripts/main.lua`; it does not restart the game or enable the mod.

To test, choose a maintenance window, ensure the backup is safe, change only `HollowValleyCore : 0` to `HollowValleyCore : 1`, and perform a normal controlled server restart. The mod has not been tested on the actual live server.

## Expected output once enabled

```text
[HollowValleyCore] Boot; version=v001-recovery readOnly=true
[HollowValleyCore] Registered NEW PLAYER CONTROLLER watcher (/Script/Engine.PlayerController)
[HollowValleyCore] Registered NEW PAWN watcher (/Script/Engine.Pawn)
[HollowValleyCore] Object watchers registered.
```

Further `NEW PAWN:` / `NEW PLAYER CONTROLLER:` events may appear when UE4 constructs matching objects. Nothing appearing immediately does not prove the mod failed, since objects existing before registration are not replayed.

## Diagnostics

```powershell
$log = 'C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\UE4SS.log'
Select-String -Path $log -Pattern 'HollowValleyCore|NEW PAWN|NEW PLAYER CONTROLLER' |
    Select-Object -Last 30 | ForEach-Object { $_.Line }
```

UE4SS can concatenate print messages; avoid `Format-Table` which truncates long lines.

## Rollback

Disable `HollowValleyCore` in `mods.txt`, restart at a controlled time, and optionally restore the backup directory. **Do not re-enable the old backup file** until its content is inspected; its previous `main.lua` may contain EventAI code.

## Testing

`tests/mock_ue4ss.lua` simulates UE4SS callback registration and tests event formatting, pcall fallback and rate limits under a Lua 5.4 interpreter. Mock tests cannot rule out runtime/engine faults.
