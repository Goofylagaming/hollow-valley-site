# Controlled staging -> production cutover for the OUTBOUND MANAGEMENT AGENT ONLY.
# Never calls Stop-Process, restarts The Isle, updates UE4SS, or changes the watchdog.
[CmdletBinding()]
param(
    [string]$AgentPath = 'C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1',
    [string]$InstallerPath = 'C:\HollowValley\Scripts\Install-HollowValley-ServerManagement.ps1'
)
$ErrorActionPreference = 'Stop'
$stagingName = 'Hollow Valley Server Management Agent - Staging'
$productionName = 'Hollow Valley Server Management Agent - Production'
$siteUrl = 'https://hollowvalleyisle.com'
$productionToken = 'C:\HollowValley\Secrets\management-agent-production-token.txt'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Use an elevated PowerShell window. No changes made.'
}
if (-not (Test-Path -LiteralPath $AgentPath) -or
    -not (Test-Path -LiteralPath $InstallerPath) -or
    -not (Test-Path -LiteralPath $productionToken)) {
    throw 'Agent, installer or separate production token is missing. No changes made.'
}
if (Get-ScheduledTask -TaskName $productionName -ErrorAction SilentlyContinue) {
    throw 'Production management task already exists. Inspect it before re-running this cutover.'
}
$stageTask = Get-ScheduledTask -TaskName $stagingName -ErrorAction Stop
if ($stageTask.State -ne 'Running') {
    throw 'Staging management agent is not running. No changes made.'
}
$stagingArgs = [string]$stageTask.Actions[0].Arguments
if (@($stageTask.Actions).Count -ne 1 -or
    $stagingArgs -notmatch 'hollow-valley-management-staging\.onrender\.com' -or
    $stagingArgs -notmatch 'HollowValley-ServerManagementAgent\.ps1') {
    throw 'Unexpected staging task configuration. No changes made.'
}

# Verify production credentials BEFORE stopping the known-good staging agent.
# This endpoint is read-only and never claims a job or alters a heartbeat.
$secret = (Get-Content -LiteralPath $productionToken -Raw).Trim()
if ($secret.Length -lt 32) {
    throw 'Production management token is too short. Staging was not touched.'
}
try {
    $auth = @{ Authorization = "Bearer $secret" }
    $probe = Invoke-RestMethod -Uri ($siteUrl + '/api/binarylane-management/probe') -Method Get -Headers $auth -TimeoutSec 15
} catch {
    $code = 0
    if ($_.Exception.Response) {
        $code = [int]$_.Exception.Response.StatusCode
    }
    if ($code -eq 404) {
        throw 'Production management is still disabled or its dedicated token is missing in Render. Staging was not touched.'
    }
    if ($code -eq 401) {
        throw 'Production Render and BinaryLane tokens do not match. Staging was not touched.'
    }
    throw "Production management preflight failed (HTTP $code). Staging was not touched."
} finally {
    $secret = $null
    $auth = $null
}
if ($probe.ok -ne $true -or $probe.writesEnabled -ne $false) {
    throw 'Production preflight rejected: endpoint must be healthy with writes DISABLED. Staging was not touched.'
}
Write-Host 'Production endpoint authenticated; read-only preflight passed. Staging is still running.' -ForegroundColor Green

$answer = Read-Host 'Type exactly SWITCH MANAGEMENT TO PRODUCTION (does NOT restart The Isle)'
if ($answer -cne 'SWITCH MANAGEMENT TO PRODUCTION') {
    throw 'Confirmation did not match. No changes made.'
}

$gameBefore = @(Get-Process -Name 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue)
if ($gameBefore.Count -ne 1) {
    throw 'Expected exactly one running game server. No changes made.'
}
$gamePidBefore = $gameBefore[0].Id
try {
    # Preserve the staging task for rollback, but disable its boot trigger.
    Stop-ScheduledTask -TaskName $stagingName
    Disable-ScheduledTask -TaskName $stagingName | Out-Null
    Start-Sleep -Seconds 4

    # A one-shot, read-only production heartbeat must succeed BEFORE startup registration.
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $AgentPath -SiteUrl $siteUrl -TokenFile $productionToken -StatusOnly 2>&1
    $exitCode = $LASTEXITCODE
    $message = ($output | Out-String)
    if ($exitCode -ne 0 -or $message -notmatch 'Read-only status submitted\.') {
        throw 'Production read-only heartbeat did not succeed. Staging will be restored.'
    }
    Write-Host 'Production one-shot read-only heartbeat verified.' -ForegroundColor Green

    $installOutput = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $InstallerPath -SiteUrl $siteUrl -TokenFile $productionToken -TaskName $productionName 2>&1
    $installExit = $LASTEXITCODE
    $installed = Get-ScheduledTask -TaskName $productionName -ErrorAction SilentlyContinue
    if ($installExit -ne 0 -or -not $installed) {
        throw 'Production management Scheduled Task installation failed.'
    }
    Start-Sleep -Seconds 4
    $active = Get-ScheduledTask -TaskName $productionName
    if ($active.State -ne 'Running') {
        throw 'Production management Scheduled Task is not running.'
    }
    $gameAfter = @(Get-Process -Name 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue)
    if ($gameAfter.Count -ne 1 -or $gameAfter[0].Id -ne $gamePidBefore) {
        throw 'Game process unexpectedly changed during cutover; inspect it. Production management will be stopped.'
    }
    Write-Host 'PRODUCTION MANAGEMENT CONNECTED (READ ONLY)' -ForegroundColor Green
    Write-Host "Production task: $($active.State)"
    Write-Host "Staging task: $((Get-ScheduledTask -TaskName $stagingName).State)"
    Write-Host "Game server remains on original PID $gamePidBefore"
    Write-Host 'Website writes must remain disabled until owner approval and later activation.'
} catch {
    if (Get-ScheduledTask -TaskName $productionName -ErrorAction SilentlyContinue) {
        try { Stop-ScheduledTask -TaskName $productionName -ErrorAction SilentlyContinue } catch {}
        try { Disable-ScheduledTask -TaskName $productionName -ErrorAction SilentlyContinue | Out-Null } catch {}
    }
    try {
        Enable-ScheduledTask -TaskName $stagingName | Out-Null
        Start-ScheduledTask -TaskName $stagingName
        Write-Warning 'Staging management agent restored; production cutover did not complete.'
    } catch {
        Write-Warning 'Automatic staging rollback failed. Check only the management Scheduled Tasks.'
    }
    throw
}
