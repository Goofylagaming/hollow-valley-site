-- AdminActions v002
-- Hollow Valley administrator-only live player actions.
-- Slay resolves a connected player's live dinosaur, triggers the verified Smite effect when available,
-- then applies the proven health-zero kill path. Future actions (heal/feed/grow) belong here.

local MOD_NAME    = "AdminActions"
local MOD_VERSION = "v002"

local function resolveModRoot()
    local source = debug.getinfo(1, "S").source or ""
    if source:sub(1, 1) == "@" then source = source:sub(2) end
    source = source:gsub("\\", "/")
    return source:match("^(.*)/Scripts/[^/]+$")
end

local MOD_ROOT = assert(resolveModRoot(), "AdminActions cannot resolve its Scripts directory")
local MODS_ROOT = assert(MOD_ROOT:match("^(.*)/[^/]+$"), "AdminActions cannot resolve Mods directory")
local SAVED_DIR    = MOD_ROOT .. "/Saved"
local INBOX_PATH   = SAVED_DIR .. "/inbox.ndjson"
local RELOAD_FLAG  = SAVED_DIR .. "/reload.flag"
local RESULTS_FILE = MODS_ROOT .. "/CommandBridge/Saved/results.ndjson"
local REQUESTS_DIR = SAVED_DIR .. "/requests"

local POLL_INTERVAL_MS = 1000
local SMITE_ENABLED = true
local SMITE_CLASS_PATH = "/Game/TheIsle/Core/Spawnables/BP_SmiteEffect.BP_SmiteEffect_C"

local function log(msg)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(msg)))
end

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
    local wrote = f:write((line or "") .. "\n")
    local closed = f:close()
    return wrote ~= nil and closed ~= nil
end

local function consumeFlag(path)
    local f = io.open(path, "rb")
    if f == nil then return nil end
    local body = f:read("*a") or ""
    f:close()
    os.remove(path)
    body = body:gsub("^%s+", ""):gsub("%s+$", "")
    return body ~= "" and body or nil
end

local function ensureDir(path)
    local winPath = tostring(path):gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
end

local function jsonEscape(s)
    s = tostring(s or "")
    return s:gsub("\\", "\\\\")
        :gsub('"', '\\"')
        :gsub("\n", "\\n")
        :gsub("\r", "\\r")
        :gsub("\t", "\\t")
end

local function jsonReadString(body, key)
    return string.match(body or "", '"' .. key .. '"%s*:%s*"([^"]*)"')
end

local function validSteamId(steam)
    return type(steam) == "string" and steam:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") ~= nil
end

local function findGameMode()
    local candidates = {"BP_SurvivalGameMode_C","TISurvivalGameMode","TIGameModeBase","GameModeBase"}
    for _, name in ipairs(candidates) do
        local gm
        pcall(function() gm = FindFirstOf(name) end)
        if gm ~= nil then return gm end
    end
    return nil
end

local function livePawnFromCtrl(ctrl)
    if ctrl == nil then return nil end
    local pawn
    pcall(function() pawn = ctrl:K2_GetPawn() end)
    if pawn == nil then return nil end
    local addr
    pcall(function() addr = pawn:GetAddress() end)
    if addr == nil or addr == 0 then return nil end
    return pawn
end

local function describePawn(pawn)
    local species = "dinosaur"
    local growth = nil
    pcall(function()
        local full = pawn:GetClass():GetFullName()
        species = ((full and full:match("BP_(.-)%.")) or "dinosaur"):gsub("_C$", "")
    end)
    pcall(function() growth = pawn:GetGrowth() end)

    local growthText = ""
    if tonumber(growth) ~= nil then
        local pct = tonumber(growth)
        if pct <= 1.5 then pct = pct * 100 end
        growthText = string.format(" at %.0f%% growth", pct)
    end
    return species, growthText
end

local function trySmiteAtPawn(gm, pawn)
    if SMITE_ENABLED ~= true then return false, "disabled" end
    if StaticFindObject == nil then return false, "StaticFindObject unavailable" end

    local smiteClass
    local classOk, classErr = pcall(function()
        smiteClass = StaticFindObject(SMITE_CLASS_PATH)
    end)
    if not classOk or smiteClass == nil then
        return false, "Smite class unavailable: " .. tostring(classErr or "not found")
    end

    local world
    local worldOk, worldErr = pcall(function() world = gm:GetWorld() end)
    if not worldOk or world == nil then
        return false, "world unavailable: " .. tostring(worldErr or "nil")
    end

    local loc
    local locOk, locErr = pcall(function() loc = pawn:K2_GetActorLocation() end)
    if not locOk or loc == nil then
        return false, "target location unavailable: " .. tostring(locErr or "nil")
    end

    local rot
    local rotOk = pcall(function() rot = pawn:K2_GetActorRotation() end)
    if not rotOk or rot == nil then
        return false, "target rotation unavailable"
    end

    local effect
    local spawnOk, spawnErr = pcall(function()
        effect = world:SpawnActor(smiteClass, loc, rot)
    end)
    if not spawnOk or effect == nil then
        return false, "Smite spawn failed: " .. tostring(spawnErr or "nil")
    end

    local addr
    pcall(function() addr = effect:GetAddress() end)
    if addr == nil or addr == 0 then
        return false, "Smite spawn returned nullptr"
    end

    -- Replication must be enabled before triggering the Blueprint event.
    pcall(function() effect:SetReplicates(true) end)
    pcall(function() effect:ForceNetUpdate() end)

    -- IMPORTANT: CustomEvent is deliberately the final call made on this actor.
    -- BP_SmiteEffect self-destroys through its own Blueprint lifecycle; retaining
    -- the wrapper or calling K2_DestroyActor later can dereference freed memory.
    local eventOk, eventErr = pcall(function() effect:CustomEvent() end)
    if not eventOk then
        return false, "Smite CustomEvent failed: " .. tostring(eventErr)
    end

    return true, "triggered"
