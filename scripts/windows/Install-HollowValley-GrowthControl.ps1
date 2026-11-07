# Upgrade only the management agent. Does not write Game.ini or restart the game.
# Run from the reviewed release's scripts/windows folder on BinaryLane as Administrator.
[CmdletBinding()]
param([string]$SourceDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator PowerShell is required.' }
$taskName = 'Hollow Valley Server Management Agent - Production'
$destination = 'C:\HollowValley\Scripts'
$stateDirectory = 'C:\HollowValley\Management'
$names = @('HollowValley-ServerManagementAgent.ps1', 'HollowValley-GrowthConfig.ps1', 'Set-HollowValley-ManagementWriteMode.ps1')
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$actions = @($task.Actions)
$baseArgs = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1" -SiteUrl "https://hollowvalleyisle.com" -TokenFile "C:\HollowValley\Secrets\management-agent-production-token.txt"'
$taskArgs = $baseArgs + ' -AllowTaskWrites'
$growthArgs = $taskArgs + ' -AllowGrowthWrites'
if ($actions.Count -ne 1 -or $actions[0].Execute -notmatch '(?i)(^|\\)powershell\.exe$' -or
    $actions[0].Arguments -notin @($taskArgs, $growthArgs) -or $task.Principal.UserId -notmatch '(?i)(^SYSTEM$|\\SYSTEM$)') {
    throw 'Unexpected management task or existing writes disabled. Inspect before upgrading.'
}
$oldArguments = $actions[0].Arguments
foreach ($name in $names) {
    $source = Join-Path $SourceDirectory $name
    if ([IO.Path]::GetFullPath($source) -ieq (Join-Path $destination $name)) { throw 'Run from a separate release folder, not the installed Scripts directory.' }
    $parseErrors = $null; $tokens = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "Release file failed parsing: $name" }
}
. (Join-Path $SourceDirectory 'HollowValley-GrowthConfig.ps1')
Assert-HVGrowthRegularPath $destination
Assert-HVGrowthRegularPath $stateDirectory
foreach ($name in $names) { Assert-HVGrowthRegularPath (Join-Path $destination $name) }
$ini = 'C:\HollowValley\TheIsleServer\TheIsle\Saved\Config\WindowsServer\Game.ini'
$before = Get-HVGrowthDocument $ini
$games = @(Get-Process 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue)
if ($games.Count -ne 1) { throw 'Expected exactly one game process; no changes made.' }
if ((Get-ScheduledTask -TaskName 'Hollow Valley 12 Hour Restart').State -ne 'Ready') { throw 'Wait until the restart task is ready.' }
# These tests operate exclusively on temporary fixture files.
& (Join-Path $SourceDirectory 'Test-HollowValley-GrowthConfig.ps1')
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$acl = Get-Acl -LiteralPath $stateDirectory
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        ([Security.Principal.SecurityIdentifier]::new($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $stateDirectory -AclObject $acl
$backupDirectory = Join-Path $stateDirectory ('agent-backup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupDirectory | Out-Null
Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $backupDirectory 'task.xml') -Encoding UTF8
foreach ($name in $names) {
    $installed = Join-Path $destination $name
    if (Test-Path -LiteralPath $installed) { Copy-Item -LiteralPath $installed -Destination (Join-Path $backupDirectory $name) }
}
try {
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 3
    if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { throw 'Management agent did not stop; files not replaced.' }
    foreach ($name in $names) {
        Copy-Item -LiteralPath (Join-Path $SourceDirectory $name) -Destination (Join-Path $destination $name) -Force
        if ((Get-FileHash -LiteralPath (Join-Path $SourceDirectory $name)).Hash -cne (Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash) { throw 'Installed file hash mismatch.' }
    }
    Set-ScheduledTask -TaskName $taskName -Action (New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument $growthArgs) | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 5
    if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { throw 'Updated management agent is not running.' }
    if ((Get-HVGrowthDocument $ini).Hash -cne $before.Hash) { throw 'Game.ini changed during installation; inspect it.' }
    $after = @(Get-Process 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue)
    if ($after.Count -ne 1 -or $after[0].Id -ne $games[0].Id) { throw 'Game process changed during installation; inspect the server.' }
} catch {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    foreach ($name in $names) {
        $backup = Join-Path $backupDirectory $name
        if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination (Join-Path $destination $name) -Force }
    }
    Set-ScheduledTask -TaskName $taskName -Action (New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument $oldArguments) | Out-Null
    Start-ScheduledTask -TaskName $taskName
    throw
}
Write-Host 'Growth-capable management agent installed. No growth setting or game restart was requested.' -ForegroundColor Green
Write-Host 'Wait for a fresh website heartbeat, then use Server Growth Setting in Admin Operations.'
Write-Host "Previous agent files and task backup: $backupDirectory"
