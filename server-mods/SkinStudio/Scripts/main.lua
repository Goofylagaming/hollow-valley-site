-- SkinStudio v006
-- Hollow Valley live skin application + reconnect persistence.
-- Commands arrive from CommandBridge as inbox.ndjson records.

local MOD_NAME = "SkinStudio"
local MOD_VERSION = "v006"

local function resolveModRoot()
    local source = ""
    pcall(function()
        source = debug.getinfo(1, "S").source or ""
    end)
    if source:sub(1, 1) == "@" then
        source = source:sub(2)
    end
    source = source:gsub("\\", "/")
    return source:match("^(.*)/Scripts/[^/]+$")
end

local MOD_ROOT = resolveModRoot()
local MODS_ROOT = MOD_ROOT and MOD_ROOT:match("^(.*)/SkinStudio$") or nil
local SAVED_DIR = MOD_ROOT and (MOD_ROOT .. "/Saved") or "Mods/SkinStudio/Saved"
local INBOX_PATH = SAVED_DIR .. "/inbox.ndjson"
local PROFILES_PATH = SAVED_DIR .. "/profiles.ndjson"
local RELOAD_FLAG = SAVED_DIR .. "/reload.flag"
local RESULTS_FILE =
    (MODS_ROOT and (MODS_ROOT .. "/CommandBridge/Saved/results.ndjson"))
    or "Mods/CommandBridge/Saved/results.ndjson"
local POLL_INTERVAL_MS = 1500
local REAPPLY_INTERVAL_MS = 10000
local LIVE_REFRESH_INTERVAL_MS = 3000
local LIVE_REFRESH_ATTEMPTS = 3

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

local function writeAll(path, body)
    local f = io.open(path, "wb")
    if f == nil then return false end
    f:write(body or "")
    f:close()
    return true
end

local function appendLine(path, line)
    local f = io.open(path, "ab")
    if f == nil then return false end
    f:write(line or "")
    f:write("\n")
    f:close()
    return true
end

local function ensureDir(path)
    local winPath = tostring(path):gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
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

local function jsonEscape(s)
    s = tostring(s or "")
    s = s:gsub("\\", "\\\\")
    s = s:gsub('"', '\\"')
    s = s:gsub("\n", "\\n")
    s = s:gsub("\r", "\\r")
    s = s:gsub("\t", "\\t")
    return s
end

local function jsonReadString(body, field)
    return string.match(body or "", '"' .. field .. '"%s*:%s*"([^"]*)"')
end

local function jsonReadStringArray(body, field)
    local out = {}
    local arrayBody = string.match(body or "", '"' .. field .. '"%s*:%s*(%b[])')
    if not arrayBody then return out end
    for value in string.gmatch(arrayBody, '"([^"]*)"') do
        table.insert(out, value)
    end
    return out
end

local function findGameMode()
    local candidates = {"BP_SurvivalGameMode_C", "TISurvivalGameMode", "TIGameModeBase", "GameModeBase"}
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

local function safeNotify(steam, msg)
    local gm = findGameMode()
    if gm == nil then return end
    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return end
    local text = msg
    if FText ~= nil then
        local ok, ft = pcall(function() return FText(msg) end)
        if ok and ft ~= nil then text = ft end
    end
    pcall(function() ctrl:ClientShowNotification(text) end)
end

local FIELD_MAP = {
    body = "BodyColor",
    markings = "MarkingsColor",
    flank = "FlankColor",
    underbelly = "UnderbellyColor",
    teeth = "TeethColor",
    mouth = "MouthColor",
    claws = "ClawsColor",
    detail1 = "Detail1Color",
    eyes = "EyesColor",
    maleDisplay = "MaleDisplayColor",
}

local COLOR_KEYS = {
    "body", "markings", "flank", "underbelly", "teeth",
    "mouth", "claws", "detail1", "eyes", "maleDisplay",
}

