# Hollow Valley — Owner-only BinaryLane Management v0.1

**Status:** proposed code on a feature branch. **NOT production-deployed.** Do not merge or deploy until reviewed and tested.

## Goal

Let the configured Hollow Valley owner view current BinaryLane game-server and Scheduled Task state at
`/admin/server` and request **only** two low-risk, allowlisted maintenance actions:

- `enable_start` `command_bridge` → `Hollow Valley Command Bridge Agent`
- `enable_start` `combat_forwarder` → `HollowValleyCombatForwarder`

The app cannot execute arbitrary PowerShell, change Game.ini, stop the game process, restart Windows, delete saves, change player wallets, or enable the legacy duplicate combat-forwarder task.

The existing website `OWNER_STEAM_ID` identity guard is enforced at the **server** for both HTML and owner API. Non-owner admins get 404. The agent is independently authenticated with a new dedicated bearer token, not a Steam session or the CommandBridge token.

## Architecture

```
Owner browser (existing Steam/owner-login cookie)
     | HTTPS /admin/server and /api/admin/server-management
Render hollow-valley-site (SQLite /app/data/hollowvalley.sqlite)
     | authenticated status, queued actions, audit and one-time leases
BinaryLane Scheduled Task (SYSTEM, outbound HTTPS polling only)
     | local Get-Process/Get-ScheduledTask/Get-NetTCPConnection
     | allowlisted Enable-ScheduledTask / Start-ScheduledTask
The Isle process remains running; no inbound RCON/PowerShell/RDP port
```

Status is posted every 20 seconds. Heartbeats are treated as stale after 90 seconds. Requests are stored on the website's existing persistent SQLite disk, expire in 90 seconds, and become **unknown** if a leased action cannot be confirmed. Unknown actions are **never automatically retried**. Recent requests and their outcomes are visible to the owner.

## Before commissioning

1. Run `npm test` and review the feature-branch PR (including owner auth, response sanitisation, lease safety and PowerShell allowlist).
2. Check that the existing `OWNER_STEAM_ID` points to the correct owner's authenticated Steam account. Do not change it during this work.
3. Confirm Render `hollow-valley-site` uses the existing persistent database disk at `/app/data`. Back it up, and preserve it through deployment.
4. Use a staging website/service for a first connection test, with a separate staging token. Do not point the BinaryLane production agent at an unreviewed staging application.
5. Keep all automatic game-restarter, watchdog, autosave and player scanner tasks unchanged.

## Website configuration (Render)

The website's `render.yaml` and `.env.example` default to:

```text
HV_MANAGEMENT_ENABLED=0
HV_MANAGEMENT_WRITES_ENABLED=0
HV_MANAGEMENT_AGENT_TOKEN=
```

When the reviewed build is deployed, create a **new** 32+ character secret as `HV_MANAGEMENT_AGENT_TOKEN`. Do not reuse `BINARYLANE_COMMAND_TOKEN`, `PRESENCE_FEED_TOKEN`, Steam credentials, Discord tokens, RCON password or the website session secret.

Set `HV_MANAGEMENT_ENABLED=1` and keep `HV_MANAGEMENT_WRITES_ENABLED=0` during the first read-only test. Do **not** put the token in GitHub, browser JavaScript, screenshots or ChatGPT.

Generate a 64-character hex secret locally on the BinaryLane Administrator PowerShell and copy it into Render:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
$token | Set-Clipboard
Write-Host "Generated a management token in the clipboard. Paste into Render secrets; do not post in chat."
```

## BinaryLane setup (manual; no remote automatic deployment)

After the reviewed site endpoint is deployed, copy these two files from the **reviewed commit** into the Windows server:

```text
scripts/windows/HollowValley-ServerManagementAgent.ps1
  -> C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1
scripts/windows/Install-HollowValley-ServerManagement.ps1
  -> C:\HollowValley\Scripts\Install-HollowValley-ServerManagement.ps1
```

Use an elevated PowerShell prompt. Run the installer. If `management-agent-token.txt` already exists and passed the earlier read-only staging test, the installer **reuses it without displaying or overwriting the secret**. Only a new installation without a token file prompts for a secret:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\Install-HollowValley-ServerManagement.ps1" -SiteUrl "https://hollow-valley-management-staging.onrender.com"
```

**Environment targeting:** The installer now requires explicit `-SiteUrl` and accepts only the staging hostname above or `https://hollowvalleyisle.com`. For staging, use only the staging URL; never allow a background task to silently default to production. The installer validates the agent's PowerShell syntax before registering the task.

The installer **refuses to replace an existing management scheduled task**, to avoid unintentionally switching a production agent to staging or the reverse. Inspect such a task manually first.

The installer stores the token at `C:\HollowValley\Secrets\management-agent-token.txt` with ACL access restricted to SYSTEM and Administrators, registers a **separate** startup task `Hollow Valley Server Management Agent` running as SYSTEM, and starts it. It does not modify, replace or terminate the existing watchdog, player scanner, Command Bridge or combat forwarder.

For a single read-only heartbeat test before installing the startup task, an administrator can run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1" -StatusOnly
```

Open `https://hollowvalleyisle.com/admin/server` while signed in with the owner Steam/owner-login account. The private page should show a recent heartbeat, exactly one running game process, PID/start time, task states, and recent operational log tails. If the connection is offline or unconfigured, it must say so; it must never display fictional data.

## Enable two approved writes only after testing

When heartbeats, auth and audit checks pass, change only the website service variable:

```text
HV_MANAGEMENT_WRITES_ENABLED=1
```

Deploy the configuration safely. The owner can then press **Enable & Start** on the Command Bridge or the current `HollowValleyCombatForwarder`. Each button requires typing `ENABLE command_bridge` or `ENABLE combat_forwarder` exactly. The backend also checks owner session, same-site origin, JSON/custom request header, live heartbeat, one game process, task allowlist, duplicate requests, and (for forwarder) that the legacy duplicate task remains disabled.

The agent checks the allowlist again locally before executing. It skips starting a task if its known process is already running. It reports success/failure without claiming the gameplay feature itself is verified; use existing Command Bridge and chat/combat ingestion diagnostics to check functionality after the task operation.

## Emergency disable and rollback

- Set `HV_MANAGEMENT_WRITES_ENABLED=0` on Render to prevent new jobs being claimed (already executing jobs can finish).
- Set `HV_MANAGEMENT_ENABLED=0` to disable all agent endpoints.
- Disable **only** the new `Hollow Valley Server Management Agent` Windows task if necessary. Do not disable the game watchdog or scheduled restart.
- Keep the new SQLite tables (they contain audit history). They do not modify player data, Valley Coins, dinosaur storage or Game.ini.
- Revert the feature branch / redeploy the previous website commit if required. Preserve the production disk and sessions.

## Future expansion (not in v0.1)

Consider adding more explicit read-only tools and individually approved maintenance operations, with second-factor owner confirmation, per-action policies, comprehensive auditing, constrained parameter schemas, a second recovery path and Windows integration tests. Never add a generic `run_command`, arbitrary filesystem write, unrestricted RCON or uploaded PowerShell script endpoint.
