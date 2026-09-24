-- CommandBridge v006.3
-- Hollow Valley / HDS
-- Focus: local file bridge for DinoStorage and BodyDrop, with optional HTTP fallback.
--
-- This build probes several Wine/host launch paths and caches the first one that
-- can run curl. It never logs the configured authorization header.

local MOD_NAME = "CommandBridge"
local MOD_VERSION = "v006.3"

local function log(msg)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(msg)))
end

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
local MODS_ROOT = MOD_ROOT and MOD_ROOT:match("^(.*)/CommandBridge$") or nil
local SAVED_DIR = MOD_ROOT and (MOD_ROOT .. "/Saved") or "Mods/CommandBridge/Saved"
local COMMANDS_FILE = SAVED_DIR .. "/commands.ndjson"
local RESULTS_FILE = SAVED_DIR .. "/results.ndjson"
local CONFIG_FILE = SAVED_DIR .. "/config.json"
local RELOAD_FLAG = SAVED_DIR .. "/reload.flag"

local POLL_INTERVAL_MS = 1000

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

local function consumeFlag(path)
    local f = io.open(path, "rb")
    if f == nil then return nil end
    local body = f:read("*a") or ""
    f:close()
    os.remove(path)
    body = body:gsub("^%s+", ""):gsub("%s+$", "")
    if body == "" then return nil end
    return body
end

local function ensureDir(path)
    local winPath = tostring(path):gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
end

local function jsonReadString(body, field)
    return string.match(body or "", '"' .. field .. '"%s*:%s*"([^"]*)"')
end

local function jsonReadNumber(body, field)
    return tonumber(string.match(body or "", '"' .. field .. '"%s*:%s*(-?%d+%.?%d*)'))
end

local function jsonReadBool(body, field)
    local v = string.match(body or "", '"' .. field .. '"%s*:%s*([%a]+)')
    if v == "true" then return true end
    if v == "false" then return false end
    return nil
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

local function jsonReadStringArray(body, field)
    local out = {}
    local arrayBody = string.match(body or "", '"' .. field .. '"%s*:%s*(%b[])')
    if not arrayBody then return out end
    for v in string.gmatch(arrayBody, '"([^"]*)"') do
        table.insert(out, v)
    end
    return out
end

local config = {
    enabled = true,
    inputPollSeconds = 1,
    inputMode = "file",
    inputUrl = "",
    inputAuthHeader = "",
    resultUrl = "",
}

local function loadConfig()
    local body = readAll(CONFIG_FILE)
    if body == nil then
        log("Config missing: " .. CONFIG_FILE)
        return
    end

    local enabled = jsonReadBool(body, "enabled")
    if enabled ~= nil then config.enabled = enabled end

    local poll = jsonReadNumber(body, "inputPollSeconds")
    if poll ~= nil then config.inputPollSeconds = poll end

    local mode = jsonReadString(body, "inputMode")
    if mode == "file" or mode == "http" then config.inputMode = mode end

    local inputUrl = jsonReadString(body, "inputUrl")
    if inputUrl ~= nil then config.inputUrl = inputUrl end

    local auth = jsonReadString(body, "inputAuthHeader")
    if auth ~= nil then config.inputAuthHeader = auth end

    local resultUrl = jsonReadString(body, "resultUrl")
    if resultUrl ~= nil then config.resultUrl = resultUrl end

    log(string.format(
        "Config loaded; enabled=%s pollSec=%s inputMode=%s http=%s",
        tostring(config.enabled),
        tostring(config.inputPollSeconds),
        tostring(config.inputMode),
        tostring(config.inputUrl ~= "")
    ))
end

local function shellSafe(value)
    value = tostring(value or "")
    if value:find('[\r\n"]') then return nil end
    return value
end

-- Convert Wine's Z:/host/path form to the host Unix path.
local function toUnixPath(path)
    path = tostring(path or ""):gsub("\\", "/")
    local rest = path:match("^[Zz]:/(.*)$")
    if rest then return "/" .. rest end
    return path
end

local function commandSucceeded(ok, why, code)
    if ok == true or ok == 0 then return true end
    if type(ok) == "number" and ok == 0 then return true end
    if type(code) == "number" and code == 0 then return true end
    return false
end

local httpLastErrorAt = 0
local httpFetchBusy = false
local httpFetchedBody = nil
local lastHttpPollAt = 0
local forwardedResults = {}

-- Some hosted Windows/Wine environments expose different curl launch helpers.
-- Try a few safe candidates and remember the one
-- that actually creates curl's output file.
local curlLauncher = nil
local curlLauncherName = nil