local function parseColor(raw)
    local r, g, b, a = tostring(raw or ""):match("^([%d%.]+),([%d%.]+),([%d%.]+),([%d%.]+)$")
    r, g, b, a = tonumber(r), tonumber(g), tonumber(b), tonumber(a)
    if r == nil or g == nil or b == nil or a == nil then return nil end
    if r < 0 or r > 1 or g < 0 or g > 1 or b < 0 or b > 1 or a < 0 or a > 1 then return nil end
    return { r=r, g=g, b=b, a=a }
end

local function parseTokens(args)
    local raw = {}
    for _, token in ipairs(args or {}) do
        local key, value = tostring(token):match("^([A-Za-z0-9_]+)=(.+)$")
        if key and value then raw[key] = value end
    end

    local species = tostring(raw.species or "")
    if not species:match("^[A-Za-z0-9_-]+$") then
        return nil, "Skin species is missing or invalid."
    end

    local config = {
        preset = tostring(raw.preset or ""),
        species = species,
        colors = {},
        variation = tonumber(raw.variation),
        pattern = tonumber(raw.pattern),
        theme = tonumber(raw.theme),
        preserveIndices = tostring(raw.preserveIndices or "") == "1",
    }

    for _, key in ipairs(COLOR_KEYS) do
        local color = parseColor(raw[key])
        if color == nil then
            return nil, "Skin colour data is incomplete or invalid."
        end
        config.colors[key] = color
    end

    for _, key in ipairs({"variation", "pattern", "theme"}) do
        local value = config[key]
        if value == nil or value < 0 or value > 65535 or value ~= math.floor(value) then
            return nil, "Skin pattern data is invalid."
        end
    end

    return config, nil
end

local function pawnClassName(pawn)
    local full
    pcall(function() full = pawn:GetClass():GetFullName() end)
    return tostring(full or "")
end

local function speciesMatches(pawn, expected)
    local className = pawnClassName(pawn):lower()
    local wanted = tostring(expected or ""):lower()
    if className == "" or wanted == "" then return false end
    return className:find("bp_" .. wanted, 1, true) ~= nil
        or className:find(wanted, 1, true) ~= nil
end

local function nearlyEqual(a, b)
    local left, right = tonumber(a), tonumber(b)
    if left == nil or right == nil then return false end
    return math.abs(left - right) <= 0.0005
end

local function applyColor(cdata, field, color)
    local ok, err = pcall(function()
        local target = cdata[field]
        if target == nil then error(field .. " is unavailable") end
        target.R = color.r
        target.G = color.g
        target.B = color.b
        target.A = color.a
    end)
    if not ok then
        return false, tostring(err)
    end

    local verifyOk, verifyErr = pcall(function()
        local actual = cdata[field]
        if actual == nil then error(field .. " disappeared during verification") end
        if not nearlyEqual(actual.R, color.r)
            or not nearlyEqual(actual.G, color.g)
            or not nearlyEqual(actual.B, color.b)
            or not nearlyEqual(actual.A, color.a) then
            error(string.format(
                "%s readback mismatch wanted=%.6f,%.6f,%.6f,%.6f actual=%.6f,%.6f,%.6f,%.6f",
                field,
                color.r, color.g, color.b, color.a,
                tonumber(actual.R) or -999,
                tonumber(actual.G) or -999,
                tonumber(actual.B) or -999,
                tonumber(actual.A) or -999
            ))
        end
    end)
    if not verifyOk then
        return false, tostring(verifyErr)
    end
    return true, nil
end

local function mirrorCustomizerToTemporary(pawn, config)
    local okTemp, temp = pcall(function() return pawn.TemporarySkinData end)
    if not okTemp or temp == nil then
        log("TemporarySkinData unavailable on " .. pawnClassName(pawn))
        return false, "TemporarySkinData unavailable"
    end

    local failures = {}
    local writes = 0
    for key, field in pairs(FIELD_MAP) do
        local ok, err = applyColor(temp, field, config.colors[key])
        if ok then
            writes = writes + 1
        else
            table.insert(failures, field .. ": " .. tostring(err))
        end
    end

    if not config.preserveIndices then
        local scalarWrites = {
            SkinVariation = math.floor(config.variation),
            PatternIndex = math.floor(config.pattern),
            ThemeIndex = math.floor(config.theme),
        }
        for field, value in pairs(scalarWrites) do
            local ok, err = pcall(function() temp[field] = value end)
            if not ok then
                table.insert(failures, field .. ": " .. tostring(err))
            end
        end
    end

    if #failures > 0 then
        log("Temporary skin mirror failed: " .. table.concat(failures, " | "))
        return false, table.concat(failures, " | ")
    end

    log(string.format(
        "Temporary skin mirror verified species=%s pawn=%s colors=%d",
        tostring(config.species),
        pawnClassName(pawn),
        writes
    ))
    return true, nil
