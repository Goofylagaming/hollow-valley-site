-- SkinStudio v012
-- Hollow Valley live skin application with life-scoped reconnect persistence.
-- A Wear Live skin is remembered for the dinosaur life it was applied to and
-- restored after reconnect/server restart once EVRIMA has created the pawn.
-- The profile is cleared when a same-connection respawn/nest/new life or a
-- meaningful growth reset is detected, preventing an old skin from crossing
-- onto a different dinosaur life.
-- TemporarySkinData and bUseSkinPalette remain untouched to avoid EVRIMA
-- reusing transient skin payloads while constructing new pawns.
-- Commands arrive from CommandBridge as inbox.ndjson records.

local MOD_NAME = "SkinStudio"
local MOD_VERSION = "v012"

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
-- EVRIMA rebuilds SkinCode-driven colours during login. Re-check on a short
-- cadence so the mod can re-assert its saved profile after that engine pass.
local REAPPLY_INTERVAL_MS = 4000
local LIVE_REFRESH_INTERVAL_MS = 3000
local LIVE_REFRESH_ATTEMPTS = 5

-- PatternIndex is strict and species-specific in 0.21.720. A bad value can
-- make the client discard the entire skin rebuild while server readback still
-- looks correct. Only write patterns for species whose range is verified.
local PATTERN_MAX_BY_SPECIES = {
    tyrannosaurus = 2,
}

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

local function jsonReadNumber(body, field)
    local raw = string.match(body or "", '"' .. field .. '"%s*:%s*(-?[%d%.]+)')
    return tonumber(raw)
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

-- v011 deliberately avoids TemporarySkinData. EVRIMA can reuse that transient
-- payload while constructing later pawns, which risks copying an old Skin
-- Studio appearance onto a respawn or nested hatchling.
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
    if wanted == "universal" then return true end
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

local function applyConfigToPawn(pawn, config)
    if pawn == nil then return false, "You need a live dinosaur in game." end
    if not speciesMatches(pawn, config.species) then
        return false, "This skin is for " .. tostring(config.species) .. ", not your current dinosaur."
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

        local speciesKey = tostring(config.species or ""):lower():gsub("[^%w]", "")
        local patternMax = PATTERN_MAX_BY_SPECIES[speciesKey]
        if patternMax ~= nil and pattern >= 0 and pattern <= patternMax then
            writeScalar("PatternIndex", pattern)
        elseif patternMax ~= nil then
            log(string.format(
                "Skipped unsafe PatternIndex species=%s wanted=%s valid=0..%d",
                tostring(config.species), tostring(pattern), patternMax
            ))
        else
            log(string.format(
                "Skipped unverified PatternIndex species=%s wanted=%s",
                tostring(config.species), tostring(pattern)
            ))
        end

        if theme >= 0 then writeScalar("ThemeIndex", theme) end
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
        "Verified current-pawn skin write species=%s pawn=%s colors=%d pattern=%d theme=%d variation=%d temporary=false",
        tostring(config.species),
        pawnClassName(pawn),
        writes,
        config.preserveIndices and -1 or pattern,
        config.preserveIndices and -1 or theme,
        config.preserveIndices and -1 or variation
    ))
    return true, "Skin applied and verified on the live customizer."
end

local profiles = {}
local profileArgs = {}
local profileGrowth = {}
local profileBaseFingerprint = {}
local profileAppliedFingerprint = {}
local fingerprintStability = {}
local lastPawnAddress = {}
local lastControllerAddress = {}
local lastProfileSpecies = {}
local hadPawnThisConnection = {}
local pendingNewLife = {}
local pendingLiveRefresh = {}
local NEW_LIFE_GROWTH_DROP = 0.05
local BABY_GROWTH_RESET_FLOOR = 0.15
local PROFILE_GROWTH_PERSIST_STEP = 0.01
local RECONNECT_FINGERPRINT_STABLE_POLLS = 2

local function profileSpeciesKey(species)
    return tostring(species or ""):lower()
end

local function ensureProfileBucket(steam)
    profiles[steam] = profiles[steam] or {}
    profileArgs[steam] = profileArgs[steam] or {}
    profileGrowth[steam] = profileGrowth[steam] or {}
    profileBaseFingerprint[steam] = profileBaseFingerprint[steam] or {}
    profileAppliedFingerprint[steam] = profileAppliedFingerprint[steam] or {}
    return profiles[steam], profileArgs[steam], profileGrowth[steam],
        profileBaseFingerprint[steam], profileAppliedFingerprint[steam]
