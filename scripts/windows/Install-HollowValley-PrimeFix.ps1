# Hollow Valley Prime fix installer
# Updates the live UE4SS DinoStorage + CommandBridge scripts and installs
# PrimePersistence. Existing files are backed up before replacement.

[CmdletBinding()]
param(
    [string]$SearchRoot = 'C:\HollowValley'
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$repo = 'https://raw.githubusercontent.com/Goofylagaming/hollow-valley-site/master'

Write-Host 'Locating the live DinoStorage UE4SS mod...'
$dinoCandidates = @(
    Get-ChildItem -LiteralPath $SearchRoot -Filter 'main.lua' -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\DinoStorage\\Scripts\\main\.lua$' }
)

if ($dinoCandidates.Count -eq 0) {
    throw "Could not find DinoStorage\\Scripts\\main.lua under $SearchRoot"
}
if ($dinoCandidates.Count -gt 1) {
    Write-Host 'Multiple DinoStorage installs found:'
    $dinoCandidates.FullName | ForEach-Object { Write-Host " - $_" }
    throw 'More than one DinoStorage install was found. Remove/rename stale copies or pass a narrower -SearchRoot.'
}

$dinoPath = $dinoCandidates[0].FullName
$scriptsDir = Split-Path -Parent $dinoPath
$dinoRoot = Split-Path -Parent $scriptsDir
$modsRoot = Split-Path -Parent $dinoRoot

$commandPath = Join-Path $modsRoot 'CommandBridge\Scripts\main.lua'
$primeRoot = Join-Path $modsRoot 'PrimePersistence'
$primeScripts = Join-Path $primeRoot 'Scripts'
$primePath = Join-Path $primeScripts 'main.lua'
$modsTxt = Join-Path $modsRoot 'mods.txt'

Write-Host "Mods root: $modsRoot"
Write-Host "DinoStorage: $dinoPath"
Write-Host "CommandBridge: $commandPath"
Write-Host "PrimePersistence: $primePath"

if (-not (Test-Path -LiteralPath $commandPath)) {
    throw "CommandBridge was not found at $commandPath"
}

function Backup-File {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (Test-Path -LiteralPath $Path) {
        $backup = "$Path.bak-$stamp"
        Copy-Item -LiteralPath $Path -Destination $backup -Force
        Write-Host "Backed up: $backup"
    }
}

function Download-File {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile
    )
    $parent = Split-Path -Parent $OutFile
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $tmp = "$OutFile.download-$stamp"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $tmp
    if (-not (Test-Path -LiteralPath $tmp) -or (Get-Item -LiteralPath $tmp).Length -lt 100) {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        throw "Download failed or returned an unexpectedly small file: $Url"
    }
    Move-Item -LiteralPath $tmp -Destination $OutFile -Force
}

Backup-File -Path $dinoPath
Backup-File -Path $commandPath
Backup-File -Path $primePath
Backup-File -Path $modsTxt

Write-Host 'Downloading current Hollow Valley server mods...'
Download-File `
    -Url "$repo/server-mods/DinoStorage/Scripts/main.lua" `
    -OutFile $dinoPath
Download-File `
    -Url "$repo/server-mods/CommandBridge/Scripts/main.lua" `
    -OutFile $commandPath
Download-File `
    -Url "$repo/server-mods/PrimePersistence/Scripts/main.lua" `
    -OutFile $primePath

if (Test-Path -LiteralPath $modsTxt) {
    $lines = @(Get-Content -LiteralPath $modsTxt)
    $found = $false
    $updated = foreach ($line in $lines) {
        if ($line -match '^\s*PrimePersistence\s*:') {
            $found = $true
            'PrimePersistence : 1'
        } else {
            $line
        }
    }
    if (-not $found) { $updated += 'PrimePersistence : 1' }
    Set-Content -LiteralPath $modsTxt -Value $updated -Encoding UTF8
    Write-Host 'PrimePersistence enabled in mods.txt.'
} else {
    Write-Warning "mods.txt was not found at $modsTxt. PrimePersistence was installed, but confirm your UE4SS loader enables the new mod."
}

Write-Host ''
Write-Host 'Prime fix files installed successfully.'
Write-Host 'A GAME SERVER RESTART is required before the new Lua code becomes active.'
Write-Host 'After restart, UE4SS.log should contain:'
Write-Host '  [DinoStorage] v008'
Write-Host '  [CommandBridge] ...'
Write-Host '  [PrimePersistence] v001 loaded'
Write-Host ''
Write-Host 'The website Grant Prime button will work after DinoStorage v008 is loaded.'
Write-Host 'PrimePersistence will snapshot completed Prime flags and restore them once after restart when the same dino fingerprint matches.'