local CURL_LAUNCHERS = {
    {
        name = "absolute-wine-cmd",
        build = function(args)
            return '"C:\\windows\\system32\\cmd.exe" /d /s /c start "" /unix /wait /b /usr/bin/curl ' .. args
        end,
    },
    {
        name = "wine-start-exe",
        build = function(args)
            return '"C:\\windows\\command\\start.exe" /unix /wait /b /usr/bin/curl ' .. args
        end,
    },
    {
        name = "wine-z-drive-curl",
        build = function(args)
            return '"Z:\\usr\\bin\\curl" ' .. args
        end,
    },
    {
        name = "host-absolute-curl",
        build = function(args)
            return '/usr/bin/curl ' .. args
        end,
    },
    {
        name = "curl-exe-fallback",
        build = function(args)
            return 'curl.exe ' .. args
        end,
    },
}

local function cleanDiagnostic(s)
    s = tostring(s or "")
    s = s:gsub("Authorization:%s*Bearer%s+[%w%._%-]+", "Authorization: Bearer [redacted]")
    s = s:gsub("[\r\n]+", " ")
    if #s > 240 then s = s:sub(1, 240) .. "..." end
    return s
end

local function runCurl(args, outputPath, errorPath)
    os.remove(outputPath)
    os.remove(errorPath)

    local unixErrorPath = toUnixPath(errorPath)

    local function attempt(entry)
        os.remove(outputPath)
        os.remove(errorPath)

        local cmd = entry.build(args .. ' 2>"' .. unixErrorPath .. '"')
        local ok, why, code = os.execute(cmd)

        if fileExists(outputPath) then
            local body = readAll(outputPath) or ""
            local errText = readAll(errorPath) or ""
            os.remove(outputPath)
            os.remove(errorPath)
            return true, body, errText, ok, why, code
        end

        local errText = readAll(errorPath) or ""
        os.remove(errorPath)
        return false, nil, errText, ok, why, code
    end

    if curlLauncher ~= nil then
        local madeOutput, body, errText, ok, why, code = attempt(curlLauncher)
        if madeOutput then
            return body, nil
        end

        log(string.format(
            "Cached HTTP launcher failed: %s execute=%s/%s/%s err=%s",
            tostring(curlLauncherName),
            tostring(ok), tostring(why), tostring(code),
            cleanDiagnostic(errText)
        ))
        curlLauncher = nil
        curlLauncherName = nil
    end

    local failures = {}

    for _, entry in ipairs(CURL_LAUNCHERS) do
        local madeOutput, body, errText, ok, why, code = attempt(entry)

        if madeOutput then
            curlLauncher = entry
            curlLauncherName = entry.name
            log("HTTP launcher selected: " .. entry.name)
            return body, nil
        end

        table.insert(
            failures,
            string.format(
                "%s=%s/%s/%s%s",
                entry.name,
                tostring(ok),
                tostring(why),
                tostring(code),
                errText ~= "" and (" err:" .. cleanDiagnostic(errText)) or ""
            )
        )
    end

    return nil, "no curl launcher worked; " .. table.concat(failures, " | ")
end

local function curlGet(url, authHeader)
    url = shellSafe(url)
    authHeader = shellSafe(authHeader)

    if url == nil or url == "" then
        return nil, "inputUrl is empty or unsafe"
    end
    if authHeader == nil then
        return nil, "inputAuthHeader is unsafe"
    end

    local suffix = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999))
    local outPath = SAVED_DIR .. "/http-input-" .. suffix .. ".tmp"
    local errPath = SAVED_DIR .. "/http-input-" .. suffix .. ".err"
    local unixOutPath = toUnixPath(outPath)

    local args = '--silent --show-error --fail --connect-timeout 3 --max-time 8'
    if authHeader ~= "" then
        args = args .. ' -H "' .. authHeader .. '"'
    end
    args = args .. ' --output "' .. unixOutPath .. '" "' .. url .. '"'

    local body, err = runCurl(args, outPath, errPath)
    if err ~= nil then return nil, err end
    return body or "", nil
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

    if url == nil or authHeader == nil then
        return
    end

    local payload = tostring(line or "")

    ExecuteAsync(function()
        local suffix = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999))
        local bodyPath = SAVED_DIR .. "/http-result-" .. suffix .. ".json"
        local responsePath = SAVED_DIR .. "/http-result-response-" .. suffix .. ".tmp"
        local errorPath = SAVED_DIR .. "/http-result-response-" .. suffix .. ".err"

        if not writeAll(bodyPath, payload) then
            log("HTTP result POST failed: could not write payload temp file")
            return
        end

        local unixBodyPath = toUnixPath(bodyPath)
        local unixResponsePath = toUnixPath(responsePath)

        local args = '--silent --show-error --fail --connect-timeout 3 --max-time 8 -X POST'
        args = args .. ' -H "Content-Type: application/json"'

        if authHeader ~= "" then
            args = args .. ' -H "' .. authHeader .. '"'
        end

        args = args .. ' --data-binary "@' .. unixBodyPath .. '"'
        args = args .. ' --output "' .. unixResponsePath .. '"'
        args = args .. ' "' .. url .. '"'

        local _, err = runCurl(args, responsePath, errorPath)

        os.remove(bodyPath)
        os.remove(responsePath)
        os.remove(errorPath)

        if err ~= nil and os.time() - httpLastErrorAt >= 15 then
            httpLastErrorAt = os.time()
            log("HTTP result POST failed: " .. tostring(err))
        end
    end)
