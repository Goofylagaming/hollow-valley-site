# Stage HollowValleyCore's reconstructed main.lua while keeping it disabled.
# Intended for Windows PowerShell 5.1 on the Hollow Valley game host.
$ErrorActionPreference = "Stop"

$mods = "C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods"
$target = Join-Path $mods "HollowValleyCore"
$targetLua = Join-Path $target "Scripts\main.lua"
$sourceLua = Join-Path $PSScriptRoot "Scripts\main.lua"
$modsTxt = Join-Path $mods "mods.txt"

if (-not (Test-Path -LiteralPath $sourceLua -PathType Leaf)) { throw "Missing source: $sourceLua" }
if (-not (Test-Path -LiteralPath $modsTxt -PathType Leaf)) { throw "Missing mods.txt: $modsTxt" }
$entries = @(Get-Content -LiteralPath $modsTxt)
if (@($entries | Where-Object { $_ -match '^\s*HollowValleyCore\s*:\s*1\s*$' }).Count -gt 0) {
    throw "HollowValleyCore is enabled. Refusing to overwrite a running mod."
}
if (@($entries | Where-Object { $_ -match '^\s*HollowValleyCore\s*:\s*0\s*$' }).Count -ne 1) {
    throw "Expected exactly one disabled entry 'HollowValleyCore : 0'. Nothing changed."
}

$backupRoot = "C:\HollowValley\Backups"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$backup = Join-Path $backupRoot ("HollowValleyCore-before-recovery-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
if (Test-Path -LiteralPath $target -PathType Container) {
    Copy-Item -LiteralPath $target -Destination $backup -Recurse -Force
    Write-Host "Backup created: $backup"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetLua) | Out-Null
Copy-Item -LiteralPath $sourceLua -Destination $targetLua -Force
Write-Host "Staged: $targetLua"
Write-Host "HollowValleyCore remains DISABLED in mods.txt. No restart performed."
Write-Host "Installed marker:"
Get-Content -LiteralPath $targetLua -TotalCount 2
