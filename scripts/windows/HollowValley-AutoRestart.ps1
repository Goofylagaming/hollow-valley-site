# Hollow Valley 12-hour restart with hard restart telemetry.
# Existing Scheduled Task should continue to run this file at 11:51 AM / 11:51 PM.
# The script warns players, saves, stops only TheIsleServer-Win64-Shipping,
# waits for the existing watchdog to relaunch it, verifies RCON, and records evidence.

[CmdletBinding()]
param(
    [string]$RconHost = '127.0.0.1',
    [int]$RconPort = 8888,
    [string]$RconPasswordFile = 'C:\HollowValley\Secrets\rcon-password.txt',
    [string]$ProcessName = 'TheIsleServer-Win64-Shipping',
    [string]$TelemetryUrl = 'https://hollow-valley-automation.onrender.com/api/command-bridge/restart-event',
    [string]$LogPath = 'C:\HollowValley\Logs\scheduled-restart.log'
)

$ErrorActionPreference = 'Stop'
$script:FailureTelemetrySent = $false
$script:RestartId = 'restart-{0}-{1}' -f (Get-Date -Format 'yyyyMMddTHHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))

function Write-Log {
    param([string]$Message)
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $script:RestartId, $Message
    Write-Host $line
    try {
        $dir = Split-Path -Parent $LogPath
        if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } catch {
        Write-Warning "Could not write restart log: $($_.Exception.Message)"
    }
}

function Read-SecretText {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $raw = (Get-Content -LiteralPath $Path -Raw).Trim()
    if (-not $raw) { return $null }

    # First try the DPAPI/SecureString format used by Hollow Valley secret files.
    try {
        $secure = ConvertTo-SecureString -String $raw
        $credential = New-Object System.Management.Automation.PSCredential('ignored', $secure)
        $plain = $credential.GetNetworkCredential().Password
        if ($plain) { return $plain }
    } catch {}

    # Plain text remains supported for the existing RCON password file.
    return $raw
}

function Get-BridgeToken {
    foreach ($value in @($env:BINARYLANE_COMMAND_TOKEN, $env:HOLLOW_VALLEY_COMMAND_TOKEN)) {
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    }

    foreach ($path in @(
        'C:\HollowValley\Secrets\binarylane-command-token.txt',
        'C:\HollowValley\Secrets\command-bridge-token.txt'
    )) {
        $value = Read-SecretText -Path $path
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    }
    return $null
}

function Send-RestartTelemetry {
    param(
        [Parameter(Mandatory = $true)][string]$Event,
        [string]$Message = $null,
        [hashtable]$Details = @{}
    )

    $token = Get-BridgeToken
    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Log "TELEMETRY LOCAL-ONLY event=$Event (BinaryLane command token not available to this task)"
        return $false
    }

    $body = @{
        restartId = $script:RestartId
        event = $Event
        at = (Get-Date).ToUniversalTime().ToString('o')
        message = $Message
        details = $Details
    } | ConvertTo-Json -Depth 5 -Compress

    try {
        Invoke-RestMethod -Method Post -Uri $TelemetryUrl -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body -TimeoutSec 8 | Out-Null
        Write-Log "TELEMETRY event=$Event accepted"
        return $true
    } catch {
        # Restart safety never depends on Render being reachable. The local log
        # remains the authoritative fallback if telemetry cannot be delivered.
        Write-Log "TELEMETRY event=$Event failed: $($_.Exception.Message)"
        return $false
    }
}

function Get-RconPassword {
    $password = Read-SecretText -Path $RconPasswordFile
    if ([string]::IsNullOrWhiteSpace($password)) {
        throw "RCON password is unavailable at $RconPasswordFile"
    }
    return $password
}

function New-RconConnection {
    param([int]$TimeoutMs = 5000)

    $client = New-Object System.Net.Sockets.TcpClient
    $connect = $client.ConnectAsync($RconHost, $RconPort)
    if (-not $connect.Wait($TimeoutMs)) {
        $client.Dispose()
        throw "RCON connection timed out after ${TimeoutMs}ms"
    }

    $stream = $client.GetStream()
    $stream.ReadTimeout = $TimeoutMs
    $stream.WriteTimeout = $TimeoutMs

    $password = Get-RconPassword
    $authPayload = [System.Text.Encoding]::UTF8.GetBytes($password)
    [byte[]]$authPacket = @([byte]0x01) + $authPayload + @([byte]0x00)
    $stream.Write($authPacket, 0, $authPacket.Length)
    $stream.Flush()

    [byte[]]$buffer = New-Object byte[] 4096
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $response = [System.Text.Encoding]::GetEncoding(28591).GetString($buffer, 0, $read)
    if ($response -notlike '*Password Accepted*') {
        $stream.Dispose()
        $client.Dispose()
        throw 'RCON authentication failed'
    }

    return @{ Client = $client; Stream = $stream }
}

function Send-RconCommand {
    param(
        [Parameter(Mandatory = $true)][byte]$Code,
        [string]$Arguments = '',
        [int]$TimeoutMs = 5000
    )

    if ($Arguments -match "[`0`r`n]") { throw 'RCON arguments contain invalid control characters' }
    $connection = New-RconConnection -TimeoutMs $TimeoutMs
    try {
        $argBytes = [System.Text.Encoding]::UTF8.GetBytes($Arguments)
        [byte[]]$packet = @([byte]0x02, $Code) + $argBytes + @([byte]0x00)
        $connection.Stream.Write($packet, 0, $packet.Length)
        $connection.Stream.Flush()
        return $true
    } finally {
        try { $connection.Stream.Dispose() } catch {}
        try { $connection.Client.Dispose() } catch {}
    }
}

