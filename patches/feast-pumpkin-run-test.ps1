$ErrorActionPreference = "Stop"

$Mods = "C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods"
$BodyDrop = Join-Path $Mods "BodyDrop"
$Inbox = Join-Path $BodyDrop "Saved\inbox.ndjson"
$Results = Join-Path $Mods "CommandBridge\Saved\results.ndjson"

$SteamId = (Read-Host "Enter your Steam64 ID").Trim()
if ($SteamId -notmatch '^\d{17}$') {
    throw "Steam64 must be exactly 17 digits."
}

$RequestId = "feastpumpkin_" + (Get-Date -Format "yyyyMMddHHmmss")
$Command = [ordered]@{
    id    = $RequestId
    ts    = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    steam = $SteamId
    args  = @("feastpumpkin", $SteamId)
}

$Json = $Command | ConvertTo-Json -Compress
[System.IO.File]::AppendAllText($Inbox, $Json + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Feast Pumpkin queued: $RequestId" -ForegroundColor Green
Write-Host "Stay spawned in-game. A normal standalone edible pumpkin should appear in front of you." -ForegroundColor Cyan
Write-Host "Eat it within 120 seconds. On the first detected bite/food gain, Carb + Protein + Lipid should fill." -ForegroundColor Cyan

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "=== BODYDROP RESULT ==="
if (Test-Path $Results) {
    Select-String -Path $Results -Pattern $RequestId | Select-Object -Last 1
} else {
    Write-Host "results.ndjson not found at $Results" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Expected in-game notification after eating:" -ForegroundColor Yellow
Write-Host "FEAST PUMPKIN: all 3 nutrients filled!"
