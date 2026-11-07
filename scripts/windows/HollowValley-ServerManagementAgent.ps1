# Hollow Valley owner management agent v0.1
# Outbound HTTPS only. No inbound RDP, RCON, WinRM or arbitrary shell endpoint.
[CmdletBinding()]
param(
    [ValidateSet('https://hollow-valley-management-staging.onrender.com', 'https://hollowvalleyisle.com')]
    [string]$SiteUrl = 'https://hollow-valley-management-staging.onrender.com',
    [ValidateSet('C:\HollowValley\Secrets\management-agent-token.txt', 'C:\HollowValley\Secrets\management-agent-production-token.txt')]
    [string]$TokenFile = 'C:\HollowValley\Secrets\management-agent-token.txt',
    [int]$PollSeconds = 20,
    [switch]$StatusOnly,
    [switch]$AllowTaskWrites,
    [switch]$AllowGrowthWrites
)

$ErrorActionPreference = 'Stop'
if ($SiteUrl -notmatch '^https://[a-zA-Z0-9.-]+(?::443)?/?$') {
    throw 'SiteUrl must be a trusted HTTPS hostname without path or query.'
}
if ($PollSeconds -lt 10 -or $PollSeconds -gt 120) {
    throw 'PollSeconds must be between 10 and 120.'
}

$production = $SiteUrl -eq 'https://hollowvalleyisle.com'
$expectedTokenFile = if ($production) {
    'C:\HollowValley\Secrets\management-agent-production-token.txt'
} else {
    'C:\HollowValley\Secrets\management-agent-token.txt'
}
if ($TokenFile -ne $expectedTokenFile) {
    throw 'Management site and token-file environments do not match.'
}
if (($AllowTaskWrites -or $AllowGrowthWrites) -and -not $production) {
    throw 'Management writes cannot be enabled for the staging agent.'
}
if (-not (Test-Path -LiteralPath $TokenFile)) {
    throw "Management token file is missing: $TokenFile"
}
$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
if ($token.Length -lt 32) { throw 'Dedicated management token is too short.' }
$apiBase = $SiteUrl.TrimEnd('/') + '/api/binarylane-management'
$headers = @{ Authorization = "Bearer $token" }
$growthHelper = Join-Path $PSScriptRoot 'HollowValley-GrowthConfig.ps1'
$growthAvailable = Test-Path -LiteralPath $growthHelper
if ($growthAvailable) { . $growthHelper }
if ($AllowGrowthWrites -and (-not $AllowTaskWrites -or -not $growthAvailable)) {
    throw 'Growth writes require the helper and the existing local task-write gate.'
}
$growthIni = 'C:\HollowValley\TheIsleServer\TheIsle\Saved\Config\WindowsServer\Game.ini'
$growthReceipt = 'C:\HollowValley\Management\growth-receipt.json'

