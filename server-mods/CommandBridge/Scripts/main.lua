-- CommandBridge v003
-- IPC layer between external systems and server-side mods.
-- Supports local file input and HTTPS pull input; results can be POSTed back.

local MOD_NAME    = "CommandBridge"
local MOD_VERSION = "v003"

-- UE4SS does not guarantee that Lua mods run with the ue4ss directory as the
-- process working directory. Resolve paths from this script file so config,
-- queues and sub-mod inboxes always point at the real installed Mods tree.
local function resolveModRoot()
    local source = ""
    pcall(function() source = debug.getinfo(1, "S").source or "" end)
    if source:sub(1, 1) == "@" then source = source:sub(2) end
    source = source:gsub("\\", "/")
    return source:match("^(.*)/Scripts/[^/]+$")
end

local MOD_ROOT = resolveModRoot()
local MODS_ROOT = MOD_ROOT and MOD_ROOT:match("^(.*)/CommandBridge$") or nil
local SAVED_DIR      = MOD_ROOT and (MOD_ROOT .. "/Saved") or "Mods/CommandBridge/Saved"
local COMMANDS_FILE  = SAVED_DIR .. "/commands.ndjson"
local RESULTS_FILE   = SAVED_DIR .. "/results.ndjson"
local CONFIG_FILE    = SAVED_DIR .. "/config.json"
local RELOAD_FLAG    = SAVED_DIR .. "/reload.flag"

local POLL_INTERVAL_MS   = 1000
local INPUT_POLL_SECONDS = 2

local function log(msg)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(msg)))
end

-- ============================================================
-- File helpers
-- ============================================================

local function fileExists(path)
    local f = io.open(path, "rb")
    if f == nil then return false end
    f:close(); return true
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
    f:write(line); f:write("\n"); f:close()
    return true
end

local function consumeFlag(path)
    local f = io.open(path, "rb"); if f == nil then return nil end
    local body = f:read("*all") or ""; f:close()
    os.remove(path)
    body = body:gsub("^%s+", ""):gsub("%s+$", "")
    if body == "" then return nil end
    return body
end

local function ensureDir(path)
    -- Windows: mkdir creates all intermediate directories automatically.
    -- 2>nul suppresses the "already exists" error so this is always safe to call.
    local winPath = path:gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
end

-- ============================================================
-- JSON helpers (no external library)
-- ============================================================

local function jsonReadString(body, fieldName)
    return string.match(body or "", '"' .. fieldName .. '"%s*:%s*"([^"]*)"')
end

local function jsonReadNumber(body, fieldName)
    return tonumber(string.match(body or "", '"' .. fieldName .. '"%s*:%s*(-?%d+%.?%d*)'))
end

local function jsonReadBool(body, fieldName)
    local v = string.match(body or "", '"' .. fieldName .. '"%s*:%s*([%a]+)')
    if v == "true" then return true end
    if v == "false" then return false end
    return nil
end

local function jsonEscape(s)
    if s == nil then return "" end
    s = tostring(s)
    s = s:gsub("\\", "\\\\")
    s = s:gsub('"', '\\"')
    s = s:gsub("\n", "\\n")
    s = s:gsub("\r", "\\r")
    s = s:gsub("\t", "\\t")
    return s
end

-- Read a balanced-brace object from a JSON string at the given field.
-- Returns the raw {...} string including outer braces, or nil.
local function jsonReadObject(body, fieldName)
    local startPat = '"' .. fieldName .. '"%s*:%s*(%b{})'
    local m = string.match(body or "", startPat)
    return m
end

-- ============================================================
-- Presence registry (shared helpers)
-- ============================================================

local presenceRegistry = {}
local PRESENCE_EXPIRY_SEC = 180

local function presenceUpdate(steam)
    if steam == nil or steam == "" then return end
    local s = tostring(steam)
    if not presenceRegistry[s] then
        presenceRegistry[s] = { firstSeen = os.time() }
    end
    presenceRegistry[s].lastSeen = os.time()
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

local function presenceRegisterHook()
    local ok, err = pcall(function()
        RegisterHook("/Script/TheIsle.TIPlayerController:SetAdminCred", function(ctrlParam, _bool)
            local self_
            pcall(function() self_ = ctrlParam:get() end)
            if self_ == nil then return end
            local sId
            pcall(function() sId = self_:GetSteamId() end)
            if sId == nil then return end
            local steamStr
            pcall(function() steamStr = sId:ToString() end)
            if steamStr ~= nil and tostring(steamStr) ~= "" then
                presenceUpdate(steamStr)
            end
        end)
    end)
    if ok then log("Presence heartbeat hook registered")
    else log("Presence heartbeat hook FAILED: " .. tostring(err)) end