end

local function emitResult(id, verb, steam, ok, msg)
    local line = string.format(
        '{"id":"%s","ts":%d,"verb":"%s","steam":"%s","ok":%s,"msg":"%s"}',
        jsonEscape(id),
        os.time(),
        jsonEscape(verb),
        jsonEscape(steam),
        tostring(ok == true),
        jsonEscape(msg)
    )

    appendLine(RESULTS_FILE, line)
    if id and id ~= "" then forwardedResults[id] = true end
    postResultLine(line)
end

local function writeToCmdFlag(cmdId, verb, steam, extraArgs)
    local flagPath =
        (MODS_ROOT and (MODS_ROOT .. "/DinoStorage/Saved/cmd.flag"))
        or "Mods/DinoStorage/Saved/cmd.flag"

    local line = string.format("[%s] %s %s", tostring(cmdId or ""), verb, tostring(steam or ""))
    if extraArgs and extraArgs ~= "" then
        line = line .. " " .. extraArgs
    end

    local ok = appendLine(flagPath, line)
    if not ok then
        log("DinoStorage cmd.flag write failed: " .. flagPath)
        return false, "DinoStorage cmd.flag write failed"
    end

    log(string.format("Queued DinoStorage command id=%s verb=%s steam=%s", tostring(cmdId), tostring(verb), tostring(steam)))
    return true, "queued"
end

local function writeToBodyDropInbox(cmdId, steam, args)
    local inboxPath =
        (MODS_ROOT and (MODS_ROOT .. "/BodyDrop/Saved/inbox.ndjson"))
        or "Mods/BodyDrop/Saved/inbox.ndjson"

    local tokensJson = "["
    for i, token in ipairs(args or {}) do
        if i > 1 then tokensJson = tokensJson .. "," end
        tokensJson = tokensJson .. '"' .. jsonEscape(token) .. '"'
    end
    tokensJson = tokensJson .. "]"

    local line = string.format(
        '{"id":"%s","ts":%d,"steam":"%s","args":%s}',
        jsonEscape(cmdId),
        os.time(),
        jsonEscape(steam),
        tokensJson
    )

    local ok = appendLine(inboxPath, line)
    if not ok then
        log("BodyDrop inbox write failed: " .. inboxPath)
        return false, "BodyDrop inbox write failed"
    end

    log(string.format("Queued BodyDrop command id=%s steam=%s", tostring(cmdId), tostring(steam)))
    return true, "queued"
end

local function writeToSkinStudioInbox(cmdId, steam, args)
    local inboxPath =
        (MODS_ROOT and (MODS_ROOT .. "/SkinStudio/Saved/inbox.ndjson"))
        or "Mods/SkinStudio/Saved/inbox.ndjson"

    local tokensJson = "["
    for i, token in ipairs(args or {}) do
        if i > 1 then tokensJson = tokensJson .. "," end
        tokensJson = tokensJson .. '"' .. jsonEscape(token) .. '"'
    end
    tokensJson = tokensJson .. "]"

    local line = string.format(
        '{"id":"%s","ts":%d,"steam":"%s","args":%s}',
        jsonEscape(cmdId),
        os.time(),
        jsonEscape(steam),
        tokensJson
    )

    local ok = appendLine(inboxPath, line)
    if not ok then
        log("SkinStudio inbox write failed: " .. inboxPath)
        return false, "SkinStudio inbox write failed"
    end

    log(string.format("Queued SkinStudio command id=%s steam=%s", tostring(cmdId), tostring(steam)))
    return true, "queued"
end

local function dispatchCommand(id, verb, steam, args)
    args = args or {}

    if verb == "ping" then
        emitResult(id, verb, steam, true, "pong")
        return
    end

    local dinoVerbMap = {
        dino_store = "store",
        dino_retrieve = "retrieve",
        dino_redeem = "retrieve",
        dino_delete = "delete",
        dino_list = "list",
        dino_grant = "grant",
        dino_edit = "edit",
    }

    local dinoVerb = dinoVerbMap[verb]
    if dinoVerb ~= nil then
        local extra = table.concat(args, " ")
        local ok, msg = writeToCmdFlag(id, dinoVerb, steam, extra)
        if not ok then
            emitResult(id, verb, steam, false, msg)
        end
        return
    end

    if verb == "bd" then
        local ok, msg = writeToBodyDropInbox(id, steam, args)
        if not ok then
            emitResult(id, verb, steam, false, msg)
        end
        return
    end

    if verb == "skin_apply" then
        local ok, msg = writeToSkinStudioInbox(id, steam, args)
        if not ok then
            emitResult(id, verb, steam, false, msg)
        end
        return
    end

    emitResult(id, verb, steam, false, "unknown verb")
