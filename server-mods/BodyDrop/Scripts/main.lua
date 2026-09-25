-- BodyDrop v003.6
-- Admin-only corpse spawner. Bodies are only dropped when explicitly requested.
-- IPC: bodydrop commands routed from CommandBridge.

local MOD_NAME    = "BodyDrop"
local MOD_VERSION = "v003.6"

local function resolveModRoot()
    local source = debug.getinfo(1, "S").source or ""
    if source:sub(1, 1) == "@" then source = source:sub(2) end
    source = source:gsub("\\", "/")
    return source:match("^(.*)/Scripts/[^/]+$")
end

local MOD_ROOT = assert(resolveModRoot(), "BodyDrop cannot resolve its Scripts directory")
local MODS_ROOT = assert(MOD_ROOT:match("^(.*)/[^/]+$"), "BodyDrop cannot resolve Mods directory")
local SAVED_DIR    = MOD_ROOT .. "/Saved"
local INBOX_PATH   = SAVED_DIR .. "/inbox.ndjson"
local RELOAD_FLAG  = SAVED_DIR .. "/reload.flag"
local RESULTS_FILE = MODS_ROOT .. "/CommandBridge/Saved/results.ndjson"
local REQUESTS_DIR = SAVED_DIR .. "/requests"

local POLL_INTERVAL_MS = 2000

local function log(msg)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(msg)))
end

local SPECIES_PATHS = {
    Tyrannosaurus      = "/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C",
    Triceratops        = "/Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C",
    Allosaurus         = "/Game/TheIsle/Core/Characters/Dinosaurs/Allosaurus/BP_Allosaurus.BP_Allosaurus_C",
    Stegosaurus        = "/Game/TheIsle/Core/Characters/Dinosaurs/Stegosaurus/BP_Stegosaurus.BP_Stegosaurus_C",
    Carnotaurus        = "/Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C",
    Ceratosaurus       = "/Game/TheIsle/Core/Characters/Dinosaurs/Ceratosaurus/BP_Ceratosaurus.BP_Ceratosaurus_C",
    Deinosuchus        = "/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C",
    Diabloceratops     = "/Game/TheIsle/Core/Characters/Dinosaurs/Diabloceratops/BP_Diabloceratops.BP_Diabloceratops_C",
    Dilophosaurus      = "/Game/TheIsle/Core/Characters/Dinosaurs/Dilophosaurus/BP_Dilophosaurus.BP_Dilophosaurus_C",
    Dryosaurus         = "/Game/TheIsle/Core/Characters/Dinosaurs/Dryosaurus/BP_Dryosaurus.BP_Dryosaurus_C",
    Gallimimus         = "/Game/TheIsle/Core/Characters/Dinosaurs/Gallimimus/BP_Gallimimus.BP_Gallimimus_C",
    Herrerasaurus      = "/Game/TheIsle/Core/Characters/Dinosaurs/Herrerasaurus/BP_Herrerasaurus.BP_Herrerasaurus_C",
    Hypsilophodon      = "/Game/TheIsle/Core/Characters/Dinosaurs/Hypsilophodon/BP_Hypsilophodon.BP_Hypsilophodon_C",
    Maiasaura          = "/Game/TheIsle/Core/Characters/Dinosaurs/Maiasaura/BP_Maiasaura.BP_Maiasaura_C",
    Omniraptor         = "/Game/TheIsle/Core/Characters/Dinosaurs/Omniraptor/BP_Omniraptor.BP_Omniraptor_C",
    Pachycephalosaurus = "/Game/TheIsle/Core/Characters/Dinosaurs/Pachycephalosaurus/BP_Pachycephalosaurus.BP_Pachycephalosaurus_C",
    Pteranodon         = "/Game/TheIsle/Core/Characters/Dinosaurs/Pteranodon/BP_Pteranodon.BP_Pteranodon_C",
    Tenontosaurus      = "/Game/TheIsle/Core/Characters/Dinosaurs/Tenontosaurus/BP_Tenontosaurus.BP_Tenontosaurus_C",
    Troodon            = "/Game/TheIsle/Core/Characters/Dinosaurs/Troodon/BP_Troodon.BP_Troodon_C",
    Beipiaosaurus      = "/Game/TheIsle/Core/Characters/Dinosaurs/Beipiaosaurus/BP_Beipiaosaurus.BP_Beipiaosaurus_C",
    Compsognathus      = "/Game/TheIsle/Core/Characters/Dinosaurs/Compsognathus/BP_Compsognathus.BP_Compsognathus_C",
    Kentrosaurus       = "/Game/TheIsle/Core/Characters/Dinosaurs/Kentrosaurus/BP_Kentrosaurus.BP_Kentrosaurus_C",
    Austroraptor       = "/Game/TheIsle/Core/Characters/Dinosaurs/Austroraptor/BP_Austroraptor.BP_Austroraptor_C",
}

