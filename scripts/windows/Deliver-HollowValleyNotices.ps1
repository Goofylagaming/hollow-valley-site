# Hollow Valley EventAI notice delivery.
# Copy to C:\HollowValley\Scripts\ after review. This file does not register a task.
# PowerShell 5.1. The presence token is read from -TokenPath and is never logged.
# Each pass tails new CommandBridge prime_request lines, posts them to automation,
# and appends returned notices to the EventAI inbox. Zone notices are collected
# even when there are no new prime requests.

[CmdletBinding()]
param(
    [string]$BaseUrl = 'https://hollow-valley-automation.onrender.com',
    [string]$TokenPath = 'C:\HollowValley\Secrets\presence-feed-token.txt',
    [string]$ResultsPath = 'C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods\CommandBridge\Saved\results.ndjson',
    [string]$InboxPath = 'C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods\EventAI\Saved\inbox.ndjson',
    [string]$StatePath = 'C:\HollowValley\State\notices-tail.json',
    [string]$LogDir = 'C:\HollowValley\Logs',
    [int]$IntervalSeconds = 5,
    [switch]$Once,
    [switch]$DryRun,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
if ($IntervalSeconds -lt 1) { $IntervalSeconds = 5 }
if ($IntervalSeconds -gt 60) { $IntervalSeconds = 60 }
$script:Dry = [bool]($DryRun -or $WhatIf)
$script:Token = $null

function Write-NoticeLog {
    param([string]$Message)
    if ($script:Token -and $Message -and $Message.Contains($script:Token)) {
        $Message = $Message.Replace($script:Token, '[redacted]')
    }
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    try {
        if (-not (Test-Path -LiteralPath $LogDir)) {
            New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
        }
        $logPath = Join-Path $LogDir ('notices-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))
        $encoding = New-Object System.Text.UTF8Encoding $false
        $stream = New-Object System.IO.StreamWriter($logPath, $true, $encoding)
        try { $stream.WriteLine($line) } finally { $stream.Close() }
    } catch {
        Write-Warning 'Could not write the notice log.'
    }
}

function Read-SecretText {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $raw = (Get-Content -LiteralPath $Path -Raw)
    if ($null -eq $raw) { return $null }
    $raw = $raw.Trim()
    if (-not $raw) { return $null }
    try {
        $secure = ConvertTo-SecureString -String $raw
        $credential = New-Object System.Management.Automation.PSCredential('ignored', $secure)
        $plain = $credential.GetNetworkCredential().Password
        if ($plain) { return $plain.Trim() }
    } catch {}
    return $raw
}

function Get-JsonString {
    param([string]$Value)
    if ($null -eq $Value) { return '""' }
    $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    return '"' + $escaped + '"'
}

function Get-SafeNoticeText {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $builder = New-Object System.Text.StringBuilder
    foreach ($char in $Text.ToCharArray()) {
        $code = [int]$char
        if ($code -lt 32 -or $code -eq 127 -or $char -eq '"' -or $char -eq '\') {
            [void]$builder.Append(' ')
        } else {
            [void]$builder.Append($char)
        }
    }
    $clean = ([regex]::Replace($builder.ToString(), '\s+', ' ')).Trim()
    if ($clean.Length -gt 200) { $clean = $clean.Substring(0, 200).Trim() }
    return $clean
}

function Read-TailState {
    if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
    try {
        $parsed = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        $offset = [int64]$parsed.offset
        if ($offset -lt 0) { return [int64]0 }
        return $offset
    } catch {
        Write-NoticeLog 'State file was unreadable. The next pass starts at the end of the results file.'
        return $null
    }
}

function Save-TailState {
    param([int64]$Offset)
    $directory = Split-Path -Parent $StatePath
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($StatePath, ('{"offset":' + $Offset + '}'), $encoding)
}

function Read-ResultChunk {
    param([int64]$Offset)
    $empty = @{ Text = ''; NextOffset = $Offset; Reset = $false; Missing = $false }
    if (-not (Test-Path -LiteralPath $ResultsPath)) {
        $empty.Missing = $true
        return $empty
    }
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($ResultsPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $length = [int64]$stream.Length
        $start = $Offset
        $reset = $false
        if ($length -lt $start) {
            $start = 0
            $reset = $true
        }
        if ($length -eq $start) {
            return @{ Text = ''; NextOffset = $start; Reset = $reset; Missing = $false }
        }
        $available = [int64]($length - $start)
        $toRead = $available
        if ($toRead -gt 262144) { $toRead = 262144 }
        $buffer = New-Object byte[] ([int]$toRead)
        $stream.Position = $start
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) {
            return @{ Text = ''; NextOffset = $start; Reset = $reset; Missing = $false }
        }
        $lastNewline = -1
        for ($index = $read - 1; $index -ge 0; $index--) {
            if ($buffer[$index] -eq 10) { $lastNewline = $index; break }
        }
        if ($lastNewline -lt 0) {
            return @{ Text = ''; NextOffset = $start; Reset = $reset; Missing = $false }
        }
        $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $lastNewline + 1)
        return @{ Text = $text; NextOffset = ($start + $lastNewline + 1); Reset = $reset; Missing = $false }
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Get-PrimeRequests {
    param([string]$Text)
    $requests = @()
    if ([string]::IsNullOrEmpty($Text)) { return $requests }
    foreach ($line in ($Text -split "`n")) {
        $trimmed = $line.TrimEnd("`r").Trim()
        if (-not $trimmed) { continue }
        if ($trimmed -notmatch '"verb"\s*:\s*"prime_request"') { continue }
        try { $item = $trimmed | ConvertFrom-Json } catch { continue }
        if ([string]$item.verb -ne 'prime_request') { continue }
        if ($item.PSObject.Properties.Name -contains 'ok' -and $item.ok -ne $true) { continue }
        $steam = [string]$item.steam
        $id = [string]$item.id
        if ($steam -notmatch '^\d{17}$') { continue }
        if ([string]::IsNullOrWhiteSpace($id) -or $id.Length -gt 120) { continue }
        if ($id -match '["\\\x00-\x1F\x7F]') { continue }
        $ts = 0
        if ($null -ne $item.ts) {
            $parsed = 0L
            if ([int64]::TryParse([string]$item.ts, [ref]$parsed)) { $ts = $parsed }
        }
        $requests += @{ id = $id; steam = $steam; ts = $ts }
    }
    return ,$requests
}

function Get-RequestBody {
    param($Requests)
    $items = @()
    foreach ($request in @($Requests)) {
        if (-not $request) { continue }
        $items += ('{{"id":{0},"steam":{1},"ts":{2}}}' -f (Get-JsonString $request.id), (Get-JsonString $request.steam), ([int64]$request.ts))
    }
    return '{"primeRequests":[' + ($items -join ',') + ']}'
}

function Add-InboxLine {
    param([string]$Line)
    $directory = Split-Path -Parent $InboxPath
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding $false
    $stream = New-Object System.IO.StreamWriter($InboxPath, $true, $encoding)
    try { $stream.Write($Line + "`n") } finally { $stream.Close() }
}

function Write-EventAiNotice {
    param($Notice)
    $id = [string]$Notice.id
    $steam = [string]$Notice.steam
    $text = Get-SafeNoticeText ([string]$Notice.text)
    if ($id -notmatch '^[A-Za-z0-9_.:-]{8,80}$') { return $false }
    if ($steam -notmatch '^\d{17}$') { return $false }
    if ([string]::IsNullOrWhiteSpace($text)) { return $false }
    $epoch = New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)
    $unix = [int64]([math]::Floor(([DateTime]::UtcNow - $epoch).TotalSeconds))
    $line = '{{"id":"{0}","ts":{1},"steam":"{2}","args":["notify","{2}","{3}"]}}' -f $id, $unix, $steam, $text
    if ($script:Dry) {
        Write-NoticeLog ('DRY-RUN inbox ' + $line)
        return $true
    }
    Add-InboxLine -Line $line
    return $true
}

function Invoke-NoticePass {
    $saved = Read-TailState
    $offset = [int64]0
    $haveFile = Test-Path -LiteralPath $ResultsPath
    if ($null -eq $saved) {
        if ($haveFile) {
            $probe = [System.IO.File]::Open($ResultsPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try { $offset = [int64]$probe.Length } finally { $probe.Dispose() }
            Write-NoticeLog ("No state file. Starting at end of results ({0}). Historical lines are not replayed." -f $offset)
            if (-not $script:Dry) { Save-TailState -Offset $offset }
        } else {
            Write-NoticeLog 'Results file is not present yet.'
        }
    } else {
        $offset = [int64]$saved
    }

    $chunk = @{ Text = ''; NextOffset = $offset; Reset = $false; Missing = (-not $haveFile) }
    if ($haveFile) { $chunk = Read-ResultChunk -Offset $offset }
    if ($chunk.Reset) { Write-NoticeLog 'Results file shrank. Tail offset was reset.' }
    $requests = @(Get-PrimeRequests -Text $chunk.Text)
    $body = Get-RequestBody -Requests $requests
    $endpoint = ($BaseUrl.TrimEnd('/')) + '/api/presence-feed/notices'

    if ($script:Dry) {
        Write-NoticeLog ("DRY-RUN would POST {0} prime request(s) to {1}" -f $requests.Count, $endpoint)
        foreach ($request in $requests) {
            Write-NoticeLog ("DRY-RUN prime id={0} steam={1}" -f $request.id, $request.steam)
        }
        Write-NoticeLog 'DRY-RUN did not contact automation, write the inbox, or advance the saved offset.'
        return
    }

    if ([string]::IsNullOrWhiteSpace($script:Token)) {
        $script:Token = Read-SecretText -Path $TokenPath
    }
    if ([string]::IsNullOrWhiteSpace($script:Token)) {
        Write-NoticeLog 'Presence token file is missing or empty. No request was sent.'
        return
    }

    $headers = @{ Authorization = ('Bearer ' + $script:Token) }
    try {
        $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 20
    } catch {
        $status = ''
        if ($_.Exception.Response) { $status = [string]$_.Exception.Response.StatusCode }
        Write-NoticeLog ("POST failed status={0}" -f $status)
        return
    }

    if ($haveFile) { Save-TailState -Offset ([int64]$chunk.NextOffset) }

    $delivered = 0
    $noticeCount = 0
    if ($response -and $response.notices) {
        foreach ($notice in @($response.notices)) {
            if (-not $notice) { continue }
            $noticeCount++
            try {
                if (Write-EventAiNotice -Notice $notice) { $delivered++ }
            } catch {
                Write-NoticeLog 'Inbox write failed for one notice.'
            }
        }
    }
    Write-NoticeLog ("primeRequests={0} notices={1} inbox={2}" -f $requests.Count, $noticeCount, $delivered)
}

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

do {
    try {
        Invoke-NoticePass
    } catch {
        Write-NoticeLog ('Pass failed: ' + $_.Exception.Message)
        if ($Once) { exit 1 }
    }
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