end

local function presenceStartRefreshTick()
    if LoopInGameThreadWithDelay == nil then return end
    LoopInGameThreadWithDelay(15000, function()
        local gm = findGameMode()
        if gm == nil then return end
        local now = os.time()
        for steam, _ in pairs(presenceRegistry) do
            local ctrl
            pcall(function() ctrl = gm:GetControllerBySteamId(steam) end)
            if ctrl == nil then
                presenceRegistry[steam] = nil
            else
                presenceRegistry[steam].lastSeen = now
            end
        end
    end)
    log("Presence refresh tick started")
end

-- ============================================================
-- Config
-- ============================================================

local config = {
    enabled          = true,
    inputPollSeconds = INPUT_POLL_SECONDS,
    inputMode        = "file",
    inputUrl         = "",
    inputAuthHeader  = "",
    resultUrl        = "",
}

local function loadConfig()
    local body = readAll(CONFIG_FILE)
    if body == nil then return end
    local enabled = jsonReadBool(body, "enabled")
    if enabled ~= nil then config.enabled = enabled end
    local ips = jsonReadNumber(body, "inputPollSeconds")
    if ips ~= nil then config.inputPollSeconds = ips end
    local mode = jsonReadString(body, "inputMode")
    if mode == "file" or mode == "http" then config.inputMode = mode end
    local inputUrl = jsonReadString(body, "inputUrl")
    if inputUrl ~= nil then config.inputUrl = inputUrl end
    local auth = jsonReadString(body, "inputAuthHeader")
    if auth ~= nil then config.inputAuthHeader = auth end
    local resultUrl = jsonReadString(body, "resultUrl")
    if resultUrl ~= nil then config.resultUrl = resultUrl end
    log(string.format("Config loaded; enabled=%s pollSec=%s inputMode=%s http=%s",
        tostring(config.enabled), tostring(config.inputPollSeconds), tostring(config.inputMode),
        tostring(config.inputUrl ~= "")))
end

local httpFetchBusy = false
local httpFetchedBody = nil
local httpLastErrorAt = 0
local forwardedResults = {}

local function shellSafe(value)
    value = tostring(value or "")
    if string.find(value, '["\r\n]') then return nil end
    return value
end

local function curlGet(url, authHeader)
    url = shellSafe(url)
    authHeader = shellSafe(authHeader)
    if url == nil or url == "" then return nil, "inputUrl is empty or unsafe" end
    if authHeader == nil then return nil, "inputAuthHeader is unsafe" end
    local cmd = 'curl.exe --silent --show-error --fail --connect-timeout 3 --max-time 8'
    if authHeader ~= "" then cmd = cmd .. ' -H "' .. authHeader .. '"' end
    cmd = cmd .. ' "' .. url .. '"'
    local pipe = io.popen(cmd, "r")
    if pipe == nil then return nil, "could not start curl.exe" end
    local body = pipe:read("*a") or ""
    local ok, _, code = pipe:close()
    if ok ~= true and ok ~= 0 then return nil, "curl.exe exited " .. tostring(code or "unknown") end
    return body, nil
end

local function postResultLine(line)
    if config.resultUrl == nil or config.resultUrl == "" then return end
    if ExecuteAsync == nil then
        if os.time() - httpLastErrorAt >= 30 then
            httpLastErrorAt = os.time()
            log("HTTP result POST unavailable: ExecuteAsync is missing")
        end
        return
    end
    local url = shellSafe(config.resultUrl)
    local authHeader = shellSafe(config.inputAuthHeader)
    if url == nil or authHeader == nil then return end
    local payload = tostring(line or "")
    ExecuteAsync(function()
        local suffix = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999))
        local bodyPath = SAVED_DIR .. "/http-result-" .. suffix .. ".json"
        local f = io.open(bodyPath, "wb")
        if f == nil then return end
        f:write(payload); f:close()
        local winBodyPath = bodyPath:gsub("/", "\\")
        local cmd = 'curl.exe --silent --show-error --fail --connect-timeout 3 --max-time 8 -X POST -H "Content-Type: application/json"'
        if authHeader ~= "" then cmd = cmd .. ' -H "' .. authHeader .. '"' end
        cmd = cmd .. ' --data-binary "@' .. winBodyPath .. '" "' .. url .. '" >nul'
        local ok = os.execute(cmd)
        os.remove(bodyPath)
        if ok ~= true and ok ~= 0 and os.time() - httpLastErrorAt >= 30 then
            httpLastErrorAt = os.time()
            log("HTTP result POST failed")
        end
    end)