-- Small, verified whitelist for the herbivore plant-spawn probe.
-- These are documented EVRIMA edible plant interactables.
local PLANT_PATHS = {
    fern = "/Game/TheIsle/Core/Foliage/Plants/BP_Fern.BP_Fern_C",
    cycad = "/Game/TheIsle/Core/Foliage/Plants/BP_Cycad.BP_Cycad_C",
    mushroom = "/Game/TheIsle/Core/Foliage/Plants/BP_Mushroom_Edible.BP_Mushroom_Edible_C",
}

local function fileExists(path)
    local f = io.open(path, "rb")
    if f == nil then return false end
    f:close()
    return true
end

local function readAll(path)
    local f = io.open(path, "rb")
    if f == nil then return nil end
    local body = f:read("*a")
    f:close()
    return body
end

local function appendLine(path, line)
    local f = io.open(path, "ab")
    if f == nil then return false end
    local wrote = f:write(line .. "\n")
    local closed = f:close()
    return wrote ~= nil and closed ~= nil
end

local function consumeFlag(path)
    local f = io.open(path, "rb")
    if f == nil then return nil end
    local body = f:read("*all") or ""
    f:close()
    os.remove(path)
    body = body:gsub("^%s+", ""):gsub("%s+$", "")
    return body ~= "" and body or nil
end

local function ensureDir(path)
    local winPath = path:gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
end

local function jsonEscape(s)
    if s == nil then return "" end
    s = tostring(s)
    s = s:gsub("\\", "\\\\")
        :gsub('"', '\\"')
        :gsub("\n", "\\n")
        :gsub("\r", "\\r")
        :gsub("\t", "\\t")
    return s
end

local function jsonReadString(body, key)
    return string.match(body or "", '"' .. key .. '"%s*:%s*"([^"]*)"')
end

local function findGameMode()
    local candidates = {
        "BP_SurvivalGameMode_C",
        "TISurvivalGameMode",
        "TIGameModeBase",
        "GameModeBase"
    }

    for _, name in ipairs(candidates) do
        local gm
        pcall(function() gm = FindFirstOf(name) end)
        if gm ~= nil then return gm end
    end

    return nil
end

local function getPlayerPlacement(steam)
    if steam == nil or steam == "" then return nil, "no steam id" end

    local gm = findGameMode()
    if gm == nil then return nil, "no game mode" end

    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return nil, "player not found or not online" end

    local pawn
    pcall(function() pawn = ctrl:K2_GetPawn() end)
    if pawn == nil then return nil, "player has no pawn (not spawned)" end

    local loc
    pcall(function() loc = pawn:K2_GetActorLocation() end)
    if loc == nil then return nil, "could not read pawn location" end

    local forward = { X = 1, Y = 0, Z = 0 }
    pcall(function()
        local value = pawn:GetActorForwardVector()
        if value ~= nil and tonumber(value.X) ~= nil and tonumber(value.Y) ~= nil then
            local length = math.sqrt((value.X * value.X) + (value.Y * value.Y))
            if length > 0.001 then
                forward = { X = value.X / length, Y = value.Y / length, Z = 0 }
            end
        end
    end)

    return loc, nil, forward, pawn
