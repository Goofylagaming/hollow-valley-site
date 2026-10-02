-- PrimePersistence v001
-- Hollow Valley / The Isle EVRIMA
--
-- Persists completed Prime condition flags across server restarts without
-- carrying them onto an obviously different dinosaur life.
--
-- Safety model:
--   * Tracks players by SteamID using the proven SetAdminCred heartbeat.
--   * Re-derives controller/pawn pointers each tick; never caches UObjects.
--   * Restores at most once per SteamID per server process.
--   * Restores only when species/class and growth closely match the saved dino.
--   * Merges saved true flags into the live struct; never clears live progress.
--   * A new/different dino overwrites the old snapshot instead of inheriting it.

local MOD_NAME = "PrimePersistence"
local MOD_VERSION = "v001"
local BOOT_STARTED_AT = os.time()
local POLL_INTERVAL_MS = 15000
local SNAPSHOT_INTERVAL_SEC = 60
local PRESENCE_EXPIRY_SEC = 180
local RESTORE_GROWTH_TOLERANCE = 0.04

local function log(msg)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(msg)))
end

local function resolveModRoot()
    local source = ""
    pcall(function() source = debug.getinfo(1, "S").source or "" end)
    if source:sub(1, 1) == "@" then source = source:sub(2) end
    source = source:gsub("\\", "/")
    return source:match("^(.*)/Scripts/[^/]+$")
end

local MOD_ROOT = resolveModRoot()
local SAVED_DIR = MOD_ROOT and (MOD_ROOT .. "/Saved") or "Mods/PrimePersistence/Saved"
local PLAYER_DIR = SAVED_DIR .. "/players"

local function ensureDir(path)
    local winPath = tostring(path):gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
end

local function readAll(path)
    local f = io.open(path, "rb")
    if f == nil then return nil end
    local body = f:read("*a")
    f:close()
    return body
end

local function writeAllAtomic(path, body)
    local tmp = path .. ".tmp"
    local f = io.open(tmp, "wb")
    if f == nil then return false end
    f:write(body or "")
    f:close()
    os.remove(path)
    return os.rename(tmp, path)
end

local function jsonEscape(value)
    local s = tostring(value or "")
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"')
    s = s:gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    return s
end

local function jsonString(body, key)
    return string.match(body or "", '"' .. key .. '"%s*:%s*"([^"]*)"')
end

local function jsonNumber(body, key)
    return tonumber(string.match(body or "", '"' .. key .. '"%s*:%s*(-?%d+%.?%d*)'))
end

local function jsonBool(body, key)
    local value = string.match(body or "", '"' .. key .. '"%s*:%s*([%a]+)')
    if value == "true" then return true end
    if value == "false" then return false end
    return nil
end

local function validSteamId(value)
    return type(value) == "string" and value:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") ~= nil
end

local function recordPath(steam)
    return PLAYER_DIR .. "/" .. tostring(steam) .. ".json"
end

local function readRecord(steam)
    local body = readAll(recordPath(steam))
    if body == nil or body == "" then return nil end
    local record = {
        steam = jsonString(body, "steam"),
        classPath = jsonString(body, "classPath"),
        growth = jsonNumber(body, "growth"),
        eligible = jsonBool(body, "eligible") == true,
        savedAt = jsonNumber(body, "savedAt") or 0,
        conditions = {},
    }
    for i = 1, 10 do
        record.conditions[i] = jsonBool(body, "cond" .. tostring(i)) == true
    end
    if record.steam ~= steam or not record.classPath or record.growth == nil then return nil end
    return record
end

