-- HollowValleyCore v001-recovery
-- Hollow Valley / The Isle: EVRIMA / UE4SS Lua
--
-- Reconstructed from observed 23-24 Sep 2026 startup and event logs.
-- Read-only diagnostic watcher. It does not read/write dinosaur state,
-- associate a Steam ID with an actor, or feed CommandBridge/the website.
--
-- A newly constructed Pawn is NOT necessarily a player dinosaur: AI and
-- temporary game actors can also derive from Pawn.

local MOD_NAME = "HollowValleyCore"
local MOD_VERSION = "v001-recovery"

local WINDOW_SECONDS = 60
local MAX_CONTROLLER_LOGS_PER_WINDOW = 60
local MAX_PAWN_LOGS_PER_WINDOW = 120
local MAX_OBJECT_NAME_LENGTH = 320

local function log(message)
    print(string.format("[%s] %s\n", MOD_NAME, tostring(message)))
end

local function printable(value)
    local text = tostring(value or "unknown")
    text = text:gsub("[%c]", " ")
    if #text > MAX_OBJECT_NAME_LENGTH then
        text = text:sub(1, MAX_OBJECT_NAME_LENGTH) .. "..."
    end
    return text
end

-- Only the UObject's descriptive name is accessed. Never read reflected
-- fields or call game methods on an actor while it is being constructed.
local function describeObject(object)
    if object == nil then return "<nil>" end
    local ok, fullName = pcall(function() return object:GetFullName() end)
    if ok and fullName ~= nil and tostring(fullName) ~= "" then
        return printable(fullName)
    end
    return "<name unavailable>"
end

local function newBucket(maximum)
    return {
        windowStart = 0,
        observed = 0,
        logged = 0,
        suppressed = 0,
        maximum = maximum,
    }
end

local buckets = {
    controller = newBucket(MAX_CONTROLLER_LOGS_PER_WINDOW),
    pawn = newBucket(MAX_PAWN_LOGS_PER_WINDOW),
}

local function observe(bucketName, label, object)
    local bucket = buckets[bucketName]
    local now = os.time()

    if bucket.windowStart == 0 then
        bucket.windowStart = now
    elseif now < bucket.windowStart or now - bucket.windowStart >= WINDOW_SECONDS then
        if bucket.suppressed > 0 then
            log(string.format("%s: suppressed %d additional event(s) in previous window", label, bucket.suppressed))
        end
        bucket.windowStart = now
        bucket.observed = 0
        bucket.logged = 0
        bucket.suppressed = 0
    end

    bucket.observed = bucket.observed + 1
    if bucket.logged >= bucket.maximum then
        bucket.suppressed = bucket.suppressed + 1
        if bucket.suppressed == 1 then
            log(string.format("%s: rate limit reached (%d logs / %ds); further events temporarily suppressed", label, bucket.maximum, WINDOW_SECONDS))
        end
        return
    end

    bucket.logged = bucket.logged + 1
    log(string.format("%s: %s", label, describeObject(object)))
end

local function registerWatcher(classPath, bucketName, label)
    local ok, err = pcall(function()
        NotifyOnNewObject(classPath, function(object)
            local handled, message = pcall(observe, bucketName, label, object)
            if not handled then
                -- Do not let a formatting/observation error propagate into UE4SS.
                -- Errors are rare; the normal per-window limiter handles events.
                log(string.format("%s: watcher error: %s", label, printable(message)))
            end
            return false -- Keep this watcher registered.
        end)
    end)
    if not ok then
        log(string.format("ERROR registering %s watcher: %s", label, printable(err)))
        return false
    end
    log(string.format("Registered %s watcher (%s)", label, classPath))
    return true
end

log(string.format("Boot; version=%s readOnly=true", MOD_VERSION))
log("PlayerController/Pawn object watchers enabled; account/Steam ID lookup NOT implemented.")

local controllerRegistered = registerWatcher(
    "/Script/Engine.PlayerController", "controller", "NEW PLAYER CONTROLLER"
)
local pawnRegistered = registerWatcher(
    "/Script/Engine.Pawn", "pawn", "NEW PAWN"
)

if controllerRegistered and pawnRegistered then
    log("Object watchers registered.")
else
    log("ERROR: one or more object watchers failed to register; do not treat this build as verified.")
end