end

local function applyConfigToPawn(pawn, config)
    if pawn == nil then return false, "You need a live dinosaur in game." end
    if not speciesMatches(pawn, config.species) then
        return false, "This skin is for " .. tostring(config.species) .. ", not your current dinosaur."
    end

    local paletteModeOk, paletteModeErr = pcall(function()
        pawn.bUseSkinPalette = true
    end)
    if not paletteModeOk then
        log("bUseSkinPalette write failed: " .. tostring(paletteModeErr))
    end

    local okCdata, cdata = pcall(function() return pawn.CustomizerData end)
    if not okCdata or cdata == nil then
        return false, "The live dinosaur customizer is unavailable."
    end

    local failures = {}
    local writes = 0
    for key, field in pairs(FIELD_MAP) do
        local ok, err = applyColor(cdata, field, config.colors[key])
        if ok then
            writes = writes + 1
        else
            table.insert(failures, field .. ": " .. tostring(err))
            log("WRITE FAILED " .. field .. " steam-pawn=" .. pawnClassName(pawn) .. " err=" .. tostring(err))
        end
    end

    local function writeScalar(field, value)
        local ok, err = pcall(function() cdata[field] = value end)
        if not ok then
            table.insert(failures, field .. ": " .. tostring(err))
            log("WRITE FAILED " .. field .. " err=" .. tostring(err))
            return false
        end
        local verifyOk, actual = pcall(function() return cdata[field] end)
        if not verifyOk or tonumber(actual) ~= tonumber(value) then
            local msg = field .. " readback mismatch wanted=" .. tostring(value) .. " actual=" .. tostring(actual)
            table.insert(failures, msg)
            log("WRITE FAILED " .. msg)
            return false
        end
        return true
    end

    -- PatternIndex is species-table validated by EVRIMA. A bad value can make
    -- the client drop the entire skin rebuild, so only write a non-negative
    -- integer supplied by the preset and verify the live property accepted it.
    local variation = math.floor(config.variation)
    local pattern = math.floor(config.pattern)
    local theme = math.floor(config.theme)
    if not config.preserveIndices then
        writeScalar("SkinVariation", variation)
        if pattern >= 0 then writeScalar("PatternIndex", pattern) end
        if theme >= 0 then writeScalar("ThemeIndex", theme) end
    end

    local mirrorOk, mirrorErr = mirrorCustomizerToTemporary(pawn, config)
    if not mirrorOk then
        log("Temporary skin mirror warning: " .. tostring(mirrorErr))
    end

    local netOk, netErr = pcall(function() pawn:ForceNetUpdate() end)
    if not netOk then
        table.insert(failures, "ForceNetUpdate: " .. tostring(netErr))
        log("WRITE FAILED ForceNetUpdate err=" .. tostring(netErr))
    end

    if #failures > 0 then
        return false, "Skin write failed: " .. table.concat(failures, " | ")
    end

    log(string.format(
        "Verified skin write species=%s pawn=%s colors=%d pattern=%d theme=%d variation=%d temporary=%s",
        tostring(config.species),
        pawnClassName(pawn),
        writes,
        config.preserveIndices and -1 or pattern,
        config.preserveIndices and -1 or theme,
        config.preserveIndices and -1 or variation,
        tostring(mirrorOk == true)
    ))
    return true, "Skin applied and verified on the live customizer."
end

local profiles = {}
local profileArgs = {}
local lastPawnAddress = {}
local lastProfileSpecies = {}
local pendingLiveRefresh = {}

local function profileSpeciesKey(species)
    return tostring(species or ""):lower()
end