end

local function cmdSlay(steam)
    if not validSteamId(steam) then return false, "invalid Steam ID" end

    local gm = findGameMode()
    if gm == nil then return false, "Server not ready." end

    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return false, "Player is not connected to the server." end

    local pawn = livePawnFromCtrl(ctrl)
    if pawn == nil then return false, "Player does not have a live dinosaur." end

    local species, growthText = describePawn(pawn)
    local healthBefore = nil
    pcall(function() healthBefore = pawn:GetHealth() end)

    -- Lightning is best-effort only. Never let a VFX failure block the proven
    -- admin kill path.
    local smiteOk, smiteMsg = trySmiteAtPawn(gm, pawn)
    if smiteOk then
        log(string.format("Smite triggered steam=%s species=%s", steam, species))
    else
        log(string.format("Smite unavailable steam=%s species=%s reason=%s", steam, species, tostring(smiteMsg)))
    end

    local applied, applyErr = pcall(function() pawn:SetHealth(0) end)
    if not applied then
        return false, "Slay write failed: " .. tostring(applyErr)
    end

    pcall(function() pawn:ForceNetUpdate() end)

    local healthAfter = nil
    pcall(function() healthAfter = pawn:GetHealth() end)
    log(string.format(
        "Slay applied steam=%s species=%s healthBefore=%s healthAfter=%s smite=%s",
        steam, species, tostring(healthBefore), tostring(healthAfter), tostring(smiteOk)
    ))

    local effectText = smiteOk and " Lightning effect triggered."
        or " Lightning effect unavailable; slay still applied."
    return true, string.format("Slay applied to %s%s.%s", species, growthText, effectText)
end

local function handleCommand(steam, tokens)
    local verb = tokens[1] or ""
    if verb == "slay" then
        return cmdSlay(steam)
    elseif verb == "status" then
        return true, string.format("AdminActions %s | ready", MOD_VERSION)
    end
    return false, "unknown verb: " .. tostring(verb)
end

local function buildResult(id, steam, tokens, ok, msg)
    local argsJson = "["
    for i, token in ipairs(tokens or {}) do
        if i > 1 then argsJson = argsJson .. "," end
        argsJson = argsJson .. '"' .. jsonEscape(token) .. '"'
    end
    argsJson = argsJson .. "]"

    return string.format(
        '{"id":"%s","ts":%d,"source":"AdminActions","steam":"%s","args":%s,"ok":%s,"msg":"%s"}',
        jsonEscape(id), os.time(), jsonEscape(steam), argsJson,
        tostring(ok == true), jsonEscape(msg)
    )
end

local delivered = {}

local function processRecord(line)
    local id = jsonReadString(line, "id")
    if not id or #id > 100 or not id:match("^[%w_-]+$") then
        log("Invalid request ID; retaining processing file")
        return false
    end

    local steam = jsonReadString(line, "steam") or ""
    local statePath = REQUESTS_DIR .. "/" .. id
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
        if jsonReadString(result, "id") == id and jsonReadString(result, "source") == "AdminActions" then
            if jsonReadString(result, "steam") ~= steam then return false end
            delivered[id] = steam
            return true
        end
    end

    local argsBlock = line:match('"args"%s*:%s*%[([^%]]*)%]')
    local tokens = {}
    if argsBlock then
        for value in argsBlock:gmatch('"([^"]*)"') do
            tokens[#tokens + 1] = value
        end
    end

    if not appendLine(statePath .. ".started", line) then return false end
    log("Processing id=" .. id .. " verb=" .. tostring(tokens[1]) .. " steam=" .. steam)

    local callOk, ok, msg = pcall(handleCommand, steam, tokens)
    if not callOk then
        log("Outcome unknown after handler error id=" .. id .. " error=" .. tostring(ok))
        return false
    end

    local result = buildResult(id, steam, tokens, ok == true, tostring(msg or ""))
    if not appendLine(statePath .. ".result", result) then return false end
    if not appendLine(RESULTS_FILE, result) then return false end

    delivered[id] = steam
    log("Result recorded id=" .. id .. " ok=" .. tostring(ok == true))
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
    if not ok then log(string.format("safeCall(%s) failed: %s", tostring(label), tostring(err))) end
end

log(string.format("Loading; version=%s", MOD_VERSION))

if LoopInGameThreadWithDelay ~= nil then
    local bootHandle
    bootHandle = LoopInGameThreadWithDelay(5000, function()
        ensureDir(SAVED_DIR)
        ensureDir(REQUESTS_DIR)
        log(string.format("Boot; version=%s inbox=%s", MOD_VERSION, INBOX_PATH))
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
