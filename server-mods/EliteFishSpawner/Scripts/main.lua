-- EliteFishSpawner v001
-- Hollow Valley / The Isle: Evrima
--
-- Purpose:
--   Double effective Elite Fish spawning without changing global AI settings.
--   Every NATURAL Elite Catfish / Elite Coelacanth spawn schedules one
--   supplemental fish at a location learned from that naturally spawned fish.
--
-- Safety:
--   * Elite fish only. No regular school fish or land AI are touched.
--   * No FindAllOf() actor scans (avoids stale-character wrapper crashes).
--   * Only proven in-water locations from naturally spawned elite fish are used.
--   * Supplemental spawns never schedule another supplemental spawn.
--   * Per-species and total active caps prevent runaway population.
--   * Spawned actor handles are never retained for later method calls.

local MOD_NAME = "EliteFishSpawner"
local MOD_VERSION = "v001"

local CATFISH_CLASS = "/Game/TheIsle/Core/Characters/Fishes/Catfish/BP_Elite_Fish_CatFish.BP_Elite_Fish_CatFish_C"
local COELACANTH_CLASS = "/Game/TheIsle/Core/Characters/Fishes/Coelacanth/BP_Elite_Fish_Coelacanth.BP_Elite_Fish_Coelacanth_C"

local CONFIG = {
    enabled = true,
    spawnMultiplier = 2,          -- 2 = one Hollow Valley bonus per natural spawn
    bonusDelayMs = 30000,         -- give the natural fish time to swim away
    maxActivePerSpecies = 24,     -- hard safety cap
    maxActiveTotal = 40,          -- hard safety cap across both species
    maxAnchorsPerSpecies = 64,
}

local function log(message)
    print(string.format("[%s %s] %s\n", MOD_NAME, MOD_VERSION, tostring(message)))
end

local function safeGetAddress(object)
    if object == nil then return nil end
    local address
    pcall(function() address = object:GetAddress() end)
    if address == nil or address == 0 then return nil end
    return tostring(address)
end

local function unwrap(value)
    if value == nil then return nil end
    local out
    local ok = pcall(function() out = value:get() end)
    if ok and out ~= nil then return out end
    return value
end

local function findGameMode()
    local candidates = {
        "BP_SurvivalGameMode_C",
        "TISurvivalGameMode",
        "TIGameModeBase",
        "GameModeBase",
    }
    for _, name in ipairs(candidates) do
        local gm
        pcall(function() gm = FindFirstOf(name) end)
        if gm ~= nil then return gm end
    end
    return nil
end

local function actorClassName(actor)
    if actor == nil then return nil end

    local full
    pcall(function() full = actor:GetFullName() end)
    if type(full) == "string" then
        if full:find("BP_Elite_Fish_CatFish_C", 1, true) then return "catfish" end
        if full:find("BP_Elite_Fish_Coelacanth_C", 1, true) then return "coelacanth" end
    end

    local className
    pcall(function()
        local cls = actor:GetClass()
        if cls ~= nil then
            local fname = cls:GetFName()
            if fname ~= nil then className = fname:ToString() end
        end
    end)
    className = tostring(className or "")
    if className:find("BP_Elite_Fish_CatFish_C", 1, true) then return "catfish" end
    if className:find("BP_Elite_Fish_Coelacanth_C", 1, true) then return "coelacanth" end
    return nil
end

local function classPathFor(kind)
    if kind == "catfish" then return CATFISH_CLASS end
    if kind == "coelacanth" then return COELACANTH_CLASS end
    return nil
end

local active = { catfish = 0, coelacanth = 0 }
local pending = { catfish = 0, coelacanth = 0 }
local anchors = { catfish = {}, coelacanth = {} }
local anchorCursor = { catfish = 0, coelacanth = 0 }

-- Address bookkeeping exists only for lifecycle accounting. We never call a
-- method later through a stored actor wrapper.
local seenAddress = {}
local supplementalAddress = {}
local supplementalSpawnInProgress = false

local function activeTotal()
    return active.catfish + active.coelacanth
end

local function pendingTotal()
    return pending.catfish + pending.coelacanth