end

local function objectAddress(object)
    if object == nil then return nil end
    local address
    pcall(function() address = object:GetAddress() end)
    if address == nil or address == 0 then return nil end
    return address
end

local function pawnGrowth(pawn)
    if pawn == nil then return nil end
    local growth
    pcall(function() growth = pawn:GetGrowth() end)
    growth = tonumber(growth)
    if growth == nil then return nil end
    if growth > 1.5 then growth = growth / 100 end
    return math.max(0, math.min(1, growth))
end

local function customizerFingerprint(pawn)
    if pawn == nil then return nil end
    local ok, cdata = pcall(function() return pawn.CustomizerData end)
    if not ok or cdata == nil then return nil end

    local parts = {}
    local function addScalar(value)
        local number = tonumber(value)
        if number == nil then
            table.insert(parts, "x")
        else
            table.insert(parts, string.format("%.4f", number))
        end
    end

    table.insert(parts, pawnClassName(pawn):lower())

    local female = false
    pcall(function() female = cdata.bIsFemale == true end)
    table.insert(parts, female and "F" or "M")

    local elderStacks
    pcall(function() elderStacks = pawn:GetElderReplicationStacks() end)
    addScalar(elderStacks)

    pcall(function() addScalar(cdata.PatternIndex) end)
    pcall(function() addScalar(cdata.ThemeIndex) end)
    pcall(function() addScalar(cdata.SkinVariation) end)

    for _, key in ipairs(COLOR_KEYS) do
        local field = FIELD_MAP[key]
        local color
        pcall(function() color = cdata[field] end)
        if color == nil then
            table.insert(parts, "missing:" .. tostring(field))
        else
            pcall(function() addScalar(color.R) end)
            pcall(function() addScalar(color.G) end)
            pcall(function() addScalar(color.B) end)
            pcall(function() addScalar(color.A) end)
        end
    end
    return table.concat(parts, "|")
end

local function fingerprintsMatch(left, right)
    return left ~= nil and right ~= nil and left == right
end

local function setProfile(steam, args, config, growth, baseFingerprint, appliedFingerprint)
    local key = profileSpeciesKey(config and config.species)
    if key == "" then return false end
    local bucket, argBucket, growthBucket, baseBucket, appliedBucket = ensureProfileBucket(steam)
    bucket[key] = config
    argBucket[key] = args
    if tonumber(growth) ~= nil then
        growthBucket[key] = math.max(0, math.min(1, tonumber(growth)))
    end
    if baseFingerprint ~= nil and baseFingerprint ~= "" then
        baseBucket[key] = baseFingerprint
    end
    if appliedFingerprint ~= nil and appliedFingerprint ~= "" then
        appliedBucket[key] = appliedFingerprint
    end
    return true
end

local function emitSkinLifecycleClear(steam, reason)
    local eventId = string.format("skin-life-%s-%d", tostring(steam), os.time())
    local line = string.format(
        '{"id":"%s","ts":%d,"verb":"skin_lifecycle","event":"cleared","steam":"%s","ok":true,"msg":"Skin life assignment cleared","reason":"%s","source":"SkinStudio"}',
        jsonEscape(eventId),
        os.time(),
        jsonEscape(steam),
        jsonEscape(reason or "new-life")
    )
    if not appendLine(RESULTS_FILE, line) then
        log("WARNING: could not emit skin lifecycle clear event steam=" .. tostring(steam))
        return false
    end
    return true
end

local function clearProfilesForSteam(steam, reason)
    if profiles[steam] == nil and profileArgs[steam] == nil and profileGrowth[steam] == nil then
        return false
    end
    profiles[steam] = nil
    profileArgs[steam] = nil
    profileGrowth[steam] = nil
    profileBaseFingerprint[steam] = nil
    profileAppliedFingerprint[steam] = nil
    fingerprintStability[steam] = nil
    pendingLiveRefresh[steam] = nil
    lastProfileSpecies[steam] = nil
    local clearReason = tostring(reason or "new-life")
    emitSkinLifecycleClear(steam, clearReason)
    log("Cleared persisted skin for new dinosaur life steam=" .. tostring(steam) .. " reason=" .. clearReason)
    return true
end

