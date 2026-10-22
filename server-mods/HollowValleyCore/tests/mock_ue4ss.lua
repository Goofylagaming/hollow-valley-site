-- Mock UE4SS tests. Run from folder root with Lua 5.4.
local notifications, output = {}, {}
local clock = 1792348800
local oldPrint = print
print = function(message) output[#output + 1] = tostring(message) end
os.time = function() return clock end
NotifyOnNewObject = function(path, callback)
    assert(notifications[path] == nil, "duplicate hook for " .. path)
    notifications[path] = callback
end

dofile("Scripts/main.lua")
local controller = notifications["/Script/Engine.PlayerController"]
local pawn = notifications["/Script/Engine.Pawn"]
assert(type(controller) == "function" and type(pawn) == "function", "watchers missing")

local object = { GetFullName = function() return "BlueprintGeneratedClass BP_TestPawn_C /Game/Test.Pawn_1" end }
assert(pawn(object) == false and controller(object) == false)
assert(pawn(nil) == false)
assert(pawn({ GetFullName = function() error("simulated failure") end }) == false)

local sawPawn, sawController, sawFallback = false, false, false
for _, line in ipairs(output) do
    if line:find("NEW PAWN: BlueprintGeneratedClass", 1, true) then sawPawn = true end
    if line:find("NEW PLAYER CONTROLLER: BlueprintGeneratedClass", 1, true) then sawController = true end
    if line:find("NEW PAWN: <name unavailable>", 1, true) then sawFallback = true end
end
assert(sawPawn and sawController and sawFallback, "messages missing")

for i = 1, 180 do assert(pawn(object) == false) end
local sawLimit = false
for _, line in ipairs(output) do
    if line:find("rate limit reached", 1, true) then sawLimit = true end
end
assert(sawLimit, "rate limiter did not trigger")
clock = clock + 61
assert(pawn(object) == false)
local sawSummary = false
for _, line in ipairs(output) do
    if line:find("suppressed", 1, true) then sawSummary = true end
end
assert(sawSummary, "suppression summary missing")
oldPrint("PASS: object watchers and error-safe rate-limited logging")
