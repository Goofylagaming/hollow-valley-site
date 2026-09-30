-- SafeLogRecovery v001
-- Hollow Valley / HDS
--
-- Non-destructive EVRIMA safe-log insurance.
-- Captures a recovery snapshot when PrepareSafeLogout fires, then marks it
-- completed only when the Blueprint K2_OnLogout follows inside the safe-log
-- completion window. This mod NEVER kills, parks, destroys or despawns a pawn.
--
-- CommandBridge inbox actions:
--   get [completed|pending]
--   restore [completed|pending]
--   clear [completed|pending|both]

local MOD_NAME = "SafeLogRecovery"
local MOD_VERSION = "v001"

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
local MODS_ROOT = MOD_ROOT and MOD_ROOT:match("^(.*)/SafeLogRecovery$") or nil
local SAVED_DIR = MOD_ROOT and (MOD_ROOT .. "/Saved") or "Mods/SafeLogRecovery/Saved"
local COMPLETED_DIR = SAVED_DIR .. "/completed"
local PENDING_DIR = SAVED_DIR .. "/pending"
local INBOX_FILE = SAVED_DIR .. "/inbox.ndjson"
local RESULTS_FILE = (MODS_ROOT and (MODS_ROOT .. "/CommandBridge/Saved/results.ndjson"))
    or "Mods/CommandBridge/Saved/results.ndjson"

local POLL_INTERVAL_MS = 1000
local SAFELOG_COMPLETION_WINDOW_SEC = 75
local CAPTURE_RETRY_WINDOW_SEC = 15
local PREPARE_DEDUP_SEC = 4
local RESTORE_SETTLE_MS = 750

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

local function writeAllAtomic(path, body)
    local tmp = path .. ".tmp"
    local f = io.open(tmp, "wb")
    if f == nil then return false end
    f:write(body or "")
    f:close()
    os.remove(path)
    return os.rename(tmp, path)
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

local function jsonEscape(value)
    local s = tostring(value or "")
    s = s:gsub("\\", "\\\\")
    s = s:gsub('"', '\\"')
    s = s:gsub("\n", "\\n")
    s = s:gsub("\r", "\\r")
    s = s:gsub("\t", "\\t")
    return s
end

local function jsonReadString(body, key)
    return string.match(body or "", '"' .. key .. '"%s*:%s*"([^"]*)"')
end

local function jsonReadNumber(body, key)
    return tonumber(string.match(body or "", '"' .. key .. '"%s*:%s*(-?%d+%.?%d*)'))
end

local function jsonReadBool(body, key)
    local v = string.match(body or "", '"' .. key .. '"%s*:%s*([%a]+)')
    if v == "true" then return true end
    if v == "false" then return false end
    return nil
end