end

-- ============================================================
-- Result emitter
-- ============================================================

local function emitResult(id, verb, steam, ok, msg)
    local line = string.format(
        '{"id":"%s","ts":%d,"verb":"%s","steam":"%s","ok":%s,"msg":"%s"}',
        jsonEscape(tostring(id or "")),
        os.time(),
        jsonEscape(tostring(verb or "")),
        jsonEscape(tostring(steam or "")),
        tostring(ok == true),
        jsonEscape(tostring(msg or ""))
    )
    appendLine(RESULTS_FILE, line)
    postResultLine(line)
end

-- ============================================================
-- Sub-mod inbox writer
-- ============================================================

local function writeToInbox(modName, cmdId, steam, tokens)
    local inboxPath = (MODS_ROOT and (MODS_ROOT .. "/" .. modName .. "/Saved/inbox.ndjson")) or ("Mods/" .. modName .. "/Saved/inbox.ndjson")
    local tokensJson = "["
    for i, t in ipairs(tokens) do
        if i > 1 then tokensJson = tokensJson .. "," end
        tokensJson = tokensJson .. '"' .. jsonEscape(t) .. '"'
    end
    tokensJson = tokensJson .. "]"
    local line = string.format(
        '{"id":"%s","ts":%d,"steam":"%s","args":%s}',
        jsonEscape(tostring(cmdId or "")),
        os.time(),
        jsonEscape(tostring(steam or "")),
        tokensJson
    )
    local ok = appendLine(inboxPath, line)
    if not ok then
        log(string.format("writeToInbox: failed to write to %s — does Mods/%s/Saved/ exist?", inboxPath, modName))
        return false, "inbox write failed — " .. modName .. "/Saved/ may not exist on disk"
    end
    return true, "queued"
end

-- For DinoStorage legacy cmd.flag format
local function writeToCmdFlag(cmdId, verb, steam, extraArgs)
    local flagPath = (MODS_ROOT and (MODS_ROOT .. "/DinoStorage/Saved/cmd.flag")) or "Mods/DinoStorage/Saved/cmd.flag"
    local line = string.format("[%s] %s %s", tostring(cmdId or ""), verb, tostring(steam))
    if extraArgs and extraArgs ~= "" then
        line = line .. " " .. extraArgs
    end
    local ok = appendLine(flagPath, line)
    if not ok then
        log("writeToCmdFlag: failed to write to " .. flagPath .. " — does Mods/DinoStorage/Saved/ exist?")
        return false, "cmd.flag write failed — create Mods/DinoStorage/Saved/ on the server"
    end
    return true, "queued"
end

-- ============================================================
-- Skin helper — parse customizer object from args
-- ============================================================

local SKIN_FIELD_ALIASES = {
    body       = "BodyColor",
    markings   = "MarkingsColor",
    marks      = "MarkingsColor",
    flank      = "FlankColor",
    underbelly = "UnderbellyColor",
    belly      = "UnderbellyColor",
    detail     = "Detail1Color",
    details    = "Detail1Color",
    detail1    = "Detail1Color",
    eyes       = "EyesColor",
    eye        = "EyesColor",
    breed      = "MaleDisplayColor",
    display    = "MaleDisplayColor",
    male       = "MaleDisplayColor",
}

local ALL_COLOR_FIELDS = {
    "BodyColor","MarkingsColor","FlankColor","UnderbellyColor",
    "Detail1Color","EyesColor","MaleDisplayColor"
}