end

local function buildSpawnOffsets(forward)
    local fx = tonumber(forward and forward.X) or 1
    local fy = tonumber(forward and forward.Y) or 0
    local rightX = -fy
    local rightY = fx

    return {
        { fx * 300, fy * 300 },
        { fx * 500, fy * 500 },
        { (fx * 300) + (rightX * 200), (fy * 300) + (rightY * 200) },
        { (fx * 300) - (rightX * 200), (fy * 300) - (rightY * 200) },
        { (fx * 450) + (rightX * 300), (fy * 450) + (rightY * 300) },
        { (fx * 450) - (rightX * 300), (fy * 450) - (rightY * 300) },
    }
end

local function tryPawnCall(label, fn)
    local ok, result = pcall(fn)
    if ok then
        log(string.format("BODYDROP DIAG | %s | OK | result=%s", tostring(label), tostring(result)))
        return true, result
    end

    log(string.format("BODYDROP DIAG | %s | FAILED | error=%s", tostring(label), tostring(result)))
    return false, result
end

local kismetSystemLibrary = nil

local function getKismetSystemLibrary()
    if kismetSystemLibrary ~= nil then return kismetSystemLibrary end

    local ok, obj = pcall(function()
        return StaticFindObject("/Script/Engine.Default__KismetSystemLibrary")
    end)

    if not ok or obj == nil then
        return nil, "StaticFindObject Default__KismetSystemLibrary failed: " .. tostring(obj)
    end

    local valid = true
    pcall(function()
        if obj.IsValid ~= nil then valid = obj:IsValid() end
    end)

    if valid == false then return nil, "Default__KismetSystemLibrary is invalid" end

    kismetSystemLibrary = obj
    return obj, nil
end

local function traceGround(worldContext, x, y, anchorZ, actorToIgnore)
    local systemLibrary, libErr = getKismetSystemLibrary()
    if systemLibrary == nil then return nil, libErr end

    local baseZ = tonumber(anchorZ) or 0
    local traceStart = { X = x, Y = y, Z = baseZ + 100000 }
    local traceEnd = { X = x, Y = y, Z = baseZ - 100000 }
    local hitResult = {}
    local actorsToIgnore = {}
    if actorToIgnore ~= nil then actorsToIgnore[1] = actorToIgnore end
    local clearColor = { R = 0, G = 0, B = 0, A = 0 }
    local wasHit = false

    local traceOk, traceErr = pcall(function()
        wasHit = systemLibrary:LineTraceSingle(
            worldContext,
            traceStart,
            traceEnd,
            0,
            false,
            actorsToIgnore,
            0,
            hitResult,
            true,
            clearColor,
            clearColor,
            0.0
        )
    end)

    if not traceOk then return nil, "ground trace call failed: " .. tostring(traceErr) end
    if not wasHit then return nil, "ground trace found no blocking surface" end

    local hitLocation = hitResult.Location or hitResult.ImpactPoint
    local z = hitLocation and tonumber(hitLocation.Z) or nil
    if z == nil then return nil, "ground trace returned no hit Z" end

    return z, nil
end

