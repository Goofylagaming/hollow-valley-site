-- SkinStudio v010
-- Hollow Valley live skin application scoped to the CURRENT pawn only.
-- Saved Skin Shop/My Skins presets remain available on the website, but the
-- game-side mod never auto-restores an old applied skin onto a future pawn.
-- TemporarySkinData and bUseSkinPalette are intentionally never modified, so
-- a nested/new spawn keeps the game's own inherited/customizer seed instead
-- of the previous Skin Studio appearance.
-- Commands arrive from CommandBridge as inbox.ndjson records.

local MOD_NAME = "SkinStudio"
local MOD_VERSION = "v010"

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

-- v010 deliberately avoids TemporarySkinData. EVRIMA can reuse that transient
-- payload while constructing later pawns, which risks copying an old Skin
-- Studio appearance onto a respawn or nested hatchling.
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
        if pattern >= 0 then writeScalar("PatternIndex", pattern) end
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
local lastPawnAddress = {}
local lastControllerAddress = {}
local lastProfileSpecies = {}
local hadPawnThisConnection = {}
local pendingNewLife = {}
local pendingLiveRefresh = {}
local NEW_LIFE_GROWTH_DROP = 0.05
local PROFILE_GROWTH_PERSIST_STEP = 0.01

local function profileSpeciesKey(species)
    return tostring(species or ""):lower()
end

local function ensureProfileBucket(steam)
    profiles[steam] = profiles[steam] or {}
    profileArgs[steam] = profileArgs[steam] or {}
    profileGrowth[steam] = profileGrowth[steam] or {}
    return profiles[steam], profileArgs[steam], profileGrowth[steam]
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

local function setProfile(steam, args, config, growth)
    local key = profileSpeciesKey(config and config.species)
    if key == "" then return false end
    local bucket, argBucket, growthBucket = ensureProfileBucket(steam)
    bucket[key] = config
    argBucket[key] = args
    if tonumber(growth) ~= nil then
        growthBucket[key] = math.max(0, math.min(1, tonumber(growth)))
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
    pendingLiveRefresh[steam] = nil
    lastProfileSpecies[steam] = nil
    log("Cleared persisted skin for new dinosaur life steam=" .. tostring(steam) .. " reason=" .. tostring(reason or "new-life"))
    return true
end

local function profileLine(steam, args, config, growth)
    local parts = {}
    for i, token in ipairs(args or {}) do
        parts[i] = '"' .. jsonEscape(token) .. '"'
    end
    local growthField = ""
    if tonumber(growth) ~= nil then
        growthField = string.format(',"growth":%.6f', math.max(0, math.min(1, tonumber(growth))))
    end
    return string.format(
        '{"steam":"%s","species":"%s"%s,"tokens":[%s]}',
        jsonEscape(steam),
        jsonEscape(config and config.species or ""),
        growthField,
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
            table.insert(lines, profileLine(steam, args, config, growth))
        end
    end

    local body = table.concat(lines, "\n")
    if body ~= "" then body = body .. "\n" end
    return writeAll(PROFILES_PATH, body)
end

local function rememberProfile(steam, args, config, growth)
    -- A skin follows one dinosaur life, not the player's account/species history.
    -- Applying a new skin replaces any older reconnect profile for this Steam ID.
    profiles[steam] = {}
    profileArgs[steam] = {}
    profileGrowth[steam] = {}
    if not setProfile(steam, args, config, growth) then return false end
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
        if steam and steam:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") then
            local config = parseTokens(args)
            if config ~= nil and growth ~= nil and setProfile(steam, args, config, growth) then
                records = records + 1
            elseif config ~= nil and growth == nil then
                -- v007 profiles had no life marker, so they are unsafe to restore:
                -- a nested/new dinosaur of the same species could receive them.
                legacySkipped = legacySkipped + 1
            end
        end
    end

    if legacySkipped > 0 then
        persistProfiles()
        log("Discarded " .. tostring(legacySkipped) .. " legacy species profile(s) without a life marker")
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
        local gm = findGameMode()
        local ctrl = nil
        local pawn = nil
        if gm ~= nil then
            pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
            pawn = livePawnFromCtrl(ctrl)
        end
        -- v009 is current-pawn-only: never persist this applied skin as an
        -- automatic reconnect/respawn/nesting override.
        if pawn ~= nil then
            lastPawnAddress[steam] = objectAddress(pawn)
            lastControllerAddress[steam] = objectAddress(ctrl)
            lastProfileSpecies[steam] = profileSpeciesKey(config.species)
            hadPawnThisConnection[steam] = true
            pendingNewLife[steam] = false
        end
        pendingLiveRefresh[steam] = {
            config = config,
            remaining = LIVE_REFRESH_ATTEMPTS,
            pawnAddress = objectAddress(pawn),
            controllerAddress = objectAddress(ctrl),
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
                    if addr ~= nil and (addr ~= lastPawnAddress[steam] or speciesKey ~= lastProfileSpecies[steam]) then
                        local ok = applyConfigToPawn(pawn, config)
                        if ok then
                            lastPawnAddress[steam] = addr
                            lastProfileSpecies[steam] = speciesKey
                            safeNotify(steam, "Your Hollow Valley " .. tostring(config.species) .. " skin was restored.")
                        end
                    else
                        lastPawnAddress[steam] = addr
                    end

                    if growth ~= nil and speciesKey ~= nil then
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

-- v009 deliberately retires game-side auto-restore profiles. Website-owned
-- presets are unaffected; this file only held automatic in-game reapply state.
-- Removing it guarantees a fresh/nested pawn keeps the engine-generated skin.
if fileExists(PROFILES_PATH) then
    os.remove(PROFILES_PATH)
    log("Cleared legacy auto-restore profiles; skins are now current-pawn-only")
end

if LoopInGameThreadWithDelay ~= nil then
    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
        safeCall("pollInbox", pollInbox)
        local reload = consumeFlag(RELOAD_FLAG)
        if reload ~= nil and RestartCurrentMod ~= nil then
            log("Reload requested")
            RestartCurrentMod()
        end
    end)

    -- No reapplyProfiles loop in v009. A skin application is intentionally
    -- bound to the pawn that existed when the player clicked Wear.
    LoopInGameThreadWithDelay(LIVE_REFRESH_INTERVAL_MS, function()
        safeCall("refreshLiveApplies", refreshLiveApplies)
    end)

    log("Poll and current-pawn live-refresh loops registered; cross-pawn restore disabled")
else
    log("ERROR: LoopInGameThreadWithDelay is unavailable")
end

log(string.format("Loaded; version=%s", MOD_VERSION))