local function applyCustomizerBulk(pawn, customizerObj)
    -- customizerObj is the raw JSON string of the customizer object
    local cdata
    local ok = pcall(function() cdata = pawn:GetCustomizerData() end)
    if not ok or cdata == nil then return false, "no customizer data" end

    for _, field in ipairs(ALL_COLOR_FIELDS) do
        local colorBlock = string.match(customizerObj, '"' .. field .. '"%s*:%s*(%b{})')
        if colorBlock then
            local r = tonumber(string.match(colorBlock, '"[rR]"%s*:%s*(-?%d+%.?%d*)')) or 0
            local g = tonumber(string.match(colorBlock, '"[gG]"%s*:%s*(-?%d+%.?%d*)')) or 0
            local b = tonumber(string.match(colorBlock, '"[bB]"%s*:%s*(-?%d+%.?%d*)')) or 0
            local a = tonumber(string.match(colorBlock, '"[aA]"%s*:%s*(-?%d+%.?%d*)')) or 1.0
            if r == 0 and g == 0 and b == 0 then r, g, b = 0.01, 0.01, 0.01 end
            pcall(function()
                cdata[field].R = r
                cdata[field].G = g
                cdata[field].B = b
                cdata[field].A = a
            end)
        end
    end

    local sv = tonumber(string.match(customizerObj, '"[Ss]kin[Vv]ariation"%s*:%s*(-?%d+%.?%d*)'))
    if sv ~= nil then pcall(function() cdata.SkinVariation = sv end) end
    local pi = tonumber(string.match(customizerObj, '"[Pp]attern[Ii]ndex"%s*:%s*(-?%d+)'))
    if pi ~= nil then pcall(function() cdata.PatternIndex = pi end) end

    local okSet = pcall(function() pawn:SetCustomizerData(cdata) end)
    return okSet, okSet and "ok" or "SetCustomizerData failed"
end

local function applySingleFieldSkin(pawn, fieldAlias, r, g, b, a)
    local field = SKIN_FIELD_ALIASES[string.lower(tostring(fieldAlias or ""))]
    if field == nil then return false, "unknown skin field" end
    local cdata
    local ok = pcall(function() cdata = pawn:GetCustomizerData() end)
    if not ok or cdata == nil then return false, "no customizer data" end
    local okSet = pcall(function()
        cdata[field].R = tonumber(r) or 0
        cdata[field].G = tonumber(g) or 0
        cdata[field].B = tonumber(b) or 0
        cdata[field].A = tonumber(a) or 1.0
        pawn:SetCustomizerData(cdata)
    end)
    return okSet, okSet and "ok" or "SetCustomizerData failed"
end

-- ============================================================
-- Dispatch helpers
-- ============================================================

local function splitWords(s)
    local out = {}
    for word in string.gmatch(tostring(s or ""), "%S+") do
        table.insert(out, word)
    end
    return out
end

local function getControllerBySteam(steam)
    local gm = findGameMode()
    if gm == nil then return nil end
    local ctrl
    pcall(function() ctrl = gm:GetControllerBySteamId(tostring(steam or "")) end)
    return ctrl
end

local function getPawnBySteam(steam)
    return livePawnFromCtrl(getControllerBySteam(steam))
end

local function dispatchCommand(id, verb, steam, argsRaw)
    local argsObj = argsRaw or "{}"
    local argsArray = string.match(argsObj, '"args"%s*:%s*(%b[])') or "[]"
    local args = {}
    for v in string.gmatch(argsArray, '"([^"]*)"') do table.insert(args, v) end

    if verb == "ping" then
        emitResult(id, verb, steam, true, "pong")
        return
    end

    if verb == "presence_check" then
        local rec = presenceRegistry[tostring(steam or "")]
        local now = os.time()
        local present = rec ~= nil and rec.lastSeen ~= nil and (now - rec.lastSeen) <= PRESENCE_EXPIRY_SEC
        emitResult(id, verb, steam, true, present and "online" or "offline")
        return
    end

    if verb == "skin_set" then
        local pawn = getPawnBySteam(steam)
        if pawn == nil then emitResult(id, verb, steam, false, "player not spawned") return end
        local customizer = jsonReadObject(argsObj, "customizer")
        if customizer ~= nil then
            local ok, msg = applyCustomizerBulk(pawn, customizer)
            emitResult(id, verb, steam, ok, msg)
            return
        end
        if #args >= 4 then
            local ok, msg = applySingleFieldSkin(pawn, args[1], args[2], args[3], args[4], args[5])
            emitResult(id, verb, steam, ok, msg)
            return
        end
        emitResult(id, verb, steam, false, "missing customizer or field args")
        return
    end

    local dinoVerbMap = {
        dino_store = "store",
        dino_redeem = "redeem",
        dino_delete = "delete",
        dino_list = "list",
    }
    local dv = dinoVerbMap[verb]
    if dv ~= nil then
        local extra = table.concat(args, " ")
        local ok, msg = writeToCmdFlag(id, dv, steam, extra)
        if not ok then emitResult(id, verb, steam, false, msg) end
        return
    end

    local bodyVerbMap = {
        bodydrop = true,
        body_drop = true,
        drop_body = true,
    }
    if bodyVerbMap[verb] then
        local ok, msg = writeToInbox("BodyDrop", id, steam, args)
        if not ok then emitResult(id, verb, steam, false, msg) end
        return
    end

    emitResult(id, verb, steam, false, "unknown verb")
