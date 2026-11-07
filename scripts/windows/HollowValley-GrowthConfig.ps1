# Fixed-purpose configuration helpers. No RCON commands, process stops or restarts.
# Loaded by the outbound management agent; file paths never come from a web request.

function Assert-HVGrowthRegularPath {
    param([string]$Path)
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Growth configuration paths must not contain links or junctions.'
            }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-HVGrowthDocument {
    param([string]$Path)
    Assert-HVGrowthRegularPath $Path
    [byte[]]$bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -gt 1048576) { throw 'Game.ini is unexpectedly large.' }
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
    $offset = if ($bom) { 3 } else { 0 }
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $text = $utf8.GetString($bytes, $offset, $bytes.Length - $offset)
    if ($text.Contains([string][char]0)) { throw 'Game.ini must be UTF-8, not UTF-16.' }
    $sections = [regex]::Matches($text, '(?m)^[ \t]*\[[^\r\n\]]+\][^\r\n]*\r?$')
    $matches = @($sections | Where-Object { $_.Value -imatch '^[ \t]*\[/Script/TheIsle\.TIGameSession\][ \t]*(?:[;#][^\r\n]*)?\r?$' })
    if ($matches.Count -ne 1) { throw 'Expected exactly one TIGameSession section.' }
    $section = $matches[0]
    $end = $text.Length
    foreach ($item in $sections) { if ($item.Index -gt $section.Index) { $end = $item.Index; break } }
    $body = $text.Substring($section.Index, $end - $section.Index)
    $settings = [regex]::Matches($body, '(?im)^[ \t]*GrowthMultiplier[ \t]*=[^\r\n]*')
    if ($settings.Count -gt 1) { throw 'Duplicate GrowthMultiplier settings require manual inspection.' }
    $value = $null
    if ($settings.Count -eq 1) {
        $raw = ($settings[0].Value -split '=', 2)[1].Trim()
        if ($raw -notmatch '^\d+(\.\d+)?$') { throw 'GrowthMultiplier has an unsupported value.' }
        $value = [double]::Parse($raw, [Globalization.CultureInfo]::InvariantCulture)
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return @{ Text = $text; Bytes = $bytes; Bom = $bom; Hash = $hash; Value = $value; Section = $section; Setting = $(if ($settings.Count) { $settings[0] } else { $null }) }
}

function Set-HVGrowthDocument {
    param([string]$Path, [int]$Multiplier, [string]$ExpectedHash, [string]$JobId)
    if ($Multiplier -notin @(1,2,3,4,5,10) -or $JobId -notmatch '^[a-f0-9-]{36}$' -or $ExpectedHash -notmatch '^[a-f0-9]{64}$') {
        throw 'Invalid bounded growth configuration job.'
    }
    $document = Get-HVGrowthDocument $Path
    if ($document.Hash -cne $ExpectedHash) { throw 'Game.ini changed since review; no write performed.' }
    $text = $document.Text
    if ($null -ne $document.Setting) {
        $start = $document.Section.Index + $document.Setting.Index
        $text = $text.Substring(0, $start) + "GrowthMultiplier=$Multiplier" + $text.Substring($start + $document.Setting.Length)
    } else {
        $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
        $start = $document.Section.Index + $document.Section.Length
        # Section matches include CR but not LF. Insert after the complete header line.
        if ($start -lt $text.Length -and $text[$start] -eq "`n") { $start++ }
        elseif ($start -eq $text.Length) { $text += $newline; $start = $text.Length }
        $text = $text.Substring(0, $start) + "GrowthMultiplier=$Multiplier$newline" + $text.Substring($start)
    }
    $temporary = "$Path.growth-$JobId.tmp"
    $backup = "$Path.growth-$JobId.bak"
    if ((Test-Path -LiteralPath $temporary) -or (Test-Path -LiteralPath $backup)) { throw 'Growth job files already exist; do not replay.' }
    $utf8 = New-Object Text.UTF8Encoding([bool]$document.Bom)
    try {
        [IO.File]::WriteAllText($temporary, $text, $utf8)
        if ((Get-HVGrowthDocument $temporary).Value -ne $Multiplier) { throw 'Prepared configuration failed validation.' }
        if ((Get-HVGrowthDocument $Path).Hash -cne $ExpectedHash) { throw 'Game.ini changed while preparing the write.' }
        # Replace atomically on the same volume, retaining the exact previous bytes as backup.
        [IO.File]::Replace($temporary, $Path, $backup)
        $verified = Get-HVGrowthDocument $Path
        if ($verified.Value -ne $Multiplier) { throw 'Configuration read-back failed; inspect backup before retrying.' }
        return @{ Hash = $verified.Hash; Backup = $backup }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Write-HVGrowthReceipt {
    param([string]$Path, [hashtable]$Receipt)
    Assert-HVGrowthRegularPath $Path
    $temporary = "$Path.tmp"
    Assert-HVGrowthRegularPath $temporary
    [IO.File]::WriteAllText($temporary, (ConvertTo-Json $Receipt -Depth 4 -Compress), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) {
        Assert-HVGrowthRegularPath "$Path.previous"
        [IO.File]::Replace($temporary, $Path, "$Path.previous")
    }
    else { [IO.File]::Move($temporary, $Path) }
}

function Get-HVGrowthStatus {
    param([string]$Path, [string]$ReceiptPath, [bool]$WritesEnabled, [string]$StartedAt, [bool]$RconReady)
    try {
        $document = Get-HVGrowthDocument $Path
        $state = 'unverified'
        $jobId = $null
        $message = 'Configuration read from disk. Running gameplay rate has not been verified.'
        Assert-HVGrowthRegularPath $ReceiptPath
        if (Test-Path -LiteralPath $ReceiptPath) {
            $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
            $jobId = $receipt.jobId
            if ($receipt.stage -ne 'written' -or $receipt.configHash -cne $document.Hash) {
                $state = 'needs_inspection'
                $message = 'The last write or current file differs from the recorded result. Inspect before retrying.'
            } else {
                $state = 'pending_restart'
                $message = 'Saved and verified on disk; awaiting a subsequent game restart.'
                if ($StartedAt -and $RconReady -and ([datetimeoffset]$StartedAt) -gt ([datetimeoffset]$receipt.writtenAt)) {
                    $state = 'restart_observed'
                    $message = 'A later game start and RCON listener were observed; configuration still matches. Gameplay rate is not independently verified.'
                }
            }
        }
        return @{ supported = $true; writesEnabled = $WritesEnabled; configuredMultiplier = $document.Value;
            configHash = $document.Hash; state = $state; jobId = $jobId; message = $message }
    } catch {
        return @{ supported = $true; writesEnabled = $false; configuredMultiplier = $null;
            configHash = $null; state = 'needs_inspection'; message = 'Could not safely inspect Game.ini or the last write receipt.' }
    }
}