# Prevent a duplicate agent when Task Scheduler restarts this process.
$mutex = [System.Threading.Mutex]::new($false, 'Global\HollowValleyServerManagementAgent')
$mutexHeld = $false
try {
    try { $mutexHeld = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) {
        Write-Host 'A management agent is already running; exiting.'
        exit 0
    }

    $taskNames = [ordered]@{
        watchdog = 'Hollow Valley Watchdog Handoff'
        scheduled_restart = 'Hollow Valley 12 Hour Restart'
        autosave = 'Hollow Valley Auto Save'
        scanner = 'Hollow Valley Player Scanner'
        command_bridge = 'Hollow Valley Command Bridge Agent'
        combat_forwarder = 'HollowValleyCombatForwarder'
        legacy_combat_forwarder = 'Hollow Valley Chat Combat Forwarder'
    }

    function Get-TaskState {
        param([string]$Name)
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $task) { return 'Missing' }
        return [string]$task.State
    }

    function Get-SafeLogTail {
        param([string]$Path)
        if (-not (Test-Path -LiteralPath $Path)) { return @() }
        try {
            return @(
                Get-Content -LiteralPath $Path -Tail 12 -ErrorAction Stop |
                    ForEach-Object {
                        $line = [string]$_
                        $line = $line -replace '(?i)(Bearer\s+)[^\s]+', '$1[REDACTED]'
                        $line = $line -replace '(?i)\b(token|password|secret|authorization)\s*[:=]\s*.*$', '$1=[REDACTED]'
                        if ($line.Length -gt 300) { $line = $line.Substring(0, 300) }
                        $line
                    }
            )
        } catch { return @() }
    }

    function Get-Snapshot {
        $processes = @(Get-Process -Name 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue)
        $gamePid = $null
        $started = $null
        $rconOwned = $false
        if ($processes.Count -eq 1) {
            $gamePid = [int]$processes[0].Id
            $started = $processes[0].StartTime.ToUniversalTime().ToString('o')
            $rcon = @(Get-NetTCPConnection -LocalPort 8888 -State Listen -ErrorAction SilentlyContinue |
                Where-Object { $_.OwningProcess -eq $gamePid })
            $rconOwned = ($rcon.Count -gt 0)
        }

        $states = @{}
        foreach ($key in $taskNames.Keys) {
            $states[$key] = Get-TaskState -Name $taskNames[$key]
        }
        return @{
            agentVersion = 'v0.3-growth-config'
            allowTaskWrites = [bool]$AllowTaskWrites
            growth = $(if ($growthAvailable) {
                Get-HVGrowthStatus -Path $growthIni -ReceiptPath $growthReceipt -WritesEnabled ([bool]$AllowGrowthWrites) -StartedAt $started -RconReady $rconOwned
            } else { @{ supported = $false; writesEnabled = $false } })
            server = @{
                pid = $gamePid
                processCount = $processes.Count
                startedAt = $started
                rconOwnedByGame = $rconOwned
            }
            tasks = $states
            logs = @{
                restart = @(Get-SafeLogTail -Path 'C:\HollowValley\Logs\scheduled-restart.log')
                forwarder = @(Get-SafeLogTail -Path 'C:\HollowValley\ChatFeed\game-chat-forwarder-task.log')
                bridge = @(Get-SafeLogTail -Path 'C:\HollowValley\Logs\command-bridge-agent.log')
            }
        }
    }

    function Send-Json {
        param([string]$Path, [hashtable]$Body)
        $json = ConvertTo-Json -InputObject $Body -Depth 7 -Compress
        return Invoke-RestMethod -Uri ($apiBase + $Path) -Method Post -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 15
    }

    function Find-RunningAgent {
        param([string]$Target)
        $pattern = if ($Target -eq 'command_bridge') {
            'Run-CommandBridgeAgent\.ps1'
        } else {
            'game-chat-forwarder\.js'
        }
        $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -in @('powershell.exe','pwsh.exe','node.exe') -and
                $_.CommandLine -match $pattern
            })
        return ($processes.Count -gt 0)
    }

    function Invoke-ApprovedTaskAction {
        param([psobject]$Job)
        if ([string]$Job.action -ne 'enable_start') {
            throw 'Action rejected: not in the local allowlist.'
        }
        $target = [string]$Job.target
        if ($target -notin @('command_bridge', 'combat_forwarder')) {
            throw 'Target rejected: not in the local allowlist.'
        }
        if (@(Get-Process 'TheIsleServer-Win64-Shipping' -ErrorAction SilentlyContinue).Count -ne 1) {
            throw 'Expected exactly one running game server; no changes made.'
        }
        if ($target -eq 'combat_forwarder') {
            $legacy = Get-TaskState -Name $taskNames['legacy_combat_forwarder']
            if ($legacy -ne 'Disabled' -and $legacy -ne 'Missing') {
                throw 'Legacy forwarder must be disabled; no changes made.'
            }
        }

        $name = [string]$taskNames[$target]
        $state = Get-TaskState -Name $name
        if ($state -eq 'Missing') { throw "Task is missing: $name" }
        if ($state -eq 'Disabled') {
            Enable-ScheduledTask -TaskName $name | Out-Null
        }
        if (-not (Find-RunningAgent -Target $target)) {
            $state = Get-TaskState -Name $name
            if ($state -ne 'Running') {
                Start-ScheduledTask -TaskName $name
            }
        }
        Start-Sleep -Seconds 2
        return ('{0}: task={1}; processDetected={2}' -f $name,(Get-TaskState -Name $name),(Find-RunningAgent -Target $target))
    }

    function Invoke-ApprovedGrowthAction {
        param([psobject]$Job)
        if (-not $AllowGrowthWrites -or -not $AllowTaskWrites -or -not $production) { throw 'Local growth gate is disabled.' }
        if ($Job.action -cne 'set_growth_config' -or $Job.target -cne 'game_ini' -or
            $Job.multiplier -notin @(1,2,3,4,5,10) -or $Job.id -cnotmatch '^[a-f0-9-]{36}$') { throw 'Invalid growth job.' }
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $growthReceipt))) { throw 'Growth receipt directory has not been installed.' }
        $snapshot = Get-Snapshot
        if ($snapshot.server.processCount -ne 1 -or -not $snapshot.server.rconOwnedByGame -or
            $snapshot.tasks.scheduled_restart -ne 'Ready' -or $snapshot.growth.state -in @('pending_restart','needs_inspection')) {
            throw 'Game or restart state is unsafe for a configuration write.'
        }
        if ($snapshot.growth.configHash -cne $Job.expectedHash) { throw 'Configuration changed since review.' }
        $receipt = @{ jobId = [string]$Job.id; stage = 'writing'; multiplier = [int]$Job.multiplier }
        # Journal before mutation. An interrupted write blocks further work, never replays it.
        Write-HVGrowthReceipt -Path $growthReceipt -Receipt $receipt
        $result = Set-HVGrowthDocument -Path $growthIni -Multiplier $Job.multiplier -ExpectedHash $Job.expectedHash -JobId $Job.id
        $after = Get-Snapshot
        if ($after.server.startedAt -cne $snapshot.server.startedAt -or $after.tasks.scheduled_restart -ne 'Ready') {
            throw 'Game/restart state changed during the write; inspect the retained backup.'
        }
        $receipt.stage = 'written'
        $receipt.configHash = $result.Hash
        $receipt.backup = $result.Backup
        $receipt.writtenAt = [datetimeoffset]::UtcNow.ToString('o')
        Write-HVGrowthReceipt -Path $growthReceipt -Receipt $receipt
        return "Saved $($Job.multiplier)x growth; backup retained and read-back verified. Awaiting scheduled restart."
    }

    $mode = if ($AllowTaskWrites) { 'allowlisted task writes enabled' } else { 'read-only' }
    Write-Host "Hollow Valley management agent starting (outbound HTTPS; $mode)."
    while ($true) {
        try {
            $null = Send-Json -Path '/status' -Body (Get-Snapshot)
            if ($StatusOnly) {
                Write-Host 'Read-only status submitted.'
                break
            }

            if (-not $AllowTaskWrites) {
                Start-Sleep -Seconds $PollSeconds
                continue
            }
            $next = Invoke-RestMethod -Uri ($apiBase + '/next') -Method Get -Headers $headers -TimeoutSec 15
            if ($null -ne $next.job) {
                $job = $next.job
                $resultState = 'failed'
                $resultMessage = 'Action not executed.'
                $growthJob = $job.action -ceq 'set_growth_config'
                try {
                    if ($growthJob) {
                        $resultMessage = Invoke-ApprovedGrowthAction -Job $job
                        $resultState = 'written'
                    } else {
                        $resultMessage = Invoke-ApprovedTaskAction -Job $job
                        $resultState = 'succeeded'
                    }
                } catch {
                    $resultMessage = $_.Exception.Message
                    if ($growthJob) { $resultState = 'unknown' }
                }

                # Lost results become UNKNOWN, never automatically retried.
                $resultPath = if ($growthJob) { "/growth/$($job.id)/result" } else { "/jobs/$($job.id)/result" }
                $null = Send-Json -Path $resultPath -Body @{
                    leaseToken = [string]$job.leaseToken
                    state = $resultState
                    message = $resultMessage
                }
                Write-Host "Job $($job.id) result sent: $resultState"
            }
        } catch {
            # Don't print secrets or HTTP request headers in operational logs.
            Write-Warning ("Management poll failed: " + $_.Exception.GetType().Name)
            if ($StatusOnly) { throw }
        }
        Start-Sleep -Seconds $PollSeconds
    }
} finally {
    if ($mutexHeld) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