local function jsonReadStringArray(body, key)
    local out = {}
    local arrayBody = string.match(body or "", '"' .. key .. '"%s*:%s*(%b[])')
    if not arrayBody then return out end
    for value in arrayBody:gmatch('"([^"]*)"') do
        out[#out + 1] = value
    end
    return out
end

local function numStr(value, fmt)
    if value == nil then return "null" end
    return string.format(fmt or "%.6f", tonumber(value) or 0)
end

local function boolStr(value)
    return value == true and "true" or "false"
end

local function boolOrNull(value)
    if value == true then return "true" end
    if value == false then return "false" end
    return "null"
end

local function colorJson(color)
    if color == nil then return "null" end
    return string.format(
        '{"r":%.6f,"g":%.6f,"b":%.6f,"a":%.6f}',
        tonumber(color.r) or 0,
        tonumber(color.g) or 0,
        tonumber(color.b) or 0,
        tonumber(color.a) or 1
    )
end

local function validSteamId(steam)
    return type(steam) == "string" and steam:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") ~= nil
end

local function unwrapParam(param)
    if param == nil then return nil end
    local value = nil
    pcall(function() value = param:get() end)
    return value
end

local function controllerSteamId(ctrl)
    if ctrl == nil then return nil end
    local steamId = nil
    local steam = nil
    pcall(function() steamId = ctrl:GetSteamId() end)
    if steamId == nil then return nil end
    pcall(function() steam = steamId:ToString() end)
    steam = tostring(steam or "")
    if not validSteamId(steam) then return nil end
    return steam
end

local function findGameMode()
    local candidates = {"BP_SurvivalGameMode_C", "TISurvivalGameMode", "TIGameModeBase", "GameModeBase"}
    for _, name in ipairs(candidates) do
        local gm = nil
        pcall(function() gm = FindFirstOf(name) end)
        if gm ~= nil then return gm end
    end
    return nil
end

local function livePawnFromCtrl(ctrl)
    if ctrl == nil then return nil end
    local pawn = nil
    pcall(function() pawn = ctrl:K2_GetPawn() end)
    if pawn == nil then return nil end
    local addr = nil
    pcall(function() addr = pawn:GetAddress() end)
    if addr == nil or addr == 0 then return nil end
    return pawn
end

local pendingNotifies = {}

local function queueNotify(steam, msg)
    pendingNotifies[#pendingNotifies + 1] = { steam = tostring(steam or ""), msg = tostring(msg or "") }
end

local function drainNotifies()
    if #pendingNotifies == 0 then return end
    local gm = findGameMode()
    if gm == nil then return end
    local current = pendingNotifies
    pendingNotifies = {}
    for _, item in ipairs(current) do
        local ctrl = nil
        pcall(function() ctrl = gm:GetControllerBySteamId(item.steam) end)
        if ctrl ~= nil then
            local text = item.msg
            if FText ~= nil then
                local ok, ft = pcall(function() return FText(item.msg) end)
                if ok and ft ~= nil then text = ft end
            end
            pcall(function() ctrl:ClientShowNotification(text) end)
        end
    end
end

local function captureColor(cdata, field)
    if cdata == nil then return nil end
    local color = nil
    pcall(function() color = cdata[field] end)
    if color == nil then return nil end
    return { r = color.R, g = color.G, b = color.B, a = color.A }
end

local MUTATION_FIELDS = {
    "MutationSlot1", "MutationSlot2", "MutationSlot3", "MutationSlot4",
    "ParentMutationSlot1", "ParentMutationSlot2", "ParentMutationSlot3", "ParentMutationSlot4",
    "ElderMutationSlot1A", "ElderMutationSlot1B",
    "ElderMutationSlot2A", "ElderMutationSlot2B",
    "ElderMutationSlot3A", "ElderMutationSlot3B",
    "ElderMutationSlot4A", "ElderMutationSlot4B",
}

local function captureState(pawn)
    local state = { mutations = {}, unlockRequiredMutations = {} }

    pcall(function() state.growth = pawn:GetGrowth() end)
    pcall(function() state.health = pawn:GetHealth() end)
    pcall(function() state.stamina = pawn:GetStamina() end)
    pcall(function() state.hunger = pawn:GetHunger() end)
    pcall(function() state.thirst = pawn:GetThirst() end)
    pcall(function() state.oxygen = pawn:GetOxygen() end)
    pcall(function() state.blood = pawn:GetBlood() end)
    pcall(function() state.lockedDamage = pawn:GetLockedDamage() end)
    pcall(function() state.food = pawn:GetFoodValue() end)
    pcall(function() state.rottenValue = pawn:GetRottenValue() end)
    pcall(function() state.maxHunger = pawn:GetMaxHunger() end)
    pcall(function() state.maxThirst = pawn:GetMaxThirst() end)
    pcall(function() state.maxStamina = pawn:GetMaxStamina() end)
    pcall(function() state.maxFoodValue = pawn:GetMaxFoodValue() end)
    pcall(function() state.isFemale = pawn:IsFemale() end)
    pcall(function() state.elderStacks = pawn:GetElderReplicationStacks() end)

    local fullName = nil
    pcall(function() fullName = pawn:GetClass():GetFullName() end)
    if fullName ~= nil then
        state.classPath = string.match(fullName, "^%S+%s+(.+)$") or fullName
    end

    local prime = nil
    pcall(function() prime = pawn:GetEligiblePrimeElderData() end)
    if prime ~= nil then
        state.isPrime = prime.bIsEligiblePrime == true
        state.primeData = { eligible = prime.bIsEligiblePrime == true }
        for i = 1, 10 do
            state.primeData["cond" .. tostring(i)] = prime["bPrimeCondition" .. tostring(i)] == true
        end
    end

    local mutationData = nil
    pcall(function() mutationData = pawn.ReplicatedMutationsData end)
    if mutationData ~= nil then
        for _, field in ipairs(MUTATION_FIELDS) do
            local raw = nil
            local text = ""
            pcall(function() raw = mutationData[field] end)
            if raw ~= nil then pcall(function() text = raw:ToString() end) end
            if text == "None" then text = "" end
            state.mutations[field] = tostring(text or "")
        end
    end

    local mutationRequirements = nil
    pcall(function() mutationRequirements = pawn.MutationsRequirementsData end)
    if mutationRequirements ~= nil then
        local arr = nil
        pcall(function() arr = mutationRequirements.UnlockRequiredMutations end)
        if arr ~= nil then
            local count = 0
            pcall(function() count = #arr end)
            if type(count) == "number" then
                for i = 1, count do
                    local raw = nil
                    local text = nil
                    pcall(function() raw = arr[i] end)
                    if raw ~= nil then pcall(function() text = raw:ToString() end) end
                    if type(text) == "string" and text ~= "" and text ~= "None" then
                        state.unlockRequiredMutations[#state.unlockRequiredMutations + 1] = text
                    end
                end
            end
        end
    end

    local nutrients = nil
    pcall(function() nutrients = pawn.NutrientsStruct end)
    if nutrients ~= nil then
        state.nutrients = {
            carbValue = nutrients.CarbValue,
            proteinValue = nutrients.ProteinValue,
            lipidValue = nutrients.LipidValue,
            bonesValue = nutrients.BonesValue,
            cannibalValue = nutrients.CannibalValue,
            magyValue = nutrients.MagyValue,
            rottenFleshValue = nutrients.RottenFleshValue,
            mushroomsValue = nutrients.MushroomsValue,
            bMalnutrition = nutrients.bMalnutrition == true,
        }
    end

    local cdata = nil
    pcall(function() cdata = pawn.CustomizerData end)
    if cdata ~= nil then
        state.skin = {
            body = captureColor(cdata, "BodyColor"),
            markings = captureColor(cdata, "MarkingsColor"),
            flank = captureColor(cdata, "FlankColor"),
            underbelly = captureColor(cdata, "UnderbellyColor"),
            teeth = captureColor(cdata, "TeethColor"),
            mouth = captureColor(cdata, "MouthColor"),
            claws = captureColor(cdata, "ClawsColor"),
            detail1 = captureColor(cdata, "Detail1Color"),
            eyes = captureColor(cdata, "EyesColor"),
            maleDisplay = captureColor(cdata, "MaleDisplayColor"),
            skinVariation = cdata.SkinVariation,
            patternIndex = cdata.PatternIndex,
            themeIndex = cdata.ThemeIndex,
        }
    end

    local loc = nil
    pcall(function() loc = pawn:K2_GetActorLocation() end)
    if loc ~= nil then state.location = { x = loc.X, y = loc.Y, z = loc.Z } end

    state.capturedAt = os.time()
    return state
end

local function writeSnapshotJson(state, status, startedAt, completedAt)
    local mutations = state.mutations or {}
    local prime = state.primeData or {}
    local nutrients = state.nutrients or {}
    local skin = state.skin or {}
    local location = state.location or { x = 0, y = 0, z = 0 }

    local unlock = {}
    for _, name in ipairs(state.unlockRequiredMutations or {}) do
        unlock[#unlock + 1] = '"' .. jsonEscape(name) .. '"'
    end

    local mutationParts = {}
    for _, field in ipairs(MUTATION_FIELDS) do
        mutationParts[#mutationParts + 1] = string.format('    "%s": "%s"', field, jsonEscape(mutations[field] or ""))
    end

    local lines = {
        "{",
        '  "version": 1,',
        '  "recovery": {',
        string.format('    "status": "%s",', jsonEscape(status or "pending")),
        string.format('    "safeLogStartedAt": %d,', math.floor(tonumber(startedAt) or 0)),
        string.format('    "safeLogCompletedAt": %s', completedAt and tostring(math.floor(completedAt)) or "null"),
        '  },',
        string.format('  "capturedAt": %d,', math.floor(tonumber(state.capturedAt) or os.time())),
        string.format('  "classPath": "%s",', jsonEscape(state.classPath or "")),
        string.format('  "growth": %s,', numStr(state.growth)),
        string.format('  "health": %s,', numStr(state.health)),
        string.format('  "stamina": %s,', numStr(state.stamina)),
        string.format('  "hunger": %s,', numStr(state.hunger)),
        string.format('  "thirst": %s,', numStr(state.thirst)),
        string.format('  "oxygen": %s,', numStr(state.oxygen)),
        string.format('  "blood": %s,', numStr(state.blood)),
        string.format('  "lockedDamage": %s,', numStr(state.lockedDamage)),
        string.format('  "food": %s,', numStr(state.food)),
        string.format('  "rottenValue": %s,', numStr(state.rottenValue)),
        string.format('  "maxHunger": %s,', numStr(state.maxHunger)),
        string.format('  "maxThirst": %s,', numStr(state.maxThirst)),
        string.format('  "maxStamina": %s,', numStr(state.maxStamina)),
        string.format('  "maxFoodValue": %s,', numStr(state.maxFoodValue)),
        string.format('  "isFemale": %s,', boolOrNull(state.isFemale)),
        string.format('  "isPrime": %s,', boolOrNull(state.isPrime)),
        string.format('  "elderStacks": %s,', numStr(state.elderStacks, "%.0f")),
        string.format('  "unlockRequiredMutations": [%s],', table.concat(unlock, ",")),
        '  "primeData": {',
        string.format('    "eligible": %s,', boolStr(prime.eligible)),
        string.format('    "cond1": %s, "cond2": %s, "cond3": %s, "cond4": %s, "cond5": %s,',
            boolStr(prime.cond1), boolStr(prime.cond2), boolStr(prime.cond3), boolStr(prime.cond4), boolStr(prime.cond5)),
        string.format('    "cond6": %s, "cond7": %s, "cond8": %s, "cond9": %s, "cond10": %s',
            boolStr(prime.cond6), boolStr(prime.cond7), boolStr(prime.cond8), boolStr(prime.cond9), boolStr(prime.cond10)),
        '  },',
        '  "nutrients": {',
        string.format('    "carbValue": %s, "proteinValue": %s, "lipidValue": %s,',
            numStr(nutrients.carbValue), numStr(nutrients.proteinValue), numStr(nutrients.lipidValue)),
        string.format('    "bonesValue": %s, "cannibalValue": %s, "magyValue": %s,',
            numStr(nutrients.bonesValue), numStr(nutrients.cannibalValue), numStr(nutrients.magyValue)),
        string.format('    "rottenFleshValue": %s, "mushroomsValue": %s, "bMalnutrition": %s',
            numStr(nutrients.rottenFleshValue), numStr(nutrients.mushroomsValue), boolStr(nutrients.bMalnutrition)),
        '  },',
        '  "mutations": {',
        table.concat(mutationParts, ",\n"),
        '  },',
        '  "skin": {',
        string.format('    "body": %s,', colorJson(skin.body)),
        string.format('    "markings": %s,', colorJson(skin.markings)),
        string.format('    "flank": %s,', colorJson(skin.flank)),
        string.format('    "underbelly": %s,', colorJson(skin.underbelly)),
        string.format('    "teeth": %s,', colorJson(skin.teeth)),
        string.format('    "mouth": %s,', colorJson(skin.mouth)),
        string.format('    "claws": %s,', colorJson(skin.claws)),
        string.format('    "detail1": %s,', colorJson(skin.detail1)),
        string.format('    "eyes": %s,', colorJson(skin.eyes)),
        string.format('    "maleDisplay": %s,', colorJson(skin.maleDisplay)),
        string.format('    "skinVariation": %s,', numStr(skin.skinVariation)),
        string.format('    "patternIndex": %s,', numStr(skin.patternIndex, "%.0f")),
        string.format('    "themeIndex": %s', numStr(skin.themeIndex, "%.0f")),
        '  },',
        string.format('  "location": {"x":%.4f,"y":%.4f,"z":%.4f}',
            tonumber(location.x) or 0, tonumber(location.y) or 0, tonumber(location.z) or 0),
        "}",
    }
    return table.concat(lines, "\n")
end

local function parseColor(block, key)
    local colorBlock = string.match(block or "", '"' .. key .. '"%s*:%s*(%b{})')
    if colorBlock == nil then return nil end
    return {
        r = jsonReadNumber(colorBlock, "r") or 0,
        g = jsonReadNumber(colorBlock, "g") or 0,
        b = jsonReadNumber(colorBlock, "b") or 0,
        a = jsonReadNumber(colorBlock, "a") or 1,
    }
end

local function readSnapshot(body)
    if body == nil or body == "" then return nil, nil end
    local state = {
        classPath = jsonReadString(body, "classPath"),
        growth = jsonReadNumber(body, "growth"),
        health = jsonReadNumber(body, "health"),
        stamina = jsonReadNumber(body, "stamina"),
        hunger = jsonReadNumber(body, "hunger"),
        thirst = jsonReadNumber(body, "thirst"),
        oxygen = jsonReadNumber(body, "oxygen"),
        blood = jsonReadNumber(body, "blood"),
        lockedDamage = jsonReadNumber(body, "lockedDamage"),
        food = jsonReadNumber(body, "food"),
        rottenValue = jsonReadNumber(body, "rottenValue"),
        maxHunger = jsonReadNumber(body, "maxHunger"),
        maxThirst = jsonReadNumber(body, "maxThirst"),
        maxStamina = jsonReadNumber(body, "maxStamina"),
        maxFoodValue = jsonReadNumber(body, "maxFoodValue"),
        isFemale = jsonReadBool(body, "isFemale"),
        isPrime = jsonReadBool(body, "isPrime"),
        elderStacks = jsonReadNumber(body, "elderStacks"),
        capturedAt = jsonReadNumber(body, "capturedAt"),
        unlockRequiredMutations = jsonReadStringArray(body, "unlockRequiredMutations"),
        mutations = {},
    }

    local recoveryBlock = string.match(body, '"recovery"%s*:%s*(%b{})') or ""
    local meta = {
        status = jsonReadString(recoveryBlock, "status") or "pending",
        safeLogStartedAt = jsonReadNumber(recoveryBlock, "safeLogStartedAt"),
        safeLogCompletedAt = jsonReadNumber(recoveryBlock, "safeLogCompletedAt"),
    }

    local primeBlock = string.match(body, '"primeData"%s*:%s*(%b{})') or ""
    state.primeData = { eligible = jsonReadBool(primeBlock, "eligible") == true }
    for i = 1, 10 do
        state.primeData["cond" .. tostring(i)] = jsonReadBool(primeBlock, "cond" .. tostring(i)) == true
    end

    local nutrientBlock = string.match(body, '"nutrients"%s*:%s*(%b{})')
    if nutrientBlock ~= nil then
        state.nutrients = {
            carbValue = jsonReadNumber(nutrientBlock, "carbValue") or 0,
            proteinValue = jsonReadNumber(nutrientBlock, "proteinValue") or 0,
            lipidValue = jsonReadNumber(nutrientBlock, "lipidValue") or 0,
            bonesValue = jsonReadNumber(nutrientBlock, "bonesValue") or 0,
            cannibalValue = jsonReadNumber(nutrientBlock, "cannibalValue") or 0,
            magyValue = jsonReadNumber(nutrientBlock, "magyValue") or 0,
            rottenFleshValue = jsonReadNumber(nutrientBlock, "rottenFleshValue") or 0,
            mushroomsValue = jsonReadNumber(nutrientBlock, "mushroomsValue") or 0,
            bMalnutrition = jsonReadBool(nutrientBlock, "bMalnutrition") == true,
        }
    end

    local mutationBlock = string.match(body, '"mutations"%s*:%s*(%b{})') or ""
    for _, field in ipairs(MUTATION_FIELDS) do
        state.mutations[field] = jsonReadString(mutationBlock, field) or ""
    end

    local skinBlock = string.match(body, '"skin"%s*:%s*(%b{})')
    if skinBlock ~= nil then
        state.skin = {
            body = parseColor(skinBlock, "body"),
            markings = parseColor(skinBlock, "markings"),
            flank = parseColor(skinBlock, "flank"),
            underbelly = parseColor(skinBlock, "underbelly"),
            teeth = parseColor(skinBlock, "teeth"),
            mouth = parseColor(skinBlock, "mouth"),
            claws = parseColor(skinBlock, "claws"),
            detail1 = parseColor(skinBlock, "detail1"),
            eyes = parseColor(skinBlock, "eyes"),
            maleDisplay = parseColor(skinBlock, "maleDisplay"),
            skinVariation = jsonReadNumber(skinBlock, "skinVariation"),
            patternIndex = jsonReadNumber(skinBlock, "patternIndex"),
            themeIndex = jsonReadNumber(skinBlock, "themeIndex"),
        }
    end

    return state, meta
end

local function completedFile(steam)
    return COMPLETED_DIR .. "/" .. tostring(steam) .. ".json"
end

local function pendingFile(steam)
    return PENDING_DIR .. "/" .. tostring(steam) .. ".json"
end

local function loadRecord(steam, source)
    local path = source == "pending" and pendingFile(steam) or completedFile(steam)
    local body = readAll(path)
    if body == nil then return nil, nil, nil end
    local state, meta = readSnapshot(body)
    return state, meta, body
end

local function selectRecord(steam, requestedSource)
    if requestedSource == "completed" or requestedSource == "pending" then
        local state, meta, body = loadRecord(steam, requestedSource)
        return state, meta, body, requestedSource
    end

    local cState, cMeta, cBody = loadRecord(steam, "completed")
    local pState, pMeta, pBody = loadRecord(steam, "pending")
    if cState == nil then return pState, pMeta, pBody, pState and "pending" or nil end
    if pState == nil then return cState, cMeta, cBody, "completed" end
    if tonumber(pState.capturedAt or 0) > tonumber(cState.capturedAt or 0) then
        return pState, pMeta, pBody, "pending"
    end
    return cState, cMeta, cBody, "completed"
end

local function writePendingSnapshot(steam, state, startedAt)
    ensureDir(PENDING_DIR)
    return writeAllAtomic(pendingFile(steam), writeSnapshotJson(state, "pending", startedAt, nil))
end

local function completePendingSnapshot(steam, startedAt, completedAt)
    local state, meta = loadRecord(steam, "pending")
    if state == nil then return false, "pending snapshot not found" end
    local effectiveStarted = tonumber(meta and meta.safeLogStartedAt) or tonumber(startedAt) or 0
    ensureDir(COMPLETED_DIR)
    if not writeAllAtomic(completedFile(steam), writeSnapshotJson(state, "completed", effectiveStarted, completedAt)) then
        return false, "completed snapshot write failed"
    end
    os.remove(pendingFile(steam))
    return true, nil
end

local function applyColor(cdata, field, color)
    if cdata == nil or color == nil then return end
    pcall(function()
        cdata[field].R = color.r or 0
        cdata[field].G = color.g or 0
        cdata[field].B = color.b or 0
        cdata[field].A = color.a or 1
    end)
end

local function applyNutrients(pawn, state)
    if state.nutrients == nil then return end
    local live = nil
    pcall(function() live = pawn.NutrientsStruct end)
    if live == nil then return end
    local saved = state.nutrients
    pcall(function()
        live.CarbValue = saved.carbValue or 0
        live.ProteinValue = saved.proteinValue or 0
        live.LipidValue = saved.lipidValue or 0
        live.BonesValue = saved.bonesValue or 0
        live.CannibalValue = saved.cannibalValue or 0
        live.MagyValue = saved.magyValue or 0
        live.RottenFleshValue = saved.rottenFleshValue or 0
        live.MushroomsValue = saved.mushroomsValue or 0
        live.bMalnutrition = saved.bMalnutrition == true
        pawn:SetNutrientsStruct(live, true)
    end)
end

local function applyMutations(pawn, state)
    local saved = state.mutations or {}
    local live = nil
    pcall(function() live = pawn.ReplicatedMutationsData end)
    if live == nil then return end

    local written = 0
    for _, field in ipairs(MUTATION_FIELDS) do
        local name = saved[field]
        if type(name) == "string" and name ~= "" and name ~= "None" and not name:find('["\\]') then
            local okName, fname = pcall(function() return FName(name) end)
            if okName and fname ~= nil and type(fname) ~= "string" then
                local okWrite = pcall(function() live[field] = fname end)
                if okWrite then written = written + 1 end
            end
        end
    end
    if written > 0 then pcall(function() pawn:SetReplicatedMutationsData(live, true) end) end

    if state.unlockRequiredMutations and #state.unlockRequiredMutations > 0 then
        local requirements = nil
        pcall(function() requirements = pawn.MutationsRequirementsData end)
        if requirements ~= nil then
            local arr = nil
            pcall(function() arr = requirements.UnlockRequiredMutations end)
            if arr ~= nil then
                local count = 0
                pcall(function() count = #arr end)
                if type(count) ~= "number" then count = 0 end
                local existing = {}
                for i = 1, count do
                    local raw = nil
                    local text = nil
                    pcall(function() raw = arr[i] end)
                    if raw ~= nil then pcall(function() text = raw:ToString() end) end
                    if type(text) == "string" then existing[text] = true end
                end
                local added = 0
                for _, name in ipairs(state.unlockRequiredMutations) do
                    if not existing[name] then
                        local ok = pcall(function() arr[count + 1 + added] = FName(name) end)
                        if ok then added = added + 1 end
                    end
                end
                if added > 0 then pcall(function() pawn:SetMutationRequirementsData(requirements) end) end
            end
        end
    end
end

local function applyPrime(pawn, state)
    if state.primeData == nil and state.isPrime ~= true then return end
    local prime = nil
    pcall(function() prime = pawn:GetEligiblePrimeElderData() end)
    if prime == nil then return end
    local saved = state.primeData or {}
    for i = 1, 10 do
        prime["bPrimeCondition" .. tostring(i)] = state.isPrime == true or saved["cond" .. tostring(i)] == true
    end
    prime.bIsEligiblePrime = state.isPrime == true or saved.eligible == true
    pcall(function() pawn:SetEligiblePrimeElderData(prime) end)
end

local function applySkin(pawn, state)
    if state.skin == nil then return end
    local cdata = nil
    pcall(function() cdata = pawn.CustomizerData end)
    if cdata == nil then return end
    local skin = state.skin
    applyColor(cdata, "BodyColor", skin.body)
    applyColor(cdata, "MarkingsColor", skin.markings)
    applyColor(cdata, "FlankColor", skin.flank)
    applyColor(cdata, "UnderbellyColor", skin.underbelly)
    applyColor(cdata, "TeethColor", skin.teeth)
    applyColor(cdata, "MouthColor", skin.mouth)
    applyColor(cdata, "ClawsColor", skin.claws)
    applyColor(cdata, "Detail1Color", skin.detail1)
    applyColor(cdata, "EyesColor", skin.eyes)
    applyColor(cdata, "MaleDisplayColor", skin.maleDisplay)
    if skin.skinVariation ~= nil then pcall(function() cdata.SkinVariation = math.floor(skin.skinVariation) end) end
    if skin.patternIndex ~= nil and skin.patternIndex >= 0 then pcall(function() cdata.PatternIndex = math.floor(skin.patternIndex) end) end
    if skin.themeIndex ~= nil then pcall(function() cdata.ThemeIndex = math.floor(skin.themeIndex) end) end
end

local function applyVitals(pawn, state)
    local setters = {
        { "SetMaxHunger", state.maxHunger },
        { "SetMaxThirst", state.maxThirst },
        { "SetMaxStamina", state.maxStamina },
        { "SetMaxFoodValue", state.maxFoodValue },
        { "SetHealth", state.health },
        { "SetStamina", state.stamina },
        { "SetHunger", state.hunger },
        { "SetThirst", state.thirst },
        { "SetBlood", state.blood },
        { "SetLockedDamage", state.lockedDamage },
        { "SetFoodValue", state.food },
        { "SetRottenValue", state.rottenValue },
    }
    for _, entry in ipairs(setters) do
        local methodName = entry[1]
        local value = entry[2]
        if value ~= nil then
            pcall(function() pawn[methodName](pawn, value) end)
        end
    end
end

local function applyStateOnce(pawn, state)
    if state.growth ~= nil then pcall(function() pawn:SetGrowth(state.growth) end) end
    applyMutations(pawn, state)
    applyNutrients(pawn, state)
    applyPrime(pawn, state)
    if state.elderStacks ~= nil then
        pcall(function() pawn:SetElderReplicationStacks(math.floor(state.elderStacks)) end)
    end
    applySkin(pawn, state)
    applyVitals(pawn, state)
    pcall(function() pawn:ForceNetUpdate() end)
end

local function verifyRestoreTarget(steam, state)
    local gm = findGameMode()
    if gm == nil then return nil, "Server not ready." end
    local ctrl = nil
    pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
    if ctrl == nil then return nil, "Player must be connected before Safe Log recovery." end
    local pawn = livePawnFromCtrl(ctrl)
    if pawn == nil then return nil, "Player must spawn a live dinosaur before recovery." end

    local fullName = nil
    pcall(function() fullName = pawn:GetClass():GetFullName() end)
    local liveClass = fullName and (string.match(fullName, "^%S+%s+(.+)$") or fullName) or ""
    if state.classPath and state.classPath ~= "" and liveClass ~= state.classPath then
        return nil, "Species mismatch. Spawn the same species as the recovery snapshot first."
    end

    local liveFemale = nil
    pcall(function() liveFemale = pawn:IsFemale() end)
    if state.isFemale ~= nil and liveFemale ~= nil and state.isFemale ~= liveFemale then
        return nil, string.format("Gender mismatch. Spawn a %s dinosaur before recovery.", state.isFemale and "female" or "male")
    end

    return pawn, nil
end

local function restoreRecord(steam, source)
    local state, meta, _, actualSource = selectRecord(steam, source)
    if state == nil then return false, "No Safe Log recovery snapshot exists for this player." end

    local pawn, targetError = verifyRestoreTarget(steam, state)
    if pawn == nil then return false, targetError end

    applyStateOnce(pawn, state)

    if LoopInGameThreadWithDelay ~= nil then
        local handle = nil
        local steamSnap = tostring(steam)
        handle = LoopInGameThreadWithDelay(RESTORE_SETTLE_MS, function()
            if handle ~= nil and CancelDelayedAction ~= nil then
                pcall(function() CancelDelayedAction(handle) end)
            end
            local gm = findGameMode()
            if gm == nil then return end
            local ctrl = nil
            pcall(function() ctrl = gm:GetControllerBySteamId(steamSnap) end)
            if ctrl == nil then return end
            local live = livePawnFromCtrl(ctrl)
            if live == nil then return end
            applyStateOnce(live, state)
        end)
    end

    queueNotify(steam, "An admin restored your dinosaur from your Safe Log recovery snapshot.")
    local species = (state.classPath and state.classPath:match("BP_(.-)%.") or "dinosaur"):gsub("_C$", "")
    local growth = tonumber(state.growth) or 0
    return true, string.format(
        "%s Safe Log snapshot restored from %s (%0.f%% growth, captured %d). Snapshot retained until an admin clears it.",
        species, actualSource or (meta and meta.status) or "recovery", growth * 100, math.floor(tonumber(state.capturedAt) or 0)
    )
end

local safeLogIntents = {}
local pendingCaptures = {}
local pendingCompletions = {}

local function queueSafeLogCapture(steam)
    local now = os.time()
    local prior = safeLogIntents[steam]
    if prior and now - tonumber(prior.startedAt or 0) <= PREPARE_DEDUP_SEC then return end
    safeLogIntents[steam] = { startedAt = now }
    pendingCaptures[steam] = { startedAt = now, attempts = 0 }
    log(string.format("Safe Log prepare steam=%s", steam))
end

local function drainSafeLogCaptures()
    local now = os.time()
    for steam, item in pairs(pendingCaptures) do
        local gm = findGameMode()
        local ctrl = nil
        if gm ~= nil then pcall(function() ctrl = gm:GetControllerBySteamId(steam) end) end
        local pawn = livePawnFromCtrl(ctrl)
        if pawn ~= nil then
            local state = captureState(pawn)
            if state.classPath ~= nil and writePendingSnapshot(steam, state, item.startedAt) then
                log(string.format("Pending Safe Log snapshot captured steam=%s class=%s growth=%s", steam, tostring(state.classPath), tostring(state.growth)))
                pendingCaptures[steam] = nil
            else
                item.attempts = (item.attempts or 0) + 1
            end
        else
            item.attempts = (item.attempts or 0) + 1
        end

        if pendingCaptures[steam] ~= nil and now - tonumber(item.startedAt or now) > CAPTURE_RETRY_WINDOW_SEC then
            log(string.format("Safe Log capture expired without a live pawn steam=%s attempts=%d", steam, tonumber(item.attempts) or 0))
            pendingCaptures[steam] = nil
        end
    end
end

local function drainSafeLogCompletions()
    local now = os.time()
    for steam, item in pairs(pendingCompletions) do
        local ok, err = completePendingSnapshot(steam, item.startedAt, item.completedAt)
        if ok then
            log(string.format("Safe Log completed snapshot committed steam=%s", steam))
            pendingCompletions[steam] = nil
        elseif now - tonumber(item.completedAt or now) > 5 then
            log(string.format("Safe Log completion could not promote pending snapshot steam=%s error=%s", steam, tostring(err)))
            pendingCompletions[steam] = nil
        end
    end
end

local function registerSafeLogHooks()
    local okPrepare, prepareErr = pcall(function()
        RegisterHook("/Script/TheIsle.TIPlayerController:PrepareSafeLogout", function(ctrlParam)
            local ctrl = unwrapParam(ctrlParam)
            local steam = controllerSteamId(ctrl)
            if steam ~= nil then queueSafeLogCapture(steam) end
        end)
    end)
    if okPrepare then log("PrepareSafeLogout hook registered")
    else log("PrepareSafeLogout hook FAILED: " .. tostring(prepareErr)) end

    local okLogout, logoutErr = pcall(function()
        RegisterHook(
            "/Game/TheIsle/Core/GameModes/BP_SurvivalGameMode.BP_SurvivalGameMode_C:K2_OnLogout",
            function(_, exitingControllerParam)
                local ctrl = unwrapParam(exitingControllerParam)
                local steam = controllerSteamId(ctrl)
                if steam == nil then return end
                local now = os.time()
                local intent = safeLogIntents[steam]
                if intent ~= nil and now - tonumber(intent.startedAt or 0) <= SAFELOG_COMPLETION_WINDOW_SEC then
                    pendingCompletions[steam] = {
                        startedAt = intent.startedAt,
                        completedAt = now,
                    }
                    log(string.format("Safe Log completion correlated steam=%s age=%ds", steam, now - tonumber(intent.startedAt or now)))
                end
                safeLogIntents[steam] = nil
            end
        )
    end)
    if okLogout then log("Blueprint K2_OnLogout hook registered")
    else log("Blueprint K2_OnLogout hook FAILED: " .. tostring(logoutErr)) end
end

local function emitResult(id, steam, ok, msg)
    local line = string.format(
        '{"id":"%s","ts":%d,"source":"SafeLogRecovery","steam":"%s","ok":%s,"msg":"%s"}',
        jsonEscape(id), os.time(), jsonEscape(steam), tostring(ok == true), jsonEscape(msg)
    )
    appendLine(RESULTS_FILE, line)
end

local function processInbox()
    if not fileExists(INBOX_FILE) then return end
    local stash = INBOX_FILE .. ".processing"
    os.remove(stash)
    if not os.rename(INBOX_FILE, stash) then return end
    local body = readAll(stash) or ""

    for line in body:gmatch("[^\r\n]+") do
        local id = jsonReadString(line, "id") or ""
        local steam = jsonReadString(line, "steam") or ""
        local args = jsonReadStringArray(line, "args")
        local action = args[1] or "get"
        local source = args[2]
        local ok = false
        local msg = "unknown Safe Log recovery action"

        if not validSteamId(steam) then
            ok = false
            msg = "invalid Steam ID"
        elseif action == "get" then
            local _, _, snapshotBody, actualSource = selectRecord(steam, source)
            if snapshotBody == nil then
                ok = true
                msg = "null"
            else
                local injection = string.format(',\n  "recordSource": "%s"\n}', jsonEscape(actualSource or "unknown"))
                msg = snapshotBody:gsub("\n}$", injection)
                ok = true
            end
        elseif action == "restore" then
            if source ~= nil and source ~= "completed" and source ~= "pending" then
                ok = false
                msg = "source must be completed or pending"
            else
                ok, msg = restoreRecord(steam, source)
            end
        elseif action == "clear" then
            local target = source or "both"
            if target ~= "completed" and target ~= "pending" and target ~= "both" then
                ok = false
                msg = "source must be completed, pending or both"
            else
                local removed = 0
                if target == "completed" or target == "both" then
                    if fileExists(completedFile(steam)) and os.remove(completedFile(steam)) then removed = removed + 1 end
                end
                if target == "pending" or target == "both" then
                    if fileExists(pendingFile(steam)) and os.remove(pendingFile(steam)) then removed = removed + 1 end
                end
                ok = true
                msg = string.format("cleared %d Safe Log recovery snapshot(s)", removed)
            end
        end

        emitResult(id, steam, ok == true, msg)
    end

    os.remove(stash)
end

local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then log(string.format("safeCall(%s) failed: %s", tostring(label), tostring(err))) end
end

log(string.format("Loading; version=%s", MOD_VERSION))
registerSafeLogHooks()

if LoopInGameThreadWithDelay ~= nil then
    local bootHandle = nil
    bootHandle = LoopInGameThreadWithDelay(3000, function()
        ensureDir(SAVED_DIR)
        ensureDir(COMPLETED_DIR)
        ensureDir(PENDING_DIR)
        local probe = io.open(SAVED_DIR .. "/.keep", "wb")
        if probe then probe:write(""); probe:close()
        else log("WARNING: SafeLogRecovery Saved directory is not writable") end
        if bootHandle ~= nil and CancelDelayedAction ~= nil then
            pcall(function() CancelDelayedAction(bootHandle) end)
        end
        log(string.format("Boot; version=%s", MOD_VERSION))
    end)

    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
        safeCall("drainSafeLogCaptures", drainSafeLogCaptures)
        safeCall("drainSafeLogCompletions", drainSafeLogCompletions)
        safeCall("drainNotifies", drainNotifies)
        safeCall("processInbox", processInbox)
    end)
else
    log("ERROR: LoopInGameThreadWithDelay unavailable")
end

log(string.format("Loaded; version=%s", MOD_VERSION))
