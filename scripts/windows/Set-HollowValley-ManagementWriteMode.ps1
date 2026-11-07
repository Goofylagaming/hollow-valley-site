# Owner-approved local write gate for Hollow Valley management agent ONLY.
# Does not stop/restart The Isle, RCON, watchdog, scanner or existing forwarders.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Enable', 'Disable')]
    [string]$Mode
)
$ErrorActionPreference = 'Stop'

$taskName = 'Hollow Valley Server Management Agent - Production'
$scriptPath = 'C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1'
$prodToken = 'C:\HollowValley\Secrets\management-agent-production-token.txt'
$productionUrl = 'https://hollowvalleyisle.com'
$baseArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    $scriptPath + '" -SiteUrl "' + $productionUrl + '" -TokenFile "' + $prodToken + '"'
$writeArgs = $baseArgs + ' -AllowTaskWrites'
$growthArgs = $writeArgs + ' -AllowGrowthWrites'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open an elevated PowerShell window. No changes made.'
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$actions = @($task.Actions)
if ($actions.Count -ne 1 -or
    $actions[0].Execute -notmatch '(?i)(^|\\)powershell\.exe$' -or
    $actions[0].Arguments -notin @($baseArgs, $writeArgs, $growthArgs) -or
    $task.Principal.UserId -notmatch '(?i)(^SYSTEM$|\\SYSTEM$)') {
    throw 'Unexpected production management Scheduled Task configuration. No changes made.'
}
if (-not (Test-Path -LiteralPath $prodToken)) {
    throw 'Production management token missing. No changes made.'
}
if ($Mode -eq 'Enable') {
    $games = @(Get-Process -Name 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue)
    if ($games.Count -ne 1) { throw 'Expected exactly one Isle game process. No changes made.' }
    $duplicate = Get-ScheduledTask -TaskName 'Hollow Valley Chat Combat Forwarder' -ErrorAction SilentlyContinue
    if ($duplicate -and $duplicate.State -ne 'Disabled') {
        throw 'Legacy duplicate combat forwarder must remain disabled. No changes made.'
    }
    $answer = Read-Host 'Type exactly ENABLE LIMITED PROD TASK ACTIONS to activate allowlisted maintenance'
    if ($answer -cne 'ENABLE LIMITED PROD TASK ACTIONS') {
        throw 'Confirmation did not match. No changes made.'
    }
}
$arguments = if ($Mode -eq 'Enable') {
    if ($actions[0].Arguments -ceq $growthArgs) { $growthArgs } else { $writeArgs }
} else { $baseArgs }
if ($actions[0].Arguments -ceq $arguments) {
    Write-Host "Production agent already configured for Mode=$Mode. Nothing changed."
    exit 0
}

# Only the management agent process is restarted; game server is not affected.
$replacement = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument $arguments
if ($task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 3
}
Set-ScheduledTask -TaskName $taskName -Action $replacement | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$updated = Get-ScheduledTask -TaskName $taskName
if (@($updated.Actions).Count -ne 1 -or
    $updated.Actions[0].Arguments -cne $arguments) {
    throw 'Management task was modified but new action could not be verified.'
}
Write-Host "Production management local mode: $Mode" -ForegroundColor Green
Write-Host "Production management task state: $($updated.State)"
Write-Host 'The Isle and its watchdog have not been restarted.'