local function spawnPlantForPlayer(plantKey, steam)
    local key = tostring(plantKey or ""):lower()
    local classPath = PLANT_PATHS[key]
    if classPath == nil then
        return false, "unknown plant; allowed: fern, cycad, mushroom"
    end

    local location, err, forward, playerPawn = getPlayerPlacement(steam)
    if location == nil then
        return false, "cannot locate target: " .. tostring(err)
    end

    local plantCls
    pcall(function() plantCls = StaticFindObject(classPath) end)
    if plantCls == nil then
        return false, "plant class not found: " .. classPath
    end

    local gm = findGameMode()
    if gm == nil then return false, "no game mode" end

    local world
    pcall(function() world = gm:GetWorld() end)
    if world == nil then return false, "no world" end

    local spawnOffsets = buildSpawnOffsets(forward)
    local lastError = nil

    for i, offset in ipairs(spawnOffsets) do
        local x = (tonumber(location.X) or 0) + offset[1]
        local y = (tonumber(location.Y) or 0) + offset[2]
        local groundZ, groundErr = traceGround(gm, x, y, location.Z, playerPawn)

        if groundZ == nil then
            lastError = groundErr
            log(string.format("PLANT PROBE | ground trace | attempt=%d | FAILED | %s", i, tostring(groundErr)))
        else
            local loc = { X = x, Y = y, Z = groundZ + 10 }
            local actor
            local spawnOk, spawnErr = pcall(function()
                actor = world:SpawnActor(
                    plantCls,
                    loc,
                    { Pitch = 0, Yaw = 0, Roll = 0 }
                )
            end)

            if not spawnOk then
                lastError = "SpawnActor failed: " .. tostring(spawnErr)
                log("PLANT PROBE | SpawnActor | FAILED | " .. tostring(spawnErr))
            else
                local addr
                if actor ~= nil then
                    pcall(function() addr = actor:GetAddress() end)
                end

                if actor == nil or addr == nil or addr == 0 then
                    lastError = "SpawnActor returned invalid/null actor"
                    log("PLANT PROBE | SpawnActor | FAILED | invalid/null actor")
                else
                    local replicateOk = tryPawnCall("Plant SetReplicates", function()
                        actor:SetReplicates(true)
                    end)
                    local updateOk = tryPawnCall("Plant ForceNetUpdate", function()
                        actor:ForceNetUpdate()
                    end)

                    if not replicateOk or not updateOk then
                        return false, "plant spawned but replication setup failed"
                    end

                    log(string.format(
                        "PLANT PROBE | OK | plant=%s address=%s X=%.3f Y=%.3f Z=%.3f",
                        key, tostring(addr),
                        tonumber(loc.X) or 0, tonumber(loc.Y) or 0, tonumber(loc.Z) or 0
                    ))

                    -- Intentionally do not retain/destroy this actor later.
                    -- Edible world actors may be consumed independently.
                    return true, string.format(
                        "%s plant spawned at X=%.3f Y=%.3f Z=%.3f",
                        key, tonumber(loc.X) or 0, tonumber(loc.Y) or 0, tonumber(loc.Z) or 0
                    )
                end
            end
        end
    end

    return false, "no safe plant spawn position found" ..
        (lastError and (": " .. tostring(lastError)) or "")
end

