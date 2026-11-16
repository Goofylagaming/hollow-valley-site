# Hollow Valley live BinaryLane restart warning patch.
# Edits only the existing LOCAL restart script; does not deploy the different
# GitHub-tracked restart implementation, alter save logic or restart the server.
# Default is read-only preview. Apply explicitly with -Apply.
[CmdletBinding()]
param(
    [string]$RestartScriptPath = 'C:\HollowValley\Scripts\HollowValley-AutoRestart.ps1',
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'

function Assert-PowerShellSyntax {
    param([string]$Source)
    $tokens = $null
    $parseErrors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput(
        $Source, [ref]$tokens, [ref]$parseErrors
    )
    if (@($parseErrors).Count -gt 0) {
        throw "Patched script contains PowerShell syntax errors. No changes made: $($parseErrors[0].Message)"
    }
}

function Indent-Block {
    param(
        [string]$Source,
        [string]$Indent,
        [string]$Newline
    )
    $lines = $Source.Trim([char[]]@([char]13,[char]10)) -split '\r?\n'
    return (($lines | ForEach-Object { $Indent + $_ }) -join $Newline) + $Newline
}

if (-not (Test-Path -LiteralPath $RestartScriptPath)) {
    throw "Live restart script missing: $RestartScriptPath"
}
$restartTask = Get-ScheduledTask -TaskName 'Hollow Valley 12 Hour Restart' -ErrorAction SilentlyContinue
if ($restartTask -and $restartTask.State -eq 'Running') {
    throw 'The scheduled restart task is running; refusing to edit its script mid-restart.'
}

$original = [System.IO.File]::ReadAllText($RestartScriptPath)
Assert-PowerShellSyntax -Source $original
if ($original -notmatch '\$AnnounceScript' -or
    $original -notmatch 'Send-HollowValleyAnnouncement\.ps1' -or
    $original -notmatch 'Write-RestartLog' -or
    $original -notmatch 'SAVE #1' -or
    $original -notmatch 'SAVE #2') {
    throw 'Unexpected local restart implementation. No edits made. Inspect the script.'
}

$hasFive = $original.Contains('# HV-RCON-5M-BEGIN')
$hasOne = $original.Contains('# HV-RCON-1M-BEGIN')
if ($hasFive -or $hasOne) {
    if ($hasFive -and $hasOne) {
        Write-Host 'Both 5-minute and 1-minute warning blocks are already installed. No changes made.' -ForegroundColor Green
        return
    }
    throw 'Partial warning patch detected. No changes made; inspect the existing script.'
}

$fivePattern = '(?m)^(?<indent>[ \t]*)Start-Sleep[ \t]+-Seconds[ \t]+500[ \t]*(?:\r?\n|$)'
$onePattern = '(?m)^(?<indent>[ \t]*)Write-RestartLog[ \t]+"Waiting 60 seconds after final confirmed save\."[ \t]*\r?\n[ \t]*Start-Sleep[ \t]+-Seconds[ \t]+60[ \t]*(?:\r?\n|$)'
$fiveMatches = [regex]::Matches($original, $fivePattern)
$oneMatches = [regex]::Matches($original, $onePattern)
if ($fiveMatches.Count -ne 1 -or $oneMatches.Count -ne 1) {
    throw "Expected exactly one countdown sleep (500 sec) and one final post-save wait (60 sec); found $($fiveMatches.Count) and $($oneMatches.Count). No changes made."
}
$countdownIndex = $original.IndexOf('Write-RestartLog "Waiting for restart countdown."')
if ($countdownIndex -lt 0 -or $fiveMatches[0].Index -lt $countdownIndex -or
    ($fiveMatches[0].Index - $countdownIndex) -gt 150) {
    throw '500-second sleep is not immediately after the expected countdown log. No changes made.'
}
if ($oneMatches[0].Index -le $fiveMatches[0].Index) {
    throw 'Save/wait order is unexpected. No changes made.'
}
$newline = if ($original.Contains(([string][char]13 + [char]10))) {
    ([string][char]13 + [char]10)
} else { [string][char]10 }

# Splits the existing 500-second countdown into 295 sec + RCON warning +
# 205 sec. This preserves the existing total delay. Combined with the
# previously verified save times, the notice is approx. 5 min before shutdown.
$fiveTemplate = @'
# HV-RCON-5M-BEGIN
Start-Sleep -Seconds 295
try {
    if (Test-Path -LiteralPath $AnnounceScript) {
        Write-RestartLog 'Sending 5-minute restart warning.'
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $AnnounceScript -Message 'Server is restarting in 5 minutes. Please find a safe place.'
        if ($LASTEXITCODE -eq 0) {
            Write-RestartLog '5-minute restart warning packet sent.'
        } else {
            Write-RestartLog "5-minute restart warning failed, exit code $LASTEXITCODE."
        }
    } else {
        Write-RestartLog '5-minute restart warning skipped: announcement sender missing.'
    }
} catch {
    Write-RestartLog "5-minute restart warning error: $($_.Exception.Message)"
}
Start-Sleep -Seconds 205
# HV-RCON-5M-END
'@

# This notice is sent only *after* the two verified saves succeed and right
# before the existing final 60-second delay, not before a failed save.
$oneTemplate = @'
# HV-RCON-1M-BEGIN
try {
    if (Test-Path -LiteralPath $AnnounceScript) {
        Write-RestartLog 'Sending 1-minute restart warning.'
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $AnnounceScript -Message 'Server is restarting in 1 minute. Please stay in a safe place.'
        if ($LASTEXITCODE -eq 0) {
            Write-RestartLog '1-minute restart warning packet sent.'
        } else {
            Write-RestartLog "1-minute restart warning failed, exit code $LASTEXITCODE."
        }
    } else {
        Write-RestartLog '1-minute restart warning skipped: announcement sender missing.'
    }
} catch {
    Write-RestartLog "1-minute restart warning error: $($_.Exception.Message)"
}
# HV-RCON-1M-END
Write-RestartLog "Waiting 60 seconds after final confirmed save."
Start-Sleep -Seconds 60
'@

$fiveBlock = Indent-Block -Source $fiveTemplate -Indent $fiveMatches[0].Groups['indent'].Value -Newline $newline
$oneBlock = Indent-Block -Source $oneTemplate -Indent $oneMatches[0].Groups['indent'].Value -Newline $newline
$revised = $original.Replace($fiveMatches[0].Value, $fiveBlock)
$revised = $revised.Replace($oneMatches[0].Value, $oneBlock)

# Remove only the accidental double full stop in the existing 10-minute notice.
$revised = $revised.Replace('takes place..', 'takes place.')
Assert-PowerShellSyntax -Source $revised
if (-not $revised.Contains('# HV-RCON-5M-BEGIN') -or -not $revised.Contains('# HV-RCON-1M-BEGIN')) {
    throw 'Patched script did not contain both warning blocks. No changes made.'
}

Write-Host 'Verified local restart script structure and PowerShell syntax.' -ForegroundColor Green
Write-Host 'Planned change: preserve 10-minute message, add approx. 5-minute message during countdown, add 1-minute message after successful saves.'
Write-Host 'Original save verification, final 60-second delay, process shutdown and watchdog logic are retained.'
if (-not $Apply) {
    Write-Host 'PREVIEW ONLY: no file changes. Run with -Apply to install.' -ForegroundColor Yellow
    return
}

$backup = "$RestartScriptPath.bak-5m1m-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $RestartScriptPath -Destination $backup -ErrorAction Stop
$temp = "$RestartScriptPath.new-$([guid]::NewGuid().ToString('N'))"
try {
    [System.IO.File]::WriteAllText($temp, $revised, [System.Text.UTF8Encoding]::new($true))
    # Same-volume replacement is atomic on NTFS; the separately saved backup
    # permits easy manual rollback. No game process is touched.
    # Windows PowerShell 5.1 / .NET Framework requires a valid, non-null
    # destination backup path for File.Replace; $null can throw ArgumentException.
    # Keep the independent preflight backup above and create a second atomic
    # rollback copy during replacement. Neither operation touches the game.
    $atomicBackup = "$RestartScriptPath.atomic-backup-$([guid]::NewGuid().ToString('N'))"
    [System.IO.File]::Replace($temp, $RestartScriptPath, $atomicBackup)
} finally {
    if (Test-Path -LiteralPath $temp) {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}
Write-Host 'INSTALLED: 5-minute and 1-minute restart announcements.' -ForegroundColor Green
Write-Host "Live restart script backup: $backup"
Write-Host 'No restart was requested; the next scheduled restart run will use the new messages.'
