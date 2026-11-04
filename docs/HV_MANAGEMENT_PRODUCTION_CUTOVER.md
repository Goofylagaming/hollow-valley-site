# Hollow Valley — staging-to-production management cutover

**State:** preparation only until BinaryLane installation and Render production credentials are configured. This does not change The Isle, its watchdog, 12-hour restarts, RCON, player data, Wallet or DinoStorage.

## Background

- Staging dashboard verified by owner.
- Staging task: Hollow Valley Server Management Agent - Staging.
- Staging token file: C:\HollowValley\Secrets\management-agent-token.txt.
- Production dashboard already exists at https://hollowvalleyisle.com/admin/server and is restricted by OWNER_STEAM_ID.
- Production needs a SEPARATE token; never reuse staging's token.

## Step 1: Install reviewed Windows scripts

Use the immutable reviewed commit SHA from the passing Windows CI. On an elevated BinaryLane PowerShell prompt, replace REVIEWED_SHA with the exact SHA and run the following:

    $ErrorActionPreference = "Stop"
    $commit = "REVIEWED_SHA"
    $base = "https://raw.githubusercontent.com/Goofylagaming/hollow-valley-site/$commit/scripts/windows"
    $target = "C:\HollowValley\Scripts"
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $names = @(
        "HollowValley-ServerManagementAgent.ps1",
        "Install-HollowValley-ServerManagement.ps1",
        "Initialize-HVProductionManagementToken.ps1",
        "Switch-HollowValleyManagementToProduction.ps1",
        "Set-HollowValley-ManagementWriteMode.ps1"
    )
    foreach ($name in $names) {
        $temp = Join-Path $env:TEMP ("HV-reviewed-" + $name)
        $dest = Join-Path $target $name
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $temp
        $tokens = $null; $errorsFound = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($temp, [ref]$tokens, [ref]$errorsFound)
        if ($errorsFound.Count -gt 0) { throw "PowerShell syntax failed: $name. Original preserved." }
        if (Test-Path -LiteralPath $dest) {
            Copy-Item -LiteralPath $dest -Destination ($dest + ".before-production-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".bak")
        }
        Copy-Item -LiteralPath $temp -Destination $dest -Force
        Write-Host "Validated and installed $name"
    }

Replacing the on-disk agent script does not restart the running staging management process.

## Step 2: Production-only credential

On elevated BinaryLane PowerShell:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\Initialize-HVProductionManagementToken.ps1"

The script generates a cryptographically random token, stores it under SYSTEM/Administrators ACL at C:\HollowValley\Secrets\management-agent-production-token.txt, and copies it to the clipboard without printing it. It refuses to overwrite an existing file.

In **Render > Hollow Valley Studios > hollow-valley-site** (PRODUCTION website only, not staging and not hollow-valley-automation), set these values together:

    HV_MANAGEMENT_ENABLED=1
    HV_MANAGEMENT_WRITES_ENABLED=0
    HV_MANAGEMENT_AGENT_TOKEN=<paste production token from clipboard>

Save and verify the production website deploy is Live. Keep the existing persistent SQLite disk mounted at /app/data. Do not put the token in chat, GitHub, screenshots or scripts. Clear your clipboard afterward.

## Important: verify the correct Render service and token

There are **two distinct** Render services and token files. Do not paste a production token into staging or vice versa:

- Staging service: `hollow-valley-management-staging`; staging token file: `C:\HollowValley\Secrets\management-agent-token.txt`.
- Production website: `hollow-valley-site`; production token file: `C:\HollowValley\Secrets\management-agent-production-token.txt`.

The agent token value itself must remain secret. On BinaryLane use `Set-Clipboard -Value ((Get-Content -LiteralPath '<correct-token-path>' -Raw).Trim())` and paste into that **specific** service's `HV_MANAGEMENT_AGENT_TOKEN` Render field; never print the secret or put it into an ordinary transcript.

Expected results after the right settings deploy: staging status heartbeat `200`; production authenticated probe `200` with writes disabled. If staging switches from `200` to `401` immediately after a staging configuration redeploy, restore the staging token from its original BinaryLane file. If production responds `404`, configure `HV_MANAGEMENT_ENABLED=1` and the **separate** production token on the production website. Do not retry cutover until both environments authenticate.

The updated cutover script uses a side-effect-free production authentication probe **before stopping staging**, so a missing/mismatched production token no longer interrupts the working staging process.

## Step 3: Read-only agent cutover

Once the production website deploy is Live, on elevated BinaryLane PowerShell:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\Switch-HollowValleyManagementToProduction.ps1"

Type the exact requested phrase:

    SWITCH MANAGEMENT TO PRODUCTION

The script stops/disables ONLY the staging management task, performs a one-shot authenticated production heartbeat, installs a separate production startup task, verifies it is Running, and checks that the game PID did not change. Failure automatically restores staging. Production starts READ ONLY and will not claim any write jobs.

Expected:

    Production one-shot read-only heartbeat verified.
    PRODUCTION MANAGEMENT CONNECTED (READ ONLY)
    Production task: Running
    Staging task: Disabled

Verify the owner-only page at https://hollowvalleyisle.com/admin/server. Confirm that it shows a fresh heartbeat, exactly one game-server process, a healthy watchdog, and accurate task states. The older duplicate chat-forwarder task should remain Disabled.

## Step 4: Enable two approved actions only after read-only validation

Do NOT combine with the cutover.

On BinaryLane, the owner must explicitly enable the local write gate:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\Set-HollowValley-ManagementWriteMode.ps1" -Mode Enable

Type:

    ENABLE LIMITED PROD TASK ACTIONS

This restarts only the production management task. It cannot restart the game.

Then set HV_MANAGEMENT_WRITES_ENABLED=1 ONLY on the production website Render service and deploy.

The owner dashboard can now request either action, with exact typed confirmation: ENABLE command_bridge or ENABLE combat_forwarder. These target only the named Windows Scheduled Tasks. No arbitrary PowerShell, game restarts, Game.ini writes or player data writes exist.

## Emergency disable and rollback

To stop new writes, set HV_MANAGEMENT_WRITES_ENABLED=0 on Render, then run:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\Set-HollowValley-ManagementWriteMode.ps1" -Mode Disable

To roll back the agent to staging only (never the game):

    Stop-ScheduledTask -TaskName "Hollow Valley Server Management Agent - Production"
    Disable-ScheduledTask -TaskName "Hollow Valley Server Management Agent - Production" | Out-Null
    Enable-ScheduledTask -TaskName "Hollow Valley Server Management Agent - Staging" | Out-Null
    Start-ScheduledTask -TaskName "Hollow Valley Server Management Agent - Staging"

The global mutex intentionally prevents two management agents from running concurrently, to avoid duplicate operations. Lost write results become Unknown and are not automatically retried. The task state is not proof of working game functionality; verify the existing Command Bridge and forwarder separately.