local function serializeRecord(state, steam)
    local parts = {
        '{"version":1',
        ',"steam":"' .. jsonEscape(steam) .. '"',
        ',"classPath":"' .. jsonEscape(state.classPath or "") .. '"',
        ',"growth":' .. string.format("%.6f", tonumber(state.growth) or 0),
        ',"eligible":' .. tostring(state.eligible == true),
    }
    for i = 1, 10 do
        parts[#parts + 1] = ',"cond' .. tostring(i) .. '":' .. tostring(state.conditions[i] == true)
    end
    parts[#parts + 1] = ',"savedAt":' .. tostring(os.time()) .. '}'
    return table.concat(parts)
end

local function writeRecord(steam, state)
    ensureDir(SAVED_DIR)
    ensureDir(PLAYER_DIR)
    return writeAllAtomic(recordPath(steam), serializeRecord(state, steam))
end

local function findGameMode()
    local candidates = { "BP_SurvivalGameMode_C", "TISurvivalGameMode", "TIGameModeBase", "GameModeBase" }
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

local function capturePrimeState(pawn)
    if pawn == nil then return nil end

    local growth
    pcall(function() growth = pawn:GetGrowth() end)
    growth = tonumber(growth)
    if growth == nil then return nil end

    local fullName
    pcall(function() fullName = pawn:GetClass():GetFullName() end)
    if fullName == nil or tostring(fullName) == "" then return nil end
    local classPath = string.match(tostring(fullName), "^%S+%s+(.+)$") or tostring(fullName)

    local pe
    pcall(function() pe = pawn:GetEligiblePrimeElderData() end)
    if pe == nil then return nil end

    local state = {
        classPath = classPath,
        growth = growth,
        eligible = pe.bIsEligiblePrime == true,
        conditions = {},
    }
    for i = 1, 10 do
        state.conditions[i] = pe["bPrimeCondition" .. tostring(i)] == true
    end
    return state, pe
end

local function progressCount(state)
    if not state then return 0 end
    local count = 0
    for i = 1, 10 do
        if state.conditions[i] == true then count = count + 1 end
    end
    return count
end

local function sameDinoFingerprint(saved, current)
    if not saved or not current then return false end
    if saved.classPath ~= current.classPath then return false end
    local savedGrowth = tonumber(saved.growth)
    local currentGrowth = tonumber(current.growth)
    if savedGrowth == nil or currentGrowth == nil then return false end
    return math.abs(savedGrowth - currentGrowth) <= RESTORE_GROWTH_TOLERANCE
end

local function mergeSavedProgress(pawn, pe, saved, current)
    if not saved or not current or pe == nil then return false, "no-state" end
    local changed = false

    for i = 1, 10 do
        if saved.conditions[i] == true and current.conditions[i] ~= true then
            pe["bPrimeCondition" .. tostring(i)] = true
            changed = true
        end
    end

    if saved.eligible == true and current.eligible ~= true then
        pe.bIsEligiblePrime = true
        changed = true
    end

    if not changed then return false, "already-current" end

    local ok, err = pcall(function()
        pawn:SetEligiblePrimeElderData(pe)
        pcall(function() pawn:ForceNetUpdate() end)
    end)
    if not ok then return false, "apply-failed: " .. tostring(err) end
    return true, "restored"
end

local presenceRegistry = {}
local restoredThisBoot = {}
local lastSnapshotAt = {}
local lastSignature = {}

local function presenceUpdate(steam)
    if not validSteamId(steam) then return end
    local now = os.time()
    local entry = presenceRegistry[steam]
    if not entry then
        entry = { firstSeen = now, lastSeen = now }
        presenceRegistry[steam] = entry
    else
        entry.lastSeen = now
    end
end

local function registerPresenceHook()
    local ok, err = pcall(function()
        RegisterHook("/Script/TheIsle.TIPlayerController:SetAdminCred", function(ctrlParam, _)
            local ctrl
            pcall(function() ctrl = ctrlParam:get() end)
            if ctrl == nil then return end
            local steamObj
            pcall(function() steamObj = ctrl:GetSteamId() end)
            if steamObj == nil then return end
            local steam
            pcall(function() steam = steamObj:ToString() end)
            steam = tostring(steam or "")
            if validSteamId(steam) then presenceUpdate(steam) end
        end)
    end)
    if ok then
        log("Presence heartbeat hook registered")
    else
        log("Presence heartbeat hook FAILED: " .. tostring(err))
    end
end

local function stateSignature(state)
    if not state then return "" end
    local bits = {}
    for i = 1, 10 do bits[#bits + 1] = state.conditions[i] and "1" or "0" end
    return table.concat(bits) .. ":" .. (state.eligible and "1" or "0")
end

local function processPlayer(steam, entry, gm, now)
    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then
        if now - (entry.lastSeen or now) > PRESENCE_EXPIRY_SEC then
            presenceRegistry[steam] = nil
        end
        return
    end
    entry.lastSeen = now

    local pawn = livePawnFromCtrl(ctrl)
    if pawn == nil then return end

    -- Let replication settle before comparing a freshly-connected pawn to the
    -- previous process' snapshot.
    if not restoredThisBoot[steam] and now - (entry.firstSeen or now) < 20 then return end

    local current, pe = capturePrimeState(pawn)
    if current == nil or pe == nil then return end

    if not restoredThisBoot[steam] then
        local saved = readRecord(steam)
        local restored = false
        local reason = "no-saved-progress"

        if saved ~= nil and saved.savedAt < BOOT_STARTED_AT and (progressCount(saved) > 0 or saved.eligible) then
            if sameDinoFingerprint(saved, current) then
                restored, reason = mergeSavedProgress(pawn, pe, saved, current)
                if restored then
                    local refreshed = capturePrimeState(pawn)
                    if refreshed ~= nil then current = refreshed end
                    log(string.format(
                        "Restored Prime progress steam=%s conditions=%d eligible=%s growth=%.3f",
                        steam, progressCount(current), tostring(current.eligible), tonumber(current.growth) or 0
                    ))
                end
            else
                reason = "fingerprint-mismatch"
                log(string.format(
                    "Skipped stale Prime restore steam=%s savedClass=%s liveClass=%s savedGrowth=%.3f liveGrowth=%.3f",
                    steam,
                    tostring(saved.classPath), tostring(current.classPath),
                    tonumber(saved.growth) or 0, tonumber(current.growth) or 0
                ))
            end
        end

        restoredThisBoot[steam] = true
        lastSnapshotAt[steam] = 0
        lastSignature[steam] = nil
        if reason == "apply-failed" then
            log("Prime restore failed steam=" .. steam .. " reason=" .. tostring(reason))
        end
    end

    local signature = stateSignature(current)
    local due = now - (lastSnapshotAt[steam] or 0) >= SNAPSHOT_INTERVAL_SEC
    local changed = signature ~= lastSignature[steam]
    if due or changed then
        if writeRecord(steam, current) then
            lastSnapshotAt[steam] = now
            lastSignature[steam] = signature
        else
            log("Snapshot write failed steam=" .. steam)
        end
    end
end

local function startTick()
    if LoopInGameThreadWithDelay == nil then
        log("LoopInGameThreadWithDelay unavailable; persistence disabled")
        return
    end

    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
        local gm = findGameMode()
        if gm == nil then return end
        local now = os.time()
        for steam, entry in pairs(presenceRegistry) do
            pcall(function() processPlayer(steam, entry, gm, now) end)
        end
    end)
    log("Persistence tick started (15s poll, 60s snapshots)")
end

ensureDir(SAVED_DIR)
ensureDir(PLAYER_DIR)
registerPresenceHook()
startTick()
log(MOD_VERSION .. " loaded; boot=" .. tostring(BOOT_STARTED_AT))