end

local function processInputBody(body)
    local count = 0

    for line in string.gmatch(tostring(body or "") .. "\n", "([^\r\n]+)\r?\n") do
        local id = jsonReadString(line, "id")
        local verb = jsonReadString(line, "verb")
        local steam = jsonReadString(line, "steam") or ""
        local args = jsonReadStringArray(line, "args")

        if id ~= nil and verb ~= nil then
            count = count + 1
            log(string.format("Command received id=%s verb=%s", tostring(id), tostring(verb)))
            dispatchCommand(id, verb, steam, args)
        else
            log("Ignoring malformed command line")
        end
    end

    return count
end

local function pollHttpInput()
    if config.inputUrl == nil or config.inputUrl == "" then return end

    if httpFetchedBody ~= nil then
        local body = httpFetchedBody
        httpFetchedBody = nil

        if body ~= "" then
            local count = processInputBody(body)
            if count > 0 then
                log("Processed " .. tostring(count) .. " HTTP command(s)")
            end
        end
    end

    if httpFetchBusy then return end

    local now = os.time()
    local interval = tonumber(config.inputPollSeconds) or 1
    if interval < 1 then interval = 1 end
    if now - lastHttpPollAt < interval then return end
    lastHttpPollAt = now

    if ExecuteAsync == nil then
        if now - httpLastErrorAt >= 30 then
            httpLastErrorAt = now
            log("HTTP input unavailable: ExecuteAsync is missing")
        end
        return
    end

    httpFetchBusy = true

    ExecuteAsync(function()
        local body, err = curlGet(config.inputUrl, config.inputAuthHeader)

        if err ~= nil then
            if os.time() - httpLastErrorAt >= 15 then
                httpLastErrorAt = os.time()
                log("HTTP input poll failed: " .. tostring(err))
            end
        else
            httpFetchedBody = body
        end

        httpFetchBusy = false
    end)
end

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

local function pollFileInput()
    if not fileExists(COMMANDS_FILE) then return end

    local stash = COMMANDS_FILE .. ".processing"
    os.remove(stash)

    local renamed = os.rename(COMMANDS_FILE, stash)
    if not renamed then return end

    local body = readAll(stash)
    if body ~= nil and body ~= "" then
        processInputBody(body)
    end

    os.remove(stash)
end

local function pollInput()
    if config.enabled ~= true then return end

    if config.inputMode == "http" then
        pollHttpInput()
    else
        pollFileInput()
    end
end

local function safeCall(label, fn)
    local ok, err = pcall(fn)
    if not ok then
        log(string.format("safeCall(%s) failed: %s", tostring(label), tostring(err)))
    end
    return ok, err
end

log(string.format("Loading; version=%s savedDir=%s", MOD_VERSION, SAVED_DIR))

if LoopInGameThreadWithDelay ~= nil then
    local bootHandle

    bootHandle = LoopInGameThreadWithDelay(5000, function()
        log(string.format("Boot; version=%s", MOD_VERSION))

        ensureDir(SAVED_DIR)

        local tf = io.open(SAVED_DIR .. "/.keep", "wb")
        if tf then
            tf:write("")
            tf:close()
        else
            log("WARNING: cannot write to " .. SAVED_DIR)
        end

        safeCall("loadConfig", loadConfig)

        if config.inputMode == "http" then
            log("Transport active: HTTP pull with multi-launcher probe")
        else
            log("Transport active: file queue")
        end

        if bootHandle ~= nil and CancelDelayedAction ~= nil then
            pcall(function()
                CancelDelayedAction(bootHandle)
            end)
        end
    end)

    log("Registering command poll loop")

    LoopInGameThreadWithDelay(POLL_INTERVAL_MS, function()
        safeCall("pollInput", pollInput)
        safeCall("forwardSubmodResults", forwardSubmodResults)

        local reload = consumeFlag(RELOAD_FLAG)
        if reload ~= nil then
            if RestartCurrentMod ~= nil then
                log("RELOAD; token=" .. tostring(reload))
                RestartCurrentMod()
            else
                log("RELOAD fallback; applying config in place; token=" .. tostring(reload))
                safeCall("reloadConfig", loadConfig)
            end
        end
    end)

    log("Command poll loop registered")
else
    log("ERROR: LoopInGameThreadWithDelay is unavailable")
end

log(string.format("Loaded; version=%s", MOD_VERSION))
