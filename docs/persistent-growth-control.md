# Persistent owner growth setting

The owner panel in `/adminoperations` saves one of 1, 2, 3, 4, 5 or 10 to
`GrowthMultiplier` in `[/Script/TheIsle.TIGameSession]`. It uses the existing
outbound BinaryLane management agent, not the experimental RCON opcode.

Saving does **not** restart the server or assert a live gameplay change. The
normal scheduled restart is the activation boundary. The page reports the saved
value, pending restart, and a subsequent process start with an owned RCON
listener. Even after that observation, gameplay remains independently unverified.

## Release order

1. Run the Node tests in the management workflow, Windows PowerShell 5.1 fixture
   tests, and isolated desktop/mobile browser tests. Review the patch.
2. Deploy the website. No automation-service change is required. The new panel
   stays disabled for the existing v0.2 agent. Preserve the existing SQLite disk,
   owner identity and all management tokens. The new table is additive only.
3. On BinaryLane, place the reviewed release in a **separate** folder. Run
   `scripts/windows/Install-HollowValley-GrowthControl.ps1` as Administrator from
   that release. The installer validates the known production management task,
   parses the files, runs temporary-file tests, and backs up the previous agent
   and task. It changes only the management agent and its local capabilities.
   It does not change Game.ini, the watchdog or the game restart task.
4. Verify a fresh v0.3 heartbeat on the website, owner-only access, the saved
   value, and enabled growth capability. Confirm the game process did not change.
5. The owner selects 5×, enters `SAVE 5X GROWTH`, and submits. The agent backs up
   the exact prior Game.ini bytes, replaces only the targeted setting, verifies
   the read-back and records the result. The website shows pending restart.
6. After the normal scheduled restart, confirm the new process/RCON observation,
   unchanged configuration hash and actual gameplay behaviour. Only then publish
   a growth announcement. Announcements do not activate any setting.

## Gates and safeguards

- Existing website gates: `HV_MANAGEMENT_ENABLED=1`,
  `HV_MANAGEMENT_WRITES_ENABLED=1`, a dedicated `HV_MANAGEMENT_AGENT_TOKEN`, and
  exact `OWNER_STEAM_ID` authorization. Ordinary admin access is insufficient.
- Local agent: both `-AllowTaskWrites` and the new `-AllowGrowthWrites`; production
  site/token pairing is mandatory. An old agent cannot lease a growth job.
- Same-origin JSON requests require `X-HV-Owner-Action: growth-config-v1`.
- The reviewed file hash must match both at the website and on the host. The
  target file and receipt locations are fixed in the agent, never supplied by
  the browser. Links/junctions, malformed or duplicate sections/settings,
  unsupported encoding, stale status and a running restart task fail closed.
- The writer accepts UTF-8 with/without BOM and preserves that encoding and line
  endings. An absent setting is inserted into the one required section. UTF-16
  files need operator inspection rather than silent conversion.
- Request identity survives browser reload; the server deduplicates it. Leased
  jobs are never redelivered. Unknown or interrupted results block new work.
- Backups: `Game.ini.growth-<job-id>.bak` next to the active configuration.
  A pre-write journal and verified receipt are kept under
  `C:\HollowValley\Management`, restricted to SYSTEM and Administrators.
- Only one change can be pending activation. A written result remains blocked
  until a matching receipt is reported after a later healthy game start.

## Recovery and rollback

For unknown results, inspect the file, its job backup and
`C:\HollowValley\Management\growth-receipt.json` before any further action.
Do not delete a receipt, reset a job or replay a write just to clear an error.
No automatic file rollback is attempted after an uncertain write, because it
could overwrite a subsequent operator change. An operator must reconcile the
file and audit record using the retained evidence.

To close all existing management write capabilities, the updated
`Set-HollowValley-ManagementWriteMode.ps1 -Mode Disable` removes both local write
switches and restarts only the management agent. Removing `-AllowGrowthWrites`
alone closes this new feature while preserving the existing task actions.
Neither operation restores an earlier growth value or changes running gameplay.

Application rollback must preserve `hv_growth_jobs` and existing management data.
The installer retains the previous agent/task under
`C:\HollowValley\Management\agent-backup-<id>`. Restore those only while no
configuration job is running. Do not replace the database with an older backup.

## Local validation

```powershell
node --test test/persistentGrowth.test.js test/serverManagement.test.js test/financeOwner.test.js test/adminPagesRoute.test.js test/desktopReadOnlyManagement.test.js test/productionUiRelease.test.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/Test-HollowValley-GrowthConfig.ps1
node scripts/verify-persistent-growth.cjs
```

The browser test requires Playwright and Chromium (or `BROWSER_PATH` for Edge).
All browser API calls are intercepted. Windows tests use disposable fixtures;
they never open the production configuration or send game commands.
