$ErrorActionPreference = "Stop"

$Path = "C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods\BodyDrop\Scripts\main.lua"
$ReloadFlag = "C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods\BodyDrop\Saved\reload.flag"

if (-not (Test-Path $Path)) {
    throw "BodyDrop main.lua not found at $Path"
}

$Text = [System.IO.File]::ReadAllText($Path) -replace "`r`n", "`n"

if ($Text.Contains("FEAST_PUMPKIN_TEST_V1")) {
    Write-Host "Feast Pumpkin test is already installed." -ForegroundColor Yellow
} else {
    $LuaBlock = @'
-- FEAST_PUMPKIN_TEST_V1
-- Test-only: arm one target after a Feast Pumpkin spawn. The first real food or
-- normal-diet nutrient gain within the watch window fills Carb/Protein/Lipid.
local FEAST_FULL_NUTRIENT_VALUE = 9999.0
local FEAST_WATCH_SECONDS = 120
local FEAST_POLL_INTERVAL_MS = 500
local feastWatchers = {}

local function feastReadSnapshot(pawn)
    if pawn == nil then return nil end

    local snap = {}
    pcall(function() snap.food = tonumber(pawn:GetFoodValue()) end)

    local nutr
    pcall(function() nutr = pawn.NutrientsStruct end)
    if nutr ~= nil then
        snap.carb = tonumber(nutr.CarbValue)
        snap.protein = tonumber(nutr.ProteinValue)
        snap.lipid = tonumber(nutr.LipidValue)
    end

    return snap
end

local function feastDetectedGain(previous, current)
    if previous == nil or current == nil then return false, nil end
    local epsilon = 0.01

    if previous.food ~= nil and current.food ~= nil and current.food > previous.food + epsilon then
        return true, "food"
    end
    if previous.carb ~= nil and current.carb ~= nil and current.carb > previous.carb + epsilon then
        return true, "carb"
    end
    if previous.protein ~= nil and current.protein ~= nil and current.protein > previous.protein + epsilon then
        return true, "protein"
    end
    if previous.lipid ~= nil and current.lipid ~= nil and current.lipid > previous.lipid + epsilon then
        return true, "lipid"
    end

    return false, nil
end

local function feastFillNormalNutrients(pawn)
    if pawn == nil then return false, "nil pawn" end

    local nutr
    pcall(function() nutr = pawn.NutrientsStruct end)
    if nutr == nil then return false, "NutrientsStruct unavailable" end

    nutr.CarbValue = FEAST_FULL_NUTRIENT_VALUE
    nutr.ProteinValue = FEAST_FULL_NUTRIENT_VALUE
    nutr.LipidValue = FEAST_FULL_NUTRIENT_VALUE
    nutr.bMalnutrition = false

    local ok, err = pcall(function()
        pawn:SetNutrientsStruct(nutr, true)
    end)
    if not ok then return false, "SetNutrientsStruct failed: " .. tostring(err) end

    pcall(function() pawn:ForceNetUpdate() end)
    return true, nil
end

local function feastNotify(steam, message)
    local gm = findGameMode()
    if gm == nil then return end

    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return end

    local text = message
    if FText ~= nil then
        local ok, value = pcall(function() return FText(message) end)
        if ok and value ~= nil then text = value end
    end

    pcall(function() ctrl:ClientShowNotification(text) end)
end

local function armFeastWatcher(steam)
    local _, err, _, pawn = getPlayerPlacement(steam)
    if pawn == nil then return false, tostring(err or "player has no pawn") end

    local snapshot = feastReadSnapshot(pawn)
    if snapshot == nil then return false, "could not read player food/nutrients" end

    feastWatchers[tostring(steam)] = {
        expires = os.time() + FEAST_WATCH_SECONDS,
        last = snapshot,
    }

    log("FEAST PUMPKIN | armed steam=" .. tostring(steam))
    return true, nil
end

local function clearFeastWatcher(steam)
    feastWatchers[tostring(steam)] = nil
end

local function pollFeastWatchers()
    local now = os.time()

    for steam, watcher in pairs(feastWatchers) do
        if now > (watcher.expires or 0) then
            log("FEAST PUMPKIN | expired steam=" .. tostring(steam))
            feastWatchers[steam] = nil
        else
            local _, _, _, pawn = getPlayerPlacement(steam)
            if pawn ~= nil then
                local current = feastReadSnapshot(pawn)
                local gained, source = feastDetectedGain(watcher.last, current)

                if gained then
                    local ok, err = feastFillNormalNutrients(pawn)
                    if ok then
                        log("FEAST PUMPKIN | AWARDED steam=" .. tostring(steam) .. " trigger=" .. tostring(source))
                        feastNotify(steam, "FEAST PUMPKIN: all 3 nutrients filled!")
                        feastWatchers[steam] = nil
                    else
                        log("FEAST PUMPKIN | award FAILED steam=" .. tostring(steam) .. " error=" .. tostring(err))
                        watcher.last = current
                    end
                elseif current ~= nil then
                    watcher.last = current
                end
            end
        end
    end
end

'@

    $SpawnMarker = "local function spawnCorpse(speciesName, location, growthFraction, forward, playerPawn)`n"
    if (-not $Text.Contains($SpawnMarker)) {
        throw "Could not find spawnCorpse insertion point; no changes written."
    }
    $Text = $Text.Replace($SpawnMarker, $LuaBlock + $SpawnMarker)

    $StatusMarker = '    elseif verb == "status" then' + "`n"
    if (-not $Text.Contains($StatusMarker)) {
        throw "Could not find BodyDrop command insertion point; no changes written."
    }

    $FeastHandler = @'
    elseif verb == "feastpumpkin" then
        local target = tokens[2]
        if target == nil or target == "" then target = steam end
        if target == nil or target == "" then
            return false, "usage: feastpumpkin [targetSteam]"
        end

        local armed, armErr = armFeastWatcher(target)
        if not armed then
            return false, "cannot arm Feast Pumpkin: " .. tostring(armErr)
        end

        -- Reuse the proven standalone-pumpkin probe at normal size. If a loose
        -- fruit class is loaded it spawns directly; otherwise it briefly uses the
        -- verified pumpkin spawner and hides the plant after the fruit appears.
        local spawned, spawnMsg = spawnGiantPumpkinForPlayer(target, 1.0)
        if not spawned then
            clearFeastWatcher(target)
            return false, "Feast Pumpkin spawn failed: " .. tostring(spawnMsg)
        end

        return true, "Feast Pumpkin armed for " .. tostring(target) ..
            "; eat one within 120 seconds to fill Carb + Protein + Lipid"

'@

    $Text = $Text.Replace($StatusMarker, $FeastHandler + $StatusMarker)

    $LoopMarker = "    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()`n"
    if (-not $Text.Contains($LoopMarker)) {
        throw "Could not find BodyDrop poll loop insertion point; no changes written."
    }

    $FeastLoop = @'
    LoopInGameThreadWithDelay(FEAST_POLL_INTERVAL_MS, function()
        safeCall("pollFeastWatchers", pollFeastWatchers)
    end)

'@

    $Text = $Text.Replace($LoopMarker, $FeastLoop + $LoopMarker)
    $Text = $Text.Replace('local MOD_VERSION = "v003.9-pumpkin-test"', 'local MOD_VERSION = "v004.0-feast-pumpkin-test"')

    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Feast Pumpkin test installed." -ForegroundColor Green
}

Set-Content $ReloadFlag "reload" -Encoding ASCII
Start-Sleep -Seconds 3
Write-Host "BodyDrop reload requested." -ForegroundColor Green
Write-Host "Next: run the feastpumpkin test command and enter the target Steam64." -ForegroundColor Cyan