function Test-RconReady {
    try {
        $connection = New-RconConnection -TimeoutMs 4000
        try { return $true }
        finally {
            try { $connection.Stream.Dispose() } catch {}
            try { $connection.Client.Dispose() } catch {}
        }
    } catch {
        return $false
    }
}

function Send-Failure {
    param([string]$Message, [hashtable]$Details = @{})
    if ($script:FailureTelemetrySent) { return }
    $script:FailureTelemetrySent = $true
    Send-RestartTelemetry -Event 'failure' -Message $Message -Details $Details | Out-Null
}

try {
    Write-Log 'Scheduled restart run started.'

    # 11:51 / 23:51 - warn exactly once. A warning failure is recorded but does
    # not itself make a safe save/restart impossible.
    try {
        Send-RconCommand -Code ([byte]0x10) -Arguments 'Game is restarting in 10 minutes' | Out-Null
        Write-Log 'RCON restart warning sent.'
        Send-RestartTelemetry -Event 'warning_sent' -Details @{ text = 'Game is restarting in 10 minutes' } | Out-Null
    } catch {
        Write-Log "RCON restart warning failed: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 590

    # ~12:00:50 - save first. Never stop the game process if save cannot be sent
    # over an authenticated RCON session.
    Send-RestartTelemetry -Event 'save_requested' | Out-Null
    Write-Log 'Sending RCON save command.'
    try {
        Send-RconCommand -Code ([byte]0x50) | Out-Null
        Write-Log 'RCON save command sent over authenticated connection.'
        Send-RestartTelemetry -Event 'save_succeeded' -Details @{ confirmation = 'authenticated_packet_sent' } | Out-Null
    } catch {
        $message = "SAVE FAILED - restart aborted: $($_.Exception.Message)"
        Write-Log $message
        Send-Failure -Message $message -Details @{ stage = 'save' }
        throw $message
    }

    Start-Sleep -Seconds 10

    # ~12:01 - stop only the game process. The existing StartHollowValley
    # watchdog remains responsible for relaunching; this script never starts a
    # second watchdog or duplicate game process.
    $before = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
    if ($before.Count -eq 0) {
        $message = 'Game process was already absent when shutdown was due.'
        Write-Log $message
        Send-Failure -Message $message -Details @{ stage = 'shutdown' }
        throw $message
    }

    Send-RestartTelemetry -Event 'shutdown_requested' -Details @{ processCount = $before.Count } | Out-Null
    $oldPids = @($before | ForEach-Object { $_.Id })
    Write-Log "Stopping $ProcessName PID(s): $($oldPids -join ', ')"
    $before | Stop-Process -Force

    $exitDeadline = (Get-Date).AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        $remaining = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $oldPids -contains $_.Id })
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $exitDeadline)

    if ($remaining.Count -gt 0) {
        $message = 'Old game process did not exit within 45 seconds.'
        Write-Log $message
        Send-Failure -Message $message -Details @{ stage = 'process_exit' }
        throw $message
    }

    Write-Log 'Old game process exited.'
    Send-RestartTelemetry -Event 'process_exited' -Details @{ oldPids = ($oldPids -join ',') } | Out-Null

    # Existing watchdog normally waits roughly 60 seconds before relaunching.
    $startDeadline = (Get-Date).AddSeconds(180)
    $newProcess = $null
    do {
        Start-Sleep -Seconds 2
        $candidate = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $oldPids -notcontains $_.Id } | Select-Object -First 1)
        if ($candidate.Count -gt 0) { $newProcess = $candidate[0] }
    } while ($null -eq $newProcess -and (Get-Date) -lt $startDeadline)

    if ($null -eq $newProcess) {
        $message = 'Watchdog did not relaunch the game process within 180 seconds.'
        Write-Log $message
        Send-Failure -Message $message -Details @{ stage = 'process_start' }
        throw $message
    }

    Write-Log "New game process detected. PID=$($newProcess.Id)"
    Send-RestartTelemetry -Event 'process_started' -Details @{ pid = $newProcess.Id } | Out-Null

    $rconDeadline = (Get-Date).AddSeconds(180)
    $rconReady = $false
    do {
        if (Test-RconReady) {
            $rconReady = $true
            break
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $rconDeadline)

    if (-not $rconReady) {
        $message = 'Game process restarted but RCON did not authenticate within 180 seconds.'
        Write-Log $message
        Send-Failure -Message $message -Details @{ stage = 'rcon_online'; pid = $newProcess.Id }
        throw $message
    }

    Write-Log 'RCON authenticated after restart.'
    Send-RestartTelemetry -Event 'rcon_online' -Details @{ pid = $newProcess.Id } | Out-Null
    Send-RestartTelemetry -Event 'success' -Message 'Save, shutdown, process relaunch and RCON verification all completed.' -Details @{ pid = $newProcess.Id } | Out-Null
    Write-Log 'RESTART RESULT: SUCCESS'
    exit 0
} catch {
    $message = $_.Exception.Message
    Write-Log "RESTART RESULT: FAILURE - $message"
    Send-Failure -Message $message -Details @{ stage = 'unhandled' }
    exit 1
}
