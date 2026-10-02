param(
  [string]$ChatFeedDir = 'C:\HollowValley\ChatFeed',
  [string]$TaskName = 'HollowValleyCombatForwarder'
)

$ErrorActionPreference = 'Stop'

$forwarder = Join-Path $ChatFeedDir 'game-chat-forwarder.js'
$launcher = Join-Path $ChatFeedDir 'start-game-chat-forwarder.ps1'
$logFile = Join-Path $ChatFeedDir 'game-chat-forwarder-task.log'

if (-not (Test-Path $forwarder)) {
  throw "Forwarder not found: $forwarder"
}

$machineToken = [Environment]::GetEnvironmentVariable('PRESENCE_FEED_TOKEN', 'Machine')
if (-not $machineToken) {
  throw 'Machine-level PRESENCE_FEED_TOKEN is not configured. Persist the existing token first, then rerun this installer.'
}

$launcherContent = @'
$ErrorActionPreference = 'Stop'
$dir = 'C:\HollowValley\ChatFeed'
$forwarder = Join-Path $dir 'game-chat-forwarder.js'
$logFile = Join-Path $dir 'game-chat-forwarder-task.log'

$env:PRESENCE_FEED_URL = 'https://hollow-valley-automation.onrender.com/api/presence-feed/snapshot'
$env:CHAT_FEED_URL = 'https://hollow-valley-automation.onrender.com/api/chat-feed/messages'
$env:COMBAT_FEED_URL = 'https://hollow-valley-automation.onrender.com/api/combat/events'
$env:PRESENCE_FEED_TOKEN = [Environment]::GetEnvironmentVariable('PRESENCE_FEED_TOKEN', 'Machine')

if (-not $env:PRESENCE_FEED_TOKEN) {
  Add-Content -Path $logFile -Value "$(Get-Date -Format o) TOKEN MISSING; forwarder not started."
  exit 2
}

$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*game-chat-forwarder.js*' }
if ($alreadyRunning) {
  Add-Content -Path $logFile -Value "$(Get-Date -Format o) Forwarder already running; startup task exiting."
  exit 0
}

Set-Location $dir
Add-Content -Path $logFile -Value "$(Get-Date -Format o) Starting Hollow Valley combat/chat forwarder."
& node $forwarder *>> $logFile
'@

Set-Content -Path $launcher -Value $launcherContent -Encoding UTF8

$action = New-ScheduledTaskAction `
  -Execute 'PowerShell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts the Hollow Valley The Isle chat/combat log forwarder at Windows startup.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Installed scheduled task: $TaskName"
Write-Host "Task state: $($task.State)"
Write-Host "Last result: $($info.LastTaskResult)"
Write-Host "Forwarder log: $logFile"