end

local function validLocation(loc)
    return loc ~= nil
        and tonumber(loc.X) ~= nil
        and tonumber(loc.Y) ~= nil
        and tonumber(loc.Z) ~= nil
end

local function copyLocation(loc)
    return { X = tonumber(loc.X), Y = tonumber(loc.Y), Z = tonumber(loc.Z) }
end

local function rememberAnchor(kind, loc)
    if not validLocation(loc) then return end
    local list = anchors[kind]
    if list == nil then return end

    local candidate = copyLocation(loc)

    -- Avoid filling the anchor list with near-identical points from the same
    -- school. 500 Unreal units is small enough to preserve distinct water spots.
    for _, existing in ipairs(list) do
        local dx = candidate.X - existing.X
        local dy = candidate.Y - existing.Y
        local dz = candidate.Z - existing.Z
        if (dx * dx + dy * dy + dz * dz) <= (500 * 500) then return end
    end

    if #list >= CONFIG.maxAnchorsPerSpecies then
        table.remove(list, 1)
    end
    list[#list + 1] = candidate
    log(string.format(
        "Learned %s water anchor #%d at X=%.0f Y=%.0f Z=%.0f",
        kind, #list, candidate.X, candidate.Y, candidate.Z
    ))
end

local function chooseAnchor(kind)
    local list = anchors[kind]
    if list == nil or #list == 0 then return nil end

    anchorCursor[kind] = (anchorCursor[kind] % #list) + 1
    return copyLocation(list[anchorCursor[kind]])
end

local function canQueueBonus(kind)
    if not CONFIG.enabled then return false, "disabled" end
    if active[kind] + pending[kind] >= CONFIG.maxActivePerSpecies then
        return false, "species-cap"
    end
    if activeTotal() + pendingTotal() >= CONFIG.maxActiveTotal then
        return false, "total-cap"
    end
    if #anchors[kind] == 0 then return false, "no-water-anchor" end
    return true, nil
end

local function spawnSupplemental(kind, loc)
    local classPath = classPathFor(kind)
    if classPath == nil or not validLocation(loc) then
        return false, "invalid spawn request"
    end

    local gm = findGameMode()
    if gm == nil then return false, "game mode unavailable" end

    local world
    pcall(function() world = gm:GetWorld() end)
    if world == nil then return false, "world unavailable" end

    local pawnClass
    pcall(function() pawnClass = StaticFindObject(classPath) end)
    if pawnClass == nil then return false, "elite fish class not loaded" end

    local pawn
    local spawnOk, spawnErr

    -- ReceiveBeginPlay normally fires during SpawnActor. The flag prevents that
    -- BeginPlay from being treated as a natural spawn. We also remember the
    -- returned address in case BeginPlay is deferred until after SpawnActor.
    supplementalSpawnInProgress = true
    spawnOk, spawnErr = pcall(function()
        pawn = world:SpawnActor(
            pawnClass,
            { X = loc.X, Y = loc.Y, Z = loc.Z },
            { Pitch = 0, Yaw = math.random(0, 359), Roll = 0 }
        )
    end)
    supplementalSpawnInProgress = false

    if not spawnOk or pawn == nil then
        return false, "SpawnActor failed: " .. tostring(spawnErr)
    end

    local address = safeGetAddress(pawn)
    if address == nil then return false, "SpawnActor returned invalid/null fish" end
    supplementalAddress[address] = true

    -- Fish blueprints own their default AI-controller choice. SpawnDefaultController
    -- is preferable to hardcoding an unverified fish controller class.
    pcall(function() pawn:SpawnDefaultController() end)
    pcall(function() pawn:SetReplicates(true) end)
    pcall(function() pawn:ForceNetUpdate() end)

    -- Do not retain pawn after this function. Gameplay may destroy it later.
    return true, nil
end

local function scheduleBonus(kind)
    local allowed, reason = canQueueBonus(kind)
    if not allowed then
        log(string.format("Skipped %s bonus spawn (%s)", kind, tostring(reason)))
        return
    end

    local loc = chooseAnchor(kind)
    if loc == nil then return end

    pending[kind] = pending[kind] + 1

    if LoopInGameThreadWithDelay == nil then
        pending[kind] = math.max(0, pending[kind] - 1)
        log("LoopInGameThreadWithDelay unavailable; cannot schedule bonus fish")
        return
    end

    local handle
    handle = LoopInGameThreadWithDelay(CONFIG.bonusDelayMs, function()
        if handle ~= nil and CancelDelayedAction ~= nil then
            pcall(function() CancelDelayedAction(handle) end)
        end

        pending[kind] = math.max(0, pending[kind] - 1)

        local allowedNow, reasonNow = canQueueBonus(kind)
        if not allowedNow then
            log(string.format("Cancelled delayed %s bonus spawn (%s)", kind, tostring(reasonNow)))
            return
        end

        local ok, err = spawnSupplemental(kind, loc)
        if ok then
            log(string.format(
                "Spawned Hollow Valley bonus %s at proven water anchor; active=%d/%d total=%d/%d",
                kind,
                active[kind],
                CONFIG.maxActivePerSpecies,
                activeTotal(),
                CONFIG.maxActiveTotal
            ))
        else
            log(string.format("Bonus %s spawn failed: %s", kind, tostring(err)))
        end
    end)
end

local function onEliteBeginPlay(context)
    local actor = unwrap(context)
    local kind = actorClassName(actor)
    if kind == nil then return end

    local address = safeGetAddress(actor)
    if address == nil then return end
    if seenAddress[address] ~= nil then return end

    local loc
    pcall(function() loc = actor:K2_GetActorLocation() end)
    if validLocation(loc) then rememberAnchor(kind, loc) end

    local supplemental = supplementalSpawnInProgress or supplementalAddress[address] == true
    supplementalAddress[address] = supplemental and true or nil
    seenAddress[address] = { kind = kind, supplemental = supplemental }
    active[kind] = active[kind] + 1

    if supplemental then
        log(string.format(
            "Supplemental %s BeginPlay; active %s=%d total=%d",
            kind, kind, active[kind], activeTotal()
        ))
        return
    end

    log(string.format(
        "Natural %s BeginPlay; active %s=%d total=%d",
        kind, kind, active[kind], activeTotal()
    ))

    local bonusCount = math.max(0, math.floor(tonumber(CONFIG.spawnMultiplier) or 1) - 1)
    for _ = 1, bonusCount do
        scheduleBonus(kind)
    end
end

local function onEliteEndPlay(context)
    local actor = unwrap(context)
    local address = safeGetAddress(actor)
    if address == nil then return end

    local state = seenAddress[address]
    if state == nil then return end

    seenAddress[address] = nil
    supplementalAddress[address] = nil

    local kind = state.kind
    if active[kind] ~= nil then
        active[kind] = math.max(0, active[kind] - 1)
        log(string.format(
            "%s EndPlay; active %s=%d total=%d",
            state.supplemental and "Supplemental" or "Natural",
            kind,
            active[kind],
            activeTotal()
        ))
    end
end

local function registerHooks()
    local beginOk, beginErr = pcall(function()
        RegisterHook("/Script/Engine.Actor:ReceiveBeginPlay", onEliteBeginPlay)
    end)
    if not beginOk then
        log("Could not register ReceiveBeginPlay hook: " .. tostring(beginErr))
    end

    local endOk, endErr = pcall(function()
        RegisterHook("/Script/Engine.Actor:ReceiveEndPlay", onEliteEndPlay)
    end)
    if not endOk then
        log("Could not register ReceiveEndPlay hook: " .. tostring(endErr))
    end

    return beginOk and endOk
end

log(string.format(
    "Loading; multiplier=%dx delay=%dms maxPerSpecies=%d maxTotal=%d",
    CONFIG.spawnMultiplier,
    CONFIG.bonusDelayMs,
    CONFIG.maxActivePerSpecies,
    CONFIG.maxActiveTotal
))

if registerHooks() then
    log("Ready. Waiting for natural Elite Fish to learn proven in-water spawn anchors.")
else
    log("Loaded with hook errors; no supplemental fish will be spawned until hooks register successfully.")
end
