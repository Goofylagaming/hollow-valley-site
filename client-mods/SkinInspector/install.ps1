param(
  [Parameter(Mandatory=$true)]
  [string]$Ue4ssRoot
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $Ue4ssRoot "Mods\SkinInspector"

if (-not (Test-Path $Ue4ssRoot)) {
  throw "UE4SS root not found: $Ue4ssRoot"
}

New-Item -ItemType Directory -Force -Path (Join-Path $target "Scripts") | Out-Null
Copy-Item -Force (Join-Path $source "Scripts\main.lua") (Join-Path $target "Scripts\main.lua")
Copy-Item -Force (Join-Path $source "README.md") (Join-Path $target "README.md")

Write-Host "SkinInspector v001 installed to: $target"
Write-Host "Enable SkinInspector in UE4SS, restart EVRIMA, spawn a dinosaur, then press CTRL+ALT+F8."
