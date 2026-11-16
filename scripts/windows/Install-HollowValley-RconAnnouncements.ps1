# One-time installer for Hollow Valley informational RCON announcements.
# Creates only two new scheduled tasks; never starts or stops The Isle.
# Narrowly patches only the current 10-minute warning text in the live restart script.
[CmdletBinding()]
param(
    [string]$AnnouncementScriptPath = 'C:\HollowValley\Scripts\HollowValley-RconAnnouncements.ps1',
    [string]$RestartScriptPath = 'C:\HollowValley\Scripts\HollowValley-AutoRestart.ps1',
    [string]$PasswordPath = 'C:\HollowValley\Secrets\rcon-password.txt'
)
$ErrorActionPreference = 'Stop'

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer from an elevated Administrator PowerShell session.'
}
foreach ($path in @($AnnouncementScriptPath, $RestartScriptPath, $PasswordPath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required local file not found: $path" }
}

function Assert-PowershellParses {
    param([string]$Source, [string]$Label)
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($Source, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "$Label has PowerShell parse errors. No configuration was changed." }
}
$announcementsSource = Get-Content -LiteralPath $AnnouncementScriptPath -Raw
Assert-PowershellParses -Source $announcementsSource -Label 'Announcement script'
if ($announcementsSource -notmatch 'Send-EvrimaAnnouncement' -or $announcementsSource -notmatch '0x10') {
    throw 'The announcement script is not the expected RCON announcement-only implementation.'
}
& $AnnouncementScriptPath -Mode Links -Preview
& $AnnouncementScriptPath -Mode Tips -Preview

$restartSource = Get-Content -LiteralPath $RestartScriptPath -Raw
$oldWarning = 'Game is restarting in 10 minutes'
$newWarning = 'Server is restarting in 10 minutes, please find a safe place whilst the restart takes place.'
if ($restartSource.Contains($oldWarning)) {
    $revisedRestart = $restartSource.Replace($oldWarning, $newWarning)
    Assert-PowershellParses -Source $revisedRestart -Label 'Revised restart script'
    $patchWarning = $true
} elseif ($restartSource.Contains($newWarning)) {
    $revisedRestart = $restartSource
    $patchWarning = $false
} else {
    throw 'Live restart script does not contain the expected old or new message. Refusing to rewrite restart logic; inspect it manually.'
}

$linksName = 'Hollow Valley RCON Links'
$tipsName = 'Hollow Valley RCON Tips'
foreach ($name in @($linksName, $tipsName)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        throw "Task '$name' already exists. Inspect it before making changes."
    }
}

# Local Windows task time. Keep these times away from the existing 11:51/23:51
# restart warning and 12:01/00:01 restart.
$linksMinutes = @(0..15 | ForEach-Object { 15 + (90 * $_) }) # 00:15, 01:45, ... 22:45
$tipsMinutes = @(0..7 | ForEach-Object { 55 + (180 * $_) }) # 00:55, 03:55, ... 21:55
$linksTriggers = @($linksMinutes | ForEach-Object {
    New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddMinutes($_))
})
$tipsTriggers = @($tipsMinutes | ForEach-Object {
    New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddMinutes($_))
})
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

function New-AnnouncementAction {
    param([string]$Mode)
    $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $AnnouncementScriptPath + '" -Mode ' + $Mode
    return New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument $args -WorkingDirectory (Split-Path -Parent $AnnouncementScriptPath)
}

$created = @()
$backup = $null
try {
    Register-ScheduledTask -TaskName $linksName -Action (New-AnnouncementAction -Mode Links) -Trigger $linksTriggers -Principal $principal -Settings $settings -Description 'Hollow Valley website and Discord links every 90 minutes via RCON' | Out-Null
    $created += $linksName
    Register-ScheduledTask -TaskName $tipsName -Action (New-AnnouncementAction -Mode Tips) -Trigger $tipsTriggers -Principal $principal -Settings $settings -Description 'Rotating Hollow Valley Dino School, events and features every 3 hours via RCON' | Out-Null
    $created += $tipsName

    if ($patchWarning) {
        $backup = "$RestartScriptPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item -LiteralPath $RestartScriptPath -Destination $backup -ErrorAction Stop
        [System.IO.File]::WriteAllText(
            $RestartScriptPath,
            $revisedRestart,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
} catch {
    foreach ($name in $created) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    }
    if ($backup -and (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $backup -Destination $RestartScriptPath -Force
    }
    throw
}

Write-Host 'Installed Hollow Valley RCON recurring announcements.' -ForegroundColor Green
Write-Host 'Links: every 90 minutes (16 announcements/day).'
Write-Host 'Tips: one rotating School, Events or Features message every 3 hours (8/day).'
if ($patchWarning) { Write-Host "Restart warning text updated in place. Backup: $backup" }
else { Write-Host 'Restart warning already contained the requested text.' }
Write-Host 'No game-server restart was requested or performed.'
Write-Host 'Verify task status and review C:\HollowValley\Logs\rcon-announcements.log.'
Write-Host 'Note: tasks run as SYSTEM. A DPAPI password encrypted for another account may not authenticate.'