local function ensureProfileBucket(steam)
    profiles[steam] = profiles[steam] or {}
    profileArgs[steam] = profileArgs[steam] or {}
    return profiles[steam], profileArgs[steam]
end

local function setProfile(steam, args, config)
    local key = profileSpeciesKey(config and config.species)
    if key == "" then return false end
    local bucket, argBucket = ensureProfileBucket(steam)
    bucket[key] = config
    argBucket[key] = args
    return true
end

local function profileLine(steam, args, config)
    local parts = {}
    for i, token in ipairs(args or {}) do
        parts[i] = '"' .. jsonEscape(token) .. '"'
    end
    return string.format(
        '{"steam":"%s","species":"%s","tokens":[%s]}',
        jsonEscape(steam),
        jsonEscape(config and config.species or ""),
        table.concat(parts, ",")
    )
end

local function persistProfiles()
    local lines = {}
    local steamIds = {}
    for steam, _ in pairs(profiles) do table.insert(steamIds, steam) end
    table.sort(steamIds)

    for _, steam in ipairs(steamIds) do
        local speciesKeys = {}
        for species, _ in pairs(profiles[steam] or {}) do table.insert(speciesKeys, species) end
        table.sort(speciesKeys)

        for _, species in ipairs(speciesKeys) do
            local config = profiles[steam][species]
            local args = profileArgs[steam] and profileArgs[steam][species] or {}
            table.insert(lines, profileLine(steam, args, config))
        end
    end

    local body = table.concat(lines, "\n")
    if body ~= "" then body = body .. "\n" end
    return writeAll(PROFILES_PATH, body)
end

local function rememberProfile(steam, args, config)
    if not setProfile(steam, args, config) then return false end
    if not persistProfiles() then
        log("WARNING: could not persist skin profiles")
        return false
    end
    return true
end

local function loadProfiles()
    local body = readAll(PROFILES_PATH)
    if body == nil or body == "" then return end
    local records = 0
    for line in string.gmatch(body .. "\n", "([^\r\n]+)\r?\n") do
        local steam = jsonReadString(line, "steam")
        local args = jsonReadStringArray(line, "tokens")
        if steam and steam:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") then
            local config = parseTokens(args)
            if config ~= nil and setProfile(steam, args, config) then
                records = records + 1
            end
        end
    end

    local unique = 0
    for _, bucket in pairs(profiles) do
        for _, _ in pairs(bucket) do unique = unique + 1 end
    end
    log("Loaded " .. tostring(unique) .. " persisted species skin profile(s) from " .. tostring(records) .. " record(s)")
end

local function emitResult(id, steam, ok, msg)
    local line = string.format(
        '{"id":"%s","ts":%d,"verb":"skin_apply","steam":"%s","ok":%s,"msg":"%s","source":"SkinStudio"}',
        jsonEscape(id),
        os.time(),
        jsonEscape(steam),
        tostring(ok == true),
        jsonEscape(msg)
    )
    appendLine(RESULTS_FILE, line)
end

local function applyForSteam(steam, config)
    local gm = findGameMode()
    if gm == nil then return false, "Server not ready." end

    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return false, "You must be logged into the server." end

    local pawn = livePawnFromCtrl(ctrl)
    return applyConfigToPawn(pawn, config)
end

local function processLine(line)
    local id = jsonReadString(line, "id")
    local steam = jsonReadString(line, "steam")
    local args = jsonReadStringArray(line, "args")

    if not id or not steam or not steam:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") then
        return
    end

    local config, parseError = parseTokens(args)
    if config == nil then
        emitResult(id, steam, false, parseError or "Invalid skin request.")
        return
    end

    local ok, msg = applyForSteam(steam, config)
    if ok then
        rememberProfile(steam, args, config)
        local gm = findGameMode()
        if gm ~= nil then
            local ctrl
            pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
            local pawn = livePawnFromCtrl(ctrl)
            if pawn ~= nil then
                local addr
                pcall(function() addr = pawn:GetAddress() end)
                lastPawnAddress[steam] = addr
                lastProfileSpecies[steam] = profileSpeciesKey(config.species)
            end
        end
        pendingLiveRefresh[steam] = {
            config = config,
            remaining = LIVE_REFRESH_ATTEMPTS,
        }
        safeNotify(steam, "Hollow Valley skin equipped: " .. tostring(config.preset ~= "" and config.preset or "custom skin"))
    end
    emitResult(id, steam, ok, msg)