local function profileLine(steam, args, config, growth, baseFingerprint, appliedFingerprint)
    local parts = {}
    for i, token in ipairs(args or {}) do
        parts[i] = '"' .. jsonEscape(token) .. '"'
    end
    local growthField = ""
    if tonumber(growth) ~= nil then
        growthField = string.format(',"growth":%.6f', math.max(0, math.min(1, tonumber(growth))))
    end
    local baseField = baseFingerprint and baseFingerprint ~= ""
        and (',"baseFingerprint":"' .. jsonEscape(baseFingerprint) .. '"') or ""
    local appliedField = appliedFingerprint and appliedFingerprint ~= ""
        and (',"appliedFingerprint":"' .. jsonEscape(appliedFingerprint) .. '"') or ""
    return string.format(
        '{"steam":"%s","species":"%s"%s%s%s,"tokens":[%s]}',
        jsonEscape(steam),
        jsonEscape(config and config.species or ""),
        growthField,
        baseField,
        appliedField,
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
            local growth = profileGrowth[steam] and profileGrowth[steam][species] or nil
            local baseFingerprint = profileBaseFingerprint[steam] and profileBaseFingerprint[steam][species] or nil
            local appliedFingerprint = profileAppliedFingerprint[steam] and profileAppliedFingerprint[steam][species] or nil
            table.insert(lines, profileLine(steam, args, config, growth, baseFingerprint, appliedFingerprint))
        end
    end

    local body = table.concat(lines, "\n")
    if body ~= "" then body = body .. "\n" end
    return writeAll(PROFILES_PATH, body)
end

local function rememberProfile(steam, args, config, growth, baseFingerprint, appliedFingerprint)
    -- A skin follows one dinosaur life, not the player's account/species history.
    -- Applying a new skin replaces any older reconnect profile for this Steam ID.
    profiles[steam] = {}
    profileArgs[steam] = {}
    profileGrowth[steam] = {}
    profileBaseFingerprint[steam] = {}
    profileAppliedFingerprint[steam] = {}
    fingerprintStability[steam] = nil
    if not setProfile(steam, args, config, growth, baseFingerprint, appliedFingerprint) then return false end
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
    local legacySkipped = 0
    for line in string.gmatch(body .. "\n", "([^\r\n]+)\r?\n") do
        local steam = jsonReadString(line, "steam")
        local args = jsonReadStringArray(line, "tokens")
        local growth = jsonReadNumber(line, "growth")
        local baseFingerprint = jsonReadString(line, "baseFingerprint")
        local appliedFingerprint = jsonReadString(line, "appliedFingerprint")
        if steam and steam:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") then
            local config = parseTokens(args)
            if config ~= nil
                and growth ~= nil
                and baseFingerprint ~= nil and baseFingerprint ~= ""
                and appliedFingerprint ~= nil and appliedFingerprint ~= ""
                and setProfile(steam, args, config, growth, baseFingerprint, appliedFingerprint) then
                records = records + 1
            elseif config ~= nil then
                -- Profiles without both native/applied fingerprints cannot
                -- distinguish a reconnect from a later same-species dinosaur.
                legacySkipped = legacySkipped + 1
            end
        end
    end

    if legacySkipped > 0 then
        persistProfiles()
        log("Discarded " .. tostring(legacySkipped) .. " legacy skin profile(s) without safe life fingerprints")
    end

    local unique = 0
    for _, bucket in pairs(profiles) do
        for _, _ in pairs(bucket) do unique = unique + 1 end
    end
    log("Loaded " .. tostring(unique) .. " life-scoped skin profile(s) from " .. tostring(records) .. " record(s)")
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

local function currentPlayerPawn(steam)
    local gm = findGameMode()
    if gm == nil then return nil, nil, "Server not ready." end

    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return nil, nil, "You must be logged into the server." end

    local pawn = livePawnFromCtrl(ctrl)
    if pawn == nil then return ctrl, nil, "You need a live dinosaur in game." end
    return ctrl, pawn, nil
end

local function reusableBaseFingerprint(steam, pawn, currentFingerprint)
    for species, existingConfig in pairs(profiles[steam] or {}) do
        if profileSpeciesKey(existingConfig.species) == "universal" or speciesMatches(pawn, existingConfig.species) then
            local base = profileBaseFingerprint[steam] and profileBaseFingerprint[steam][species] or nil
            local applied = profileAppliedFingerprint[steam] and profileAppliedFingerprint[steam][species] or nil
            if fingerprintsMatch(currentFingerprint, base) or fingerprintsMatch(currentFingerprint, applied) then
                return base
            end
        end
    end
    return currentFingerprint
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

    local ctrl, pawn, pawnError = currentPlayerPawn(steam)
    if pawn == nil then
        emitResult(id, steam, false, pawnError or "You need a live dinosaur in game.")
        return
    end

    local beforeFingerprint = customizerFingerprint(pawn)
    if beforeFingerprint == nil then
        emitResult(id, steam, false, "Could not fingerprint the current dinosaur skin safely.")
        return
    end
    local baseFingerprint = reusableBaseFingerprint(steam, pawn, beforeFingerprint)

    local ok, msg = applyConfigToPawn(pawn, config)
    if ok then
        -- Persist the verified palette for this dinosaur life. Keep both the
        -- native pre-Wear fingerprint and the verified applied fingerprint:
        -- reconnect restoration only occurs after one of those known states is
        -- observed, preventing a later same-species dinosaur inheriting it.
        local appliedFingerprint = customizerFingerprint(pawn)
        local profileSaved = false
        if appliedFingerprint ~= nil then
            local growth = pawnGrowth(pawn)
            profileSaved = rememberProfile(
                steam, args, config, growth, baseFingerprint, appliedFingerprint
            )
            if not profileSaved then
                log("WARNING: live skin applied but reconnect profile could not be saved steam=" .. tostring(steam))
            end
            lastPawnAddress[steam] = objectAddress(pawn)
            lastControllerAddress[steam] = objectAddress(ctrl)
            lastProfileSpecies[steam] = profileSpeciesKey(config.species)
            hadPawnThisConnection[steam] = true
            pendingNewLife[steam] = false
        else
            log("WARNING: live skin applied but applied fingerprint could not be read steam=" .. tostring(steam))
        end
        pendingLiveRefresh[steam] = {
            config = config,
            remaining = LIVE_REFRESH_ATTEMPTS,
            pawnAddress = objectAddress(pawn),
            controllerAddress = objectAddress(ctrl),
        }
        if profileSaved then
            msg = "Skin applied, verified, and reconnect profile saved."
            safeNotify(steam, "Hollow Valley skin equipped: " .. tostring(config.preset ~= "" and config.preset or "custom skin"))
        else
            ok = false
            msg = "Skin applied live, but reconnect persistence could not be saved. Retry Wear Live."
            safeNotify(steam, "Skin applied live, but reconnect persistence failed. Please retry Wear Live.")
        end
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
    local universalConfig, universalSpecies = nil, nil
    for species, config in pairs(profiles[steam] or {}) do
        if profileSpeciesKey(config.species) == "universal" then
            universalConfig, universalSpecies = config, species
        elseif speciesMatches(pawn, config.species) then
            return config, species
        end
    end
    if universalConfig ~= nil then
        return universalConfig, universalSpecies
    end
    return nil, nil
end

local function reapplyProfiles()
    local gm = findGameMode()
    if gm == nil then return end

    local steamIds = {}
    for steam, _ in pairs(profiles) do table.insert(steamIds, steam) end
    table.sort(steamIds)

    local profilesChanged = false
    for _, steam in ipairs(steamIds) do
        local ctrl
        pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)

        if ctrl == nil then
            -- Full disconnect: preserve the life profile so the same dinosaur can
            -- regain its applied skin when the player reconnects.
            lastControllerAddress[steam] = nil
            lastPawnAddress[steam] = nil
            lastProfileSpecies[steam] = nil
            hadPawnThisConnection[steam] = nil
            pendingNewLife[steam] = nil
            fingerprintStability[steam] = nil
        else
            local ctrlAddr = objectAddress(ctrl)
            local previousCtrl = lastControllerAddress[steam]
            if ctrlAddr ~= nil and previousCtrl ~= nil and ctrlAddr ~= previousCtrl then
                -- New controller means a reconnect. Do not classify the next pawn as
                -- a new life solely because its object address changed.
                hadPawnThisConnection[steam] = false
                pendingNewLife[steam] = false
                lastPawnAddress[steam] = nil
                lastProfileSpecies[steam] = nil
                fingerprintStability[steam] = nil
            end
            if ctrlAddr ~= nil then lastControllerAddress[steam] = ctrlAddr end

            local pawn = livePawnFromCtrl(ctrl)
            if pawn == nil then
                -- The controller stayed connected but its dinosaur disappeared.
                -- The next pawn is a respawn/nest/new life, never a reconnect.
                if hadPawnThisConnection[steam] then
                    pendingNewLife[steam] = true
                end
                lastPawnAddress[steam] = nil
                lastProfileSpecies[steam] = nil
                fingerprintStability[steam] = nil
            else
                local addr = objectAddress(pawn)
                local config, speciesKey = matchingProfileForPawn(steam, pawn)
                local previousPawn = lastPawnAddress[steam]
                local changedPawnSameConnection =
                    hadPawnThisConnection[steam] == true
                    and previousPawn ~= nil
                    and addr ~= nil
                    and addr ~= previousPawn
                local isNewLife = pendingNewLife[steam] == true or changedPawnSameConnection
                local growth = pawnGrowth(pawn)
                local rememberedGrowth =
                    speciesKey ~= nil
                    and profileGrowth[steam] ~= nil
                    and tonumber(profileGrowth[steam][speciesKey])
                    or nil
                local growthReset =
                    growth ~= nil
                    and rememberedGrowth ~= nil
                    -- Hatchlings can reconnect around tiny growth values while
                    -- the server catches up its saved state. Do not classify a
                    -- nested baby as a new life from a small rollback alone.
                    and rememberedGrowth > BABY_GROWTH_RESET_FLOOR
                    and growth + NEW_LIFE_GROWTH_DROP < rememberedGrowth

                hadPawnThisConnection[steam] = true
                pendingNewLife[steam] = false

                if config ~= nil and (isNewLife or growthReset) then
                    local reason = isNewLife and "connected-respawn-or-nest" or "growth-reset"
                    if clearProfilesForSteam(steam, reason) then
                        profilesChanged = true
                    end
                    lastPawnAddress[steam] = addr
                    lastProfileSpecies[steam] = nil
                elseif config ~= nil then
                    local needsIdentityCheck =
                        addr ~= nil
                        and (addr ~= lastPawnAddress[steam] or speciesKey ~= lastProfileSpecies[steam])
                    local identityResolved = not needsIdentityCheck

                    if needsIdentityCheck then
                        local currentFingerprint = customizerFingerprint(pawn)
                        local baseFingerprint =
                            profileBaseFingerprint[steam] ~= nil
                            and profileBaseFingerprint[steam][speciesKey]
                            or nil
                        local appliedFingerprint =
                            profileAppliedFingerprint[steam] ~= nil
                            and profileAppliedFingerprint[steam][speciesKey]
                            or nil

                        if fingerprintsMatch(currentFingerprint, appliedFingerprint) then
                            -- Hot reload / mod restart while the same live pawn
                            -- still has the Hollow Valley skin. Do not repaint.
                            fingerprintStability[steam] = nil
                            lastPawnAddress[steam] = addr
                            lastProfileSpecies[steam] = speciesKey
                            identityResolved = true
                            log("Reconnect fingerprint already matches applied skin steam=" .. tostring(steam))
                        elseif fingerprintsMatch(currentFingerprint, baseFingerprint) then
                            -- EVRIMA has rebuilt the native SkinCode palette for
                            -- this same dinosaur. It is now safe to re-assert.
                            fingerprintStability[steam] = nil
                            local ok = applyConfigToPawn(pawn, config)
                            if ok then
                                local refreshedApplied = customizerFingerprint(pawn)
                                if refreshedApplied ~= nil
                                    and not fingerprintsMatch(refreshedApplied, appliedFingerprint) then
                                    profileAppliedFingerprint[steam] = profileAppliedFingerprint[steam] or {}
                                    profileAppliedFingerprint[steam][speciesKey] = refreshedApplied
                                    profilesChanged = true
                                end
                                lastPawnAddress[steam] = addr
                                lastProfileSpecies[steam] = speciesKey
                                identityResolved = true
                                pendingLiveRefresh[steam] = {
                                    config = config,
                                    remaining = LIVE_REFRESH_ATTEMPTS,
                                    pawnAddress = addr,
                                    controllerAddress = ctrlAddr,
                                }
                                safeNotify(steam, "Your Hollow Valley " .. tostring(config.species) .. " skin was restored.")
                            end
                        elseif currentFingerprint ~= nil then
                            -- Unknown native palette: wait for the same value on
                            -- multiple polls so ValidateAndSanitize / SkinCode
                            -- hydration can finish before declaring a new life.
                            local stable = fingerprintStability[steam]
                            if stable ~= nil
                                and stable.pawnAddress == addr
                                and stable.value == currentFingerprint then
                                stable.count = (tonumber(stable.count) or 0) + 1
                            else
                                stable = {
                                    pawnAddress = addr,
                                    value = currentFingerprint,
                                    count = 1,
                                }
                                fingerprintStability[steam] = stable
                            end

                            if stable.count >= RECONNECT_FINGERPRINT_STABLE_POLLS then
                                log(string.format(
                                    "Stable reconnect fingerprint mismatch steam=%s species=%s polls=%d; treating as different dinosaur life",
                                    tostring(steam), tostring(config.species), stable.count
                                ))
                                if clearProfilesForSteam(steam, "native-skin-fingerprint-mismatch") then
                                    profilesChanged = true
                                end
                                lastPawnAddress[steam] = addr
                                lastProfileSpecies[steam] = nil
                                identityResolved = true
                            else
                                log(string.format(
                                    "Waiting for native skin fingerprint to settle steam=%s species=%s poll=%d/%d",
                                    tostring(steam),
                                    tostring(config.species),
                                    stable.count,
                                    RECONNECT_FINGERPRINT_STABLE_POLLS
                                ))
                            end
                        end
                    else
                        lastPawnAddress[steam] = addr
                    end

                    if identityResolved and profiles[steam] ~= nil and growth ~= nil and speciesKey ~= nil then
                        local prior = tonumber(profileGrowth[steam] and profileGrowth[steam][speciesKey])
                        if prior == nil or growth >= prior + PROFILE_GROWTH_PERSIST_STEP then
                            profileGrowth[steam] = profileGrowth[steam] or {}
                            profileGrowth[steam][speciesKey] = growth
                            profilesChanged = true
                        end
                    end
                else
                    lastPawnAddress[steam] = addr
                    lastProfileSpecies[steam] = nil
                end
            end
        end
    end

    if profilesChanged and not persistProfiles() then
        log("WARNING: could not persist life-scoped skin profiles")
    end