local function spawnCorpse(speciesName, location, growthFraction, forward, playerPawn)
    local classPath = SPECIES_PATHS[speciesName]
    if classPath == nil then return false, "unknown species: " .. tostring(speciesName) end

    local pawnCls
    pcall(function() pawnCls = StaticFindObject(classPath) end)
    if pawnCls == nil then return false, "class not found: " .. classPath end

    local gm = findGameMode()
    if gm == nil then return false, "no game mode" end

    local world
    pcall(function() world = gm:GetWorld() end)
    if world == nil then return false, "no world" end

    local spawnOffsets = buildSpawnOffsets(forward)
    local lastPlacementError = nil

    for i, offset in ipairs(spawnOffsets) do
        local x = (tonumber(location.X) or 0) + offset[1]
        local y = (tonumber(location.Y) or 0) + offset[2]
        local groundZ, groundErr = traceGround(gm, x, y, location.Z, playerPawn)

        if groundZ == nil then
            lastPlacementError = groundErr
            log(string.format("BODYDROP DIAG | ground trace | attempt=%d | FAILED | %s", i, tostring(groundErr)))
        else
            local loc = { X = x, Y = y, Z = groundZ + 300 }
            log(string.format(
                "Spawn attempt=%d species=%s X=%.3f Y=%.3f groundZ=%.3f spawnZ=%.3f",
                i, tostring(speciesName), tonumber(loc.X) or 0, tonumber(loc.Y) or 0,
                tonumber(groundZ) or 0, tonumber(loc.Z) or 0
            ))

            local pawn
            local spawnOk, spawnErr = pcall(function()
                pawn = world:SpawnActor(
                    pawnCls,
                    loc,
                    { Pitch = 0, Yaw = 0, Roll = 0 }
                )
            end)

            if not spawnOk then
                lastPlacementError = "SpawnActor failed: " .. tostring(spawnErr)
                log("BODYDROP DIAG | SpawnActor | FAILED | " .. tostring(spawnErr))
            else
                local addr
                if pawn ~= nil then pcall(function() addr = pawn:GetAddress() end) end

                if pawn == nil or addr == nil or addr == 0 then
                    lastPlacementError = "SpawnActor returned invalid/null pawn"
                    log("BODYDROP DIAG | SpawnActor | FAILED | invalid/null pawn")
                else
                    log(string.format("BODYDROP DIAG | SpawnActor | OK | address=%s", tostring(addr)))

                    local growth = growthFraction or 1.0
                    local initFailed = {}

                    local function initStep(label, fn)
                        local ok = tryPawnCall(label, fn)
                        if not ok then initFailed[#initFailed + 1] = label end
                    end

                    -- Let the freshly spawned dinosaur exist as a replicated live pawn
                    -- before converting it to a corpse. Killing it in the same tick can
                    -- leave clients with an edible interaction actor but no rendered mesh.
                    initStep("SetReplicates", function() pawn:SetReplicates(true) end)
                    initStep("SetGrowth", function() pawn:SetGrowth(growth) end)
                    initStep("ForceNetUpdate(pre-corpse)", function() pawn:ForceNetUpdate() end)

                    if #initFailed > 0 then
                        return false, "actor spawned but initialization failed at: " .. table.concat(initFailed, ", ")
                    end

                    local function transitionToCorpse()
                        local failedSteps = {}
                        local function corpseStep(label, fn)
                            local ok = tryPawnCall(label, fn)
                            if not ok then failedSteps[#failedSteps + 1] = label end
                        end

                        local valid = true
                        pcall(function()
                            if pawn.IsValid ~= nil then valid = pawn:IsValid() end
                        end)
                        if valid == false then
                            log("BODYDROP DIAG | delayed corpse transition | FAILED | pawn invalid")
                            return false
                        end

                        -- Re-assert growth immediately before death so the corpse keeps
                        -- the intended size after the client has initialized the mesh.
                        corpseStep("SetGrowth(pre-death)", function() pawn:SetGrowth(growth) end)
                        corpseStep("SetHealth(0)", function() pawn:SetHealth(0) end)
                        corpseStep("bIsDead=true", function() pawn.bIsDead = true end)
                        corpseStep("OnRep_IsNowDead", function() pawn:OnRep_IsNowDead() end)
                        corpseStep("ToggleServerRagdoll", function() pawn:ToggleServerRagdoll(true) end)
                        corpseStep("ActivateDeadbody", function() pawn:ActivateDeadbody(false, 3600) end)
                        corpseStep("ForceNetUpdate(post-corpse)", function() pawn:ForceNetUpdate() end)

                        if #failedSteps > 0 then
                            log("BODYDROP DIAG | delayed corpse transition | PARTIAL | " .. table.concat(failedSteps, ", "))
                            return false
                        end

                        log(string.format(
                            "BODYDROP DIAG | delayed corpse transition | OK | species=%s growth=%.3f delayMs=750",
                            tostring(speciesName), tonumber(growth) or 0
                        ))
                        return true
                    end

                    if LoopInGameThreadWithDelay ~= nil and CancelDelayedAction ~= nil then
                        local corpseHandle
                        local ran = false
                        corpseHandle = LoopInGameThreadWithDelay(750, function()
                            if ran then return end
                            ran = true
                            if corpseHandle ~= nil then
                                pcall(function() CancelDelayedAction(corpseHandle) end)
                            end
                            transitionToCorpse()
                        end)

                        return true, string.format(
                            "corpse queued at X=%.3f Y=%.3f Z=%.3f (ground %.3f; render settle 750ms)",
                            tonumber(loc.X) or 0, tonumber(loc.Y) or 0, tonumber(loc.Z) or 0, tonumber(groundZ) or 0
                        )
                    end

                    log("BODYDROP DIAG | delayed corpse transition unavailable; using immediate fallback")
                    if not transitionToCorpse() then
                        return false, "actor spawned but immediate corpse transition failed"
                    end

                    return true, string.format(
                        "corpse confirmed at X=%.3f Y=%.3f Z=%.3f (ground %.3f; immediate fallback)",
                        tonumber(loc.X) or 0, tonumber(loc.Y) or 0, tonumber(loc.Z) or 0, tonumber(groundZ) or 0
                    )
                end
            end
        end
    end

    return false, "no safe corpse spawn position found" ..
        (lastPlacementError and (": " .. tostring(lastPlacementError)) or "")
end

local function buildResult(id, steam, tokens, ok, msg)
    local tokensJson = "["
    for i, t in ipairs(tokens) do
        if i > 1 then tokensJson = tokensJson .. "," end
        tokensJson = tokensJson .. '"' .. jsonEscape(t) .. '"'
    end
    tokensJson = tokensJson .. "]"

    return string.format(
        '{"id":"%s","ts":%d,"source":"BodyDrop","steam":"%s","args":%s,"ok":%s,"msg":"%s"}',
        jsonEscape(tostring(id or "")), os.time(), jsonEscape(tostring(steam)), tokensJson,
        tostring(ok == true), jsonEscape(tostring(msg or ""))
    )
end

local function handleCommand(steam, tokens)
    local verb = tokens[1] or ""

    if verb == "spawn" then
        local species = tokens[2]
        local x       = tonumber(tokens[3])
        local y       = tonumber(tokens[4])
        local z       = tonumber(tokens[5])
        local growth  = tonumber(tokens[6]) or 1.0
        local target  = tokens[7]

        if species == nil then
            return false, "usage: spawn <Species> <x> <y> <z> [growth] [targetSteam]"
        end

        local location
        local forward
        local playerPawn

        if target ~= nil and target ~= "" then
            local loc, err, facing, pawn = getPlayerPlacement(target)
            if loc == nil then return false, "cannot locate target: " .. tostring(err) end
            location = loc
            forward = facing
            playerPawn = pawn
        elseif x ~= nil and y ~= nil and z ~= nil then
            location = { X = x, Y = y, Z = z }
        else
            return false, "provide coordinates or a target steam64"
        end

        return spawnCorpse(species, location, growth, forward, playerPawn)

    elseif verb == "plant" then
        local plantKey = tokens[2] or "fern"
        local target = tokens[3]
        if target == nil or target == "" then target = steam end
        if target == nil or target == "" then
            return false, "usage: plant <fern|cycad|mushroom> [targetSteam]"
        end
        return spawnPlantForPlayer(plantKey, target)

    elseif verb == "status" then
        return true, string.format("BodyDrop %s | ready", MOD_VERSION)

    elseif verb == "diag" then
        local species = tokens[2] or "Triceratops"
        if SPECIES_PATHS[species] == nil then return false, "unknown species: " .. species end

        local cls
        pcall(function() cls = StaticFindObject(SPECIES_PATHS[species]) end)
        return cls ~= nil, cls ~= nil and "class found" or "class NOT found on this server"
    end

    return false, "unknown verb: " .. tostring(verb)
end

local delivered = {}

local function processRecord(line)
    local id = jsonReadString(line, "id")
    if not id or #id > 100 or not id:match("^[%w_-]+$") then
        log("Invalid request ID; retaining processing file")
        return false
    end

    local statePath = REQUESTS_DIR .. "/" .. id
    local steam = jsonReadString(line, "steam") or ""

    if delivered[id] == steam then return true end

    local cached = readAll(statePath .. ".result")
    if cached then
        if cached:sub(-1) ~= "\n" or jsonReadString(cached, "id") ~= id or
            jsonReadString(cached, "steam") ~= steam then
            log("Request ID/Steam conflict id=" .. id)
            return false
        end

        if not appendLine(RESULTS_FILE, cached:gsub("[\r\n]+$", "")) then return false end
        delivered[id] = steam
        return true
    end

    if fileExists(statePath .. ".started") then
        log("Outcome unknown; refusing repeat execution id=" .. id)
        return false
    end

    local previous = readAll(RESULTS_FILE) or ""
    for result in previous:gmatch("([^\n]+)\n") do
        if jsonReadString(result, "id") == id and jsonReadString(result, "source") == "BodyDrop" then
            if jsonReadString(result, "steam") ~= steam then return false end
            delivered[id] = steam
            return true
        end
    end

    local argsBlock = line:match('"args"%s*:%s*%[([^%]]*)%]')
    local tokens = {}
    if argsBlock then
        for value in argsBlock:gmatch('"([^"]*)"') do tokens[#tokens + 1] = value end
    end

    if not appendLine(statePath .. ".started", line) then return false end
    log("Processing id=" .. id .. " verb=" .. tostring(tokens[1]))

    local callOk, r1, r2 = pcall(handleCommand, steam, tokens)
    if not callOk then
        log("Outcome unknown after handler error id=" .. id)
        return false
    end

    local result = buildResult(id, steam, tokens, r1 == true, tostring(r2 or ""))
    if not appendLine(statePath .. ".result", result) then return false end
    if not appendLine(RESULTS_FILE, result) then return false end

    delivered[id] = steam
    log("Result recorded id=" .. id .. " ok=" .. tostring(r1 == true))
    return true
end

local function pollInbox()
    local stash = INBOX_PATH .. ".processing"

    if not fileExists(stash) then
        if not fileExists(INBOX_PATH) then return end
        if not os.rename(INBOX_PATH, stash) then return end
    end

    local body = readAll(stash)
    if body == nil then return end
    if body == "" then
        os.remove(stash)
        return
    end

    local complete = body:sub(-1) == "\n"
    for line in body:gmatch("([^\n]+)\n") do
        if line:match("%S") and not processRecord(line) then complete = false end
    end

    if complete then os.remove(stash) end
end

local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then log(string.format("safeCall(%s) failed: %s", label, tostring(err))) end
    return ok, err
end

log(string.format("Loading; version=%s", MOD_VERSION))

if LoopInGameThreadWithDelay ~= nil then
    local bootHandle

    bootHandle = LoopInGameThreadWithDelay(5000, function()
        log(string.format("Boot; version=%s", MOD_VERSION))
        ensureDir(SAVED_DIR)
        ensureDir(REQUESTS_DIR)
        log("Inbox=" .. INBOX_PATH .. " results=" .. RESULTS_FILE)

        local tf = io.open(SAVED_DIR .. "/.keep", "wb")
        if tf then
            tf:write("")
            tf:close()
        else
            log("WARNING: cannot write to " .. SAVED_DIR)
        end

        if bootHandle ~= nil and CancelDelayedAction ~= nil then
            pcall(function() CancelDelayedAction(bootHandle) end)
        end
    end)

    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
        safeCall("pollInbox", pollInbox)

        local reload = consumeFlag(RELOAD_FLAG)
        if reload ~= nil and RestartCurrentMod ~= nil then
            log("RELOAD")
            RestartCurrentMod()
        end
    end)
end

log(string.format("Loaded; version=%s", MOD_VERSION))
