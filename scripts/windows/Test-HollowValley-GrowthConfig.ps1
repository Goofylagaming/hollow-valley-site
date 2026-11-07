# Isolated fixture test: never reads production Game.ini or invokes game processes.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'HollowValley-GrowthConfig.ps1')
function Assert-True($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
    try { & $Action; throw 'Expected rejection did not occur' }
    catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('hv-growth-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
    foreach ($newline in @("`r`n", "`n")) {
        foreach ($bom in @($false, $true)) {
            $ini = Join-Path $fixtureRoot ('game-' + [guid]::NewGuid().ToString('N') + '.ini')
            $original = @('[Other]', 'GrowthMultiplier=77', 'Keep=untouched', '[/Script/TheIsle.TIGameSession]', '; keep this comment', ' GrowthMultiplier = 3', 'OtherKey=yes', '[Last]', 'GrowthMultiplier=88') -join $newline
            [IO.File]::WriteAllText($ini, $original, (New-Object Text.UTF8Encoding($bom)))
            $before = Get-HVGrowthDocument $ini
            $id = [guid]::NewGuid().ToString()
            $result = Set-HVGrowthDocument $ini 5 $before.Hash $id
            $after = Get-HVGrowthDocument $ini
            Assert-True ($after.Value -eq 5) 'Value was not changed to 5'
            Assert-True ($after.Text -ceq $original.Replace(' GrowthMultiplier = 3', 'GrowthMultiplier=5')) 'Unrelated text changed'
            Assert-True ($after.Bom -eq $bom) 'BOM was not preserved'
            Assert-True ((Get-HVGrowthDocument $result.Backup).Hash -ceq $before.Hash) 'Backup did not preserve original bytes'
            Assert-Rejected { Set-HVGrowthDocument $ini 3 $before.Hash ([guid]::NewGuid().ToString()) } 'changed'
            Assert-Rejected { Set-HVGrowthDocument $ini 5 $after.Hash $id } 'already exist'
            $receipt = Join-Path $fixtureRoot ('receipt-' + $id + '.json')
            Write-HVGrowthReceipt $receipt @{ stage='written'; jobId=$id; configHash=$after.Hash; writtenAt='2026-11-07T02:00:00Z' }
            Assert-True ((Get-HVGrowthStatus $ini $receipt $true '2026-11-07T01:00:00Z' $true).state -eq 'pending_restart') 'Pending restart not reported'
            Assert-True ((Get-HVGrowthStatus $ini $receipt $true '2026-11-07T03:00:00Z' $true).state -eq 'restart_observed') 'Restart not observed'
            Assert-True ((Get-HVGrowthStatus $ini $receipt $true '2026-11-07T03:00:00Z' $false).state -eq 'pending_restart') 'RCON readiness ignored'
            Write-HVGrowthReceipt $receipt @{ stage='writing'; jobId=$id }
            Assert-True ((Get-HVGrowthStatus $ini $receipt $true '' $false).state -eq 'needs_inspection') 'Interrupted write was not blocked'
        }
    }
    foreach ($body in @('[/Script/TheIsle.TIGameSession]', "[/Script/TheIsle.TIGameSession]`r`nKeep=yes`r`n[Other]`r`nKey=ok")) {
        $ini = Join-Path $fixtureRoot ([guid]::NewGuid().ToString() + '.ini')
        [IO.File]::WriteAllText($ini, $body)
        $before = Get-HVGrowthDocument $ini
        $null = Set-HVGrowthDocument $ini 5 $before.Hash ([guid]::NewGuid().ToString())
        Assert-True ((Get-HVGrowthDocument $ini).Value -eq 5) 'Missing key was not inserted'
    }
    $bad = Join-Path $fixtureRoot 'bad.ini'
    [IO.File]::WriteAllText($bad, "[/Script/TheIsle.TIGameSession] ; section comment`nGrowthMultiplier=3`n[Other] ; boundary comment`nGrowthMultiplier=77")
    $before = Get-HVGrowthDocument $bad
    $null = Set-HVGrowthDocument $bad 5 $before.Hash ([guid]::NewGuid().ToString())
    Assert-True ((Get-HVGrowthDocument $bad).Text.Contains('GrowthMultiplier=77')) 'Commented section boundary was not preserved'
    [IO.File]::WriteAllText($bad, "[/Script/TheIsle.TIGameSession]`nGrowthMultiplier=2`nGrowthMultiplier=3")
    Assert-Rejected { Get-HVGrowthDocument $bad } 'Duplicate'
    [IO.File]::WriteAllText($bad, "[/Script/TheIsle.TIGameSession]`n[/Script/TheIsle.TIGameSession]")
    Assert-Rejected { Get-HVGrowthDocument $bad } 'exactly one'
    [IO.File]::WriteAllText($bad, "[Other]`nGrowthMultiplier=3")
    Assert-Rejected { Get-HVGrowthDocument $bad } 'exactly one'
    Write-Host 'Growth fixture tests passed (encoding, section isolation, backup, conflict, replay, journal and restart status).'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'hv-growth-test-*') {
        throw 'Refusing to clean unexpected fixture directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