end

local function refreshLiveApplies()
    local gm = findGameMode()
    for steam, state in pairs(pendingLiveRefresh) do
        if state == nil or state.config == nil or (tonumber(state.remaining) or 0) <= 0 then
            pendingLiveRefresh[steam] = nil
        elseif gm == nil then
            pendingLiveRefresh[steam] = nil
        else
            local ctrl
            pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
            local pawn = livePawnFromCtrl(ctrl)
            local ctrlAddr = objectAddress(ctrl)
            local pawnAddr = objectAddress(pawn)

            if pawn == nil
                or (state.pawnAddress ~= nil and pawnAddr ~= state.pawnAddress)
                or (state.controllerAddress ~= nil and ctrlAddr ~= state.controllerAddress) then
                -- Never let a delayed refresh write cross a pawn/controller boundary.
                -- A new hatchling/respawn keeps its game-generated inherited skin.
                log("Cancelled live skin refresh after dinosaur life changed steam=" .. tostring(steam))
                pendingLiveRefresh[steam] = nil
            else
                local ok, msg = applyConfigToPawn(pawn, state.config)
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
end

local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then log(label .. " failed: " .. tostring(err)) end
end

log(string.format("Loading; version=%s saved=%s", MOD_VERSION, tostring(SAVED_DIR)))
ensureDir(SAVED_DIR)

-- Load only life-scoped profiles with native + applied skin fingerprints.
-- Older records are discarded so v012 never revives a same-species profile
-- onto an unidentified later dinosaur life.
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

    -- Restore a remembered skin only when the life-scoped checks still match.
    -- refreshLiveApplies then repeats the write briefly so EVRIMA validation /
    -- sanitization cannot immediately replace the restored palette.
    LoopInGameThreadWithDelay(REAPPLY_INTERVAL_MS, function()
        safeCall("reapplyProfiles", reapplyProfiles)
    end)

    LoopInGameThreadWithDelay(LIVE_REFRESH_INTERVAL_MS, function()
        safeCall("refreshLiveApplies", refreshLiveApplies)
    end)

    log("Poll, life-scoped reconnect restore and delayed verification loops registered")
else
    log("ERROR: LoopInGameThreadWithDelay is unavailable")
end

log(string.format("Loaded; version=%s", MOD_VERSION))