end

-- ============================================================
-- NDJSON parsing
-- ============================================================

local function processInputBody(body)
    for line in string.gmatch(tostring(body or "") .. "\n", "([^\r\n]+)\r?\n") do
        local id = jsonReadString(line, "id")
        local verb = jsonReadString(line, "verb")
        local steam = jsonReadString(line, "steam")
        local argsRaw = jsonReadObject(line, "args") or "{}"
        if id ~= nil and verb ~= nil then
            dispatchCommand(id, verb, steam, argsRaw)
        else
            log("Ignoring malformed command line")
        end
    end
end

-- ============================================================
-- HTTP input polling
-- ============================================================

local function pollHttpInput()
    if config.inputUrl == nil or config.inputUrl == "" then return end
    if httpFetchedBody ~= nil then
        local body = httpFetchedBody
        httpFetchedBody = nil
        if body ~= "" then processInputBody(body) end
    end
    if httpFetchBusy then return end
    if ExecuteAsync == nil then
        if os.time() - httpLastErrorAt >= 30 then
            httpLastErrorAt = os.time()
            log("HTTP input unavailable: ExecuteAsync is missing")
        end
        return
    end
    httpFetchBusy = true
    ExecuteAsync(function()
        local body, err = curlGet(config.inputUrl, config.inputAuthHeader)
        if err ~= nil then
            if os.time() - httpLastErrorAt >= 30 then
                httpLastErrorAt = os.time()
                log("HTTP input poll failed: " .. tostring(err))
            end
        else
            httpFetchedBody = body
        end
        httpFetchBusy = false
    end)
end

-- ============================================================
-- Sub-mod result forwarding
-- ============================================================

local function forwardSubmodResults()
    if config.resultUrl == nil or config.resultUrl == "" then return end
    local body = readAll(RESULTS_FILE)
    if body == nil or body == "" then return end
    for line in string.gmatch(body .. "\n", "([^\r\n]+)\r?\n") do
        local id = jsonReadString(line, "id")
        if id ~= nil and not forwardedResults[id] then
            forwardedResults[id] = true
            postResultLine(line)
        end
    end
end

-- ============================================================
-- File input polling
-- ============================================================

local function pollFileInput()
    if not fileExists(COMMANDS_FILE) then return end
    local stash = COMMANDS_FILE .. ".processing"
    os.remove(stash)
    os.rename(COMMANDS_FILE, stash)
    local body = readAll(stash)
    if body == nil or body == "" then os.remove(stash); return end
    processInputBody(body)
    os.remove(stash)
end

local function pollInput()
    if config.enabled ~= true then return end
    if config.inputMode == "http" then pollHttpInput() else pollFileInput() end
end

-- ============================================================
-- Boot
-- ============================================================

local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then log(string.format("safeCall(%s) failed: %s", label, tostring(err))) end
    return ok, err
end

log(string.format("Loading; version=%s savedDir=%s", MOD_VERSION, SAVED_DIR))

presenceRegisterHook()
presenceStartRefreshTick()

if LoopInGameThreadWithDelay ~= nil then
    local bootHandle
    bootHandle = LoopInGameThreadWithDelay(5000, function()
        log(string.format("Boot; version=%s", MOD_VERSION))
        ensureDir(SAVED_DIR)
        local tf = io.open(SAVED_DIR .. "/.keep", "wb")
        if tf then tf:write(""); tf:close()
        else log("WARNING: cannot write to " .. SAVED_DIR .. " — directory creation may have failed!") end
        safeCall("loadConfig", loadConfig)
        if bootHandle ~= nil and CancelDelayedAction ~= nil then
            pcall(function() CancelDelayedAction(bootHandle) end)
        end
    end)

log("Registering command poll loop")

LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
    log("Poll tick")

    safeCall("pollInput", pollInput)
    safeCall("forwardSubmodResults", forwardSubmodResults)

    local reload = consumeFlag(RELOAD_FLAG)
    if reload ~= nil and RestartCurrentMod ~= nil then
        log(string.format("RELOAD; token=%s", reload))
        RestartCurrentMod()
    end
end)

log("Command poll loop registered")
end

log(string.format("Loaded; version=%s", MOD_VERSION))
