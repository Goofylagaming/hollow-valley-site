# Hollow Valley scheduled Evrima RCON messages.
# Uses the game's supported announcement opcode (0x10), NOT player/local chat.
# Single-shot process: Windows Task Scheduler controls recurrence.
[CmdletBinding()]
param(
    [ValidateSet('Links', 'Tips')]
    [string]$Mode = 'Links',
    [switch]$Preview,
    [string]$RconHost = '127.0.0.1',
    [int]$RconPort = 8888,
    [string]$RconPasswordFile = 'C:\HollowValley\Secrets\rcon-password.txt',
    [string]$LogPath = 'C:\HollowValley\Logs\rcon-announcements.log',
    [string]$StatePath = 'C:\HollowValley\Logs\rcon-announcements-state.json'
)
$ErrorActionPreference = 'Stop'

# Plain text only: the in-game RCON announcement renderer does not support Markdown.
$linksMessage = 'Our website can be found at: hollowvalleyisle.com | Our Discord can be found at: https://discord.gg/hollowvalley'
$tipMessages = @(
    'Dino School/Tutorials are from 4pm onwards on Fridays (AEST). Join us to learn and practise!',
    'Weekend Events are at 7pm every Saturday (AEST). Join Hollow Valley for the action!',
    'Features: Parking, Live Map with Prime Tracker, Custom Skin Creation, Marketplace, Body Drops, Daily Rewards, Achievements & Quests.'
)

function Write-Log {
    param([string]$Message)
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mode, $Message
    Write-Host $line
    $directory = Split-Path -Parent $LogPath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Read-SecretText {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "RCON password file not found: $Path" }
    $raw = (Get-Content -LiteralPath $Path -Raw).Trim()
    if (-not $raw) { throw 'RCON password file is empty.' }
    try {
        $secure = ConvertTo-SecureString -String $raw
        $credential = New-Object System.Management.Automation.PSCredential('ignored', $secure)
        $plain = $credential.GetNetworkCredential().Password
        if ($plain) { return $plain }
    } catch {
        # Existing plain-text RCON password files are also supported.
    }
    return $raw
}

function Send-EvrimaAnnouncement {
    param([Parameter(Mandatory = $true)][string]$Message)
    if (-not $RconHost -or $RconPort -lt 1 -or $RconPort -gt 65535) {
        throw 'Invalid RCON host or port.'
    }
    if ([System.Text.Encoding]::UTF8.GetByteCount($Message) -gt 240) {
        throw 'RCON announcement exceeds 240 UTF-8 bytes.'
    }
    if ($Message -match '[\x00\r\n]') { throw 'RCON announcement contains invalid line breaks or control characters.' }

    $password = Read-SecretText -Path $RconPasswordFile
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.ConnectAsync($RconHost, $RconPort)
        if (-not $connect.Wait(5000)) { throw 'RCON connection timed out.' }
        # ConnectAsync returns a Task; Wait above completes it. EndConnect is only for BeginConnect.
        $stream = $client.GetStream()
        $stream.ReadTimeout = 5000
        $stream.WriteTimeout = 5000

        [byte[]]$auth = @([byte]0x01) + [Text.Encoding]::UTF8.GetBytes($password) + @([byte]0x00)
        $stream.Write($auth, 0, $auth.Length)
        $stream.Flush()
        [byte[]]$responseBytes = New-Object byte[] 4096
        $read = $stream.Read($responseBytes, 0, $responseBytes.Length)
        $response = [Text.Encoding]::GetEncoding(28591).GetString($responseBytes, 0, $read)
        if ($response -notlike '*Password Accepted*') { throw 'RCON authentication failed.' }

        # Evrima protocol: authenticated EXEC (0x02), ANNOUNCE (0x10), UTF-8 text, NUL.
        [byte[]]$packet = @([byte]0x02, [byte]0x10) + [Text.Encoding]::UTF8.GetBytes($Message) + @([byte]0x00)
        $stream.Write($packet, 0, $packet.Length)
        $stream.Flush()
        # This proves transport/write only, not that the in-game UI displayed it.
        return $true
    } finally {
        try { $client.Dispose() } catch {}
    }
}

$mutex = [System.Threading.Mutex]::new($false, 'Global\HollowValleyRconAnnouncements')
$mutexHeld = $false
try {
    try { $mutexHeld = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) {
        Write-Log 'Skipped: another announcement run is already active.'
        return
    }

    if ($Mode -eq 'Links') {
        $message = $linksMessage
    } else {
        # Stable three-hour slots rotate School -> Events -> Features.
        $slot = [long][math]::Floor([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() / 10800)
        $tipIndex = [int]($slot % $tipMessages.Count)
        $message = $tipMessages[$tipIndex]
    }
    if ([Text.Encoding]::UTF8.GetByteCount($message) -gt 240) {
        throw "Configured $Mode message exceeds the 240-byte limit."
    }
    if ($Preview) {
        Write-Host "PREVIEW ONLY (no RCON connection): $message"
        return
    }

    $directory = Split-Path -Parent $StatePath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $state = @{ Links = $null; Tips = $null }
    if (Test-Path -LiteralPath $StatePath) {
        $stored = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        if ($stored.Links) { $state.Links = [string]$stored.Links }
        if ($stored.Tips) { $state.Tips = [string]$stored.Tips }
    }
    $lastSent = $state[$Mode]
    if ($lastSent) {
        $elapsed = [DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($lastSent)
        if ($elapsed.TotalMinutes -ge 0 -and $elapsed.TotalMinutes -lt 15) {
            Write-Log 'Skipped: a message of this type was sent less than 15 minutes ago.'
            return
        }
    }

    Send-EvrimaAnnouncement -Message $message | Out-Null
    $state[$Mode] = [DateTimeOffset]::UtcNow.ToString('o')
    $state | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    Write-Log "RCON announcement packet sent: $message"
} catch {
    Write-Log "FAILED (announcement not confirmed): $($_.Exception.Message)"
    throw
} finally {
    if ($mutexHeld) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