end

local function pollInbox()
    if not fileExists(INBOX_PATH) then return end
    local stash = INBOX_PATH .. ".processing"
    os.remove(stash)
    if not os.rename(INBOX_PATH, stash) then return end

    local body = readAll(stash)
    if body ~= nil and body ~= "" then
        for line in string.gmatch(body .. "\n", "([^\r\n]+)\r?\n") do
            local ok, err = pcall(function() processLine(line) end)
            if not ok then log("Request processing failed: " .. tostring(err)) end
        end
    end
    os.remove(stash)
end

local function matchingProfileForPawn(steam, pawn)
    for species, config in pairs(profiles[steam] or {}) do
        if speciesMatches(pawn, config.species) then
            return config, species
        end
    end
    return nil, nil
end

local function reapplyProfiles()
    local gm = findGameMode()
    if gm == nil then return end

    for steam, _ in pairs(profiles) do
        local ctrl
        pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
        local pawn = livePawnFromCtrl(ctrl)
        if pawn ~= nil then
            local config, speciesKey = matchingProfileForPawn(steam, pawn)
            if config ~= nil then
                local addr
                pcall(function() addr = pawn:GetAddress() end)
                if addr ~= nil and (addr ~= lastPawnAddress[steam] or speciesKey ~= lastProfileSpecies[steam]) then
                    local ok = applyConfigToPawn(pawn, config)
                    if ok then
                        lastPawnAddress[steam] = addr
                        lastProfileSpecies[steam] = speciesKey
                        safeNotify(steam, "Your Hollow Valley " .. tostring(config.species) .. " skin was restored.")
                    end
                end
            else
                lastPawnAddress[steam] = nil
                lastProfileSpecies[steam] = nil
            end
        else
            lastPawnAddress[steam] = nil
            lastProfileSpecies[steam] = nil
        end
    end
end

local function refreshLiveApplies()
    for steam, state in pairs(pendingLiveRefresh) do
        if state == nil or state.config == nil or (tonumber(state.remaining) or 0) <= 0 then
            pendingLiveRefresh[steam] = nil
        else
            local ok, msg = applyForSteam(steam, state.config)
            state.remaining = (tonumber(state.remaining) or 1) - 1
            if ok then
                log(string.format(
                    "Live refresh verified steam=%s species=%s remaining=%d",
                    tostring(steam),
                    tostring(state.config.species),
                    state.remaining
                ))
            else
                log(string.format(
                    "Live refresh failed steam=%s species=%s remaining=%d msg=%s",
                    tostring(steam),
                    tostring(state.config.species),
                    state.remaining,
                    tostring(msg)
                ))
            end
            if state.remaining <= 0 then
                pendingLiveRefresh[steam] = nil
            end
        end
    end
end

local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then log(label .. " failed: " .. tostring(err)) end
end

log(string.format("Loading; version=%s saved=%s", MOD_VERSION, tostring(SAVED_DIR)))
ensureDir(SAVED_DIR)
loadProfiles()

if LoopInGameThreadWithDelay ~= nil then
    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
        safeCall("pollInbox", pollInbox)
        local reload = consumeFlag(RELOAD_FLAG)
        if reload ~= nil and RestartCurrentMod ~= nil then
            log("Reload requested")
            RestartCurrentMod()
        end
    end)

    LoopInGameThreadWithDelay(REAPPLY_INTERVAL_MS, function()
        safeCall("reapplyProfiles", reapplyProfiles)
    end)

    LoopInGameThreadWithDelay(LIVE_REFRESH_INTERVAL_MS, function()
        safeCall("refreshLiveApplies", refreshLiveApplies)
    end)

    log("Poll, persistence and live-refresh loops registered")
else
    log("ERROR: LoopInGameThreadWithDelay is unavailable")
end

log(string.format("Loaded; version=%s", MOD_VERSION))
