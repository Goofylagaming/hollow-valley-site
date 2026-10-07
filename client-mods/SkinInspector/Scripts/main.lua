-- Hollow Valley SkinInspector v001
-- Client-side, read-only UE4SS inspector for the local EVRIMA dinosaur.
-- Hotkey: CTRL + ALT + F8
--
-- Safety rules:
-- * local player only; never enumerates other players
-- * no property writes, no ForceNetUpdate, no save-file edits
-- * does NOT touch FCustomizerDataBase.SkinCode (unsafe FString marshal surface)
-- * captures reflected customizer scalars/colors + mesh/material identity only

local MOD_VERSION = "001"
local MOD_ROOT = (MODS_ROOT and (MODS_ROOT .. "/SkinInspector")) or "Mods/SkinInspector"
local SAVED_DIR = MOD_ROOT .. "/Saved"
local CAPTURE_DIR = SAVED_DIR .. "/captures"
local captureCounter = 0

local COLOR_FIELDS = {
    {"body", "BodyColor"},
    {"markings", "MarkingsColor"},
    {"flank", "FlankColor"},
    {"underbelly", "UnderbellyColor"},
    {"detail", "Detail1Color"},
    {"eyes", "EyesColor"},
    {"teeth", "TeethColor"},
    {"mouth", "MouthColor"},
    {"claws", "ClawsColor"},
    {"maleDisplay", "MaleDisplayColor"},
}

local function log(message)
    print(string.format("[SkinInspector v%s] %s\n", MOD_VERSION, tostring(message)))
end

local function ensureDir(path)
    local winPath = tostring(path):gsub("/", "\\")
    os.execute('mkdir "' .. winPath .. '" 2>nul')
end

local function jsonEscape(value)
    return tostring(value or "")
        :gsub("\\", "\\\\")
        :gsub('"', '\\"')
        :gsub("\r", "\\r")
        :gsub("\n", "\\n")
        :gsub("\t", "\\t")
        :gsub("[%z\1-\31]", "")
end

local function isArray(value)
    if type(value) ~= "table" then return false end
    local count = 0
    local max = 0
    for key, _ in pairs(value) do
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then return false end
        count = count + 1
        if key > max then max = key end
    end
    return count == max
end

local function encodeJson(value)
    local kind = type(value)
    if value == nil then return "null" end
    if kind == "boolean" then return value and "true" or "false" end
    if kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then return "null" end
        return string.format("%.10g", value)
    end
    if kind == "string" then return '"' .. jsonEscape(value) .. '"' end
    if kind ~= "table" then return '"' .. jsonEscape(tostring(value)) .. '"' end

    local parts = {}
    if isArray(value) then
        for i = 1, #value do parts[#parts + 1] = encodeJson(value[i]) end
        return "[" .. table.concat(parts, ",") .. "]"
    end

    local keys = {}
    for key, _ in pairs(value) do keys[#keys + 1] = tostring(key) end
    table.sort(keys)
    for _, key in ipairs(keys) do
        parts[#parts + 1] = '"' .. jsonEscape(key) .. '":' .. encodeJson(value[key])
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function safeAddress(object)
    if object == nil then return nil end
    local address = nil
    pcall(function() address = object:GetAddress() end)
    if type(address) ~= "number" or address == 0 then return nil end
    return address
end

local function safeFullName(object)
    if safeAddress(object) == nil then return nil end
    local value = nil
    pcall(function() value = object:GetFullName() end)
    return value and tostring(value) or nil
end

local function safeClassName(object)
    if safeAddress(object) == nil then return nil end
    local cls = nil
    pcall(function() cls = object:GetClass() end)
    return safeFullName(cls)
end

local function safeFName(value)
    if value == nil then return nil end
    local result = nil
    pcall(function() result = value:ToString() end)
    if result ~= nil then return tostring(result) end
    return nil
end

local function colorSnapshot(struct, field)
    local color = nil
    local ok = pcall(function() color = struct[field] end)
    if not ok or color == nil then
        return { available = false }
    end

    local out = { available = true }
    pcall(function() out.r = tonumber(color.R) end)
    pcall(function() out.g = tonumber(color.G) end)
    pcall(function() out.b = tonumber(color.B) end)
    pcall(function() out.a = tonumber(color.A) end)
    return out
end

local function scalarSnapshot(struct, field)
    local value = nil
    local ok = pcall(function() value = struct[field] end)
    if not ok then return nil end
    if type(value) == "number" or type(value) == "boolean" or type(value) == "string" then
        return value
    end
    local name = safeFName(value)
    return name or tostring(value)
end

local function localPawn()
    local ctrl = nil
    local ok = pcall(function()
        if UEHelpers ~= nil and UEHelpers.GetPlayerController ~= nil then
            ctrl = UEHelpers:GetPlayerController()
        end
    end)
    if not ok or safeAddress(ctrl) == nil then
        return nil, nil, "Local PlayerController is not available yet."
    end

    local pawn = nil
    pcall(function() pawn = ctrl.Pawn end)
    if safeAddress(pawn) == nil then
        pcall(function() pawn = ctrl:K2_GetPawn() end)
    end
    if safeAddress(pawn) == nil then
        return ctrl, nil, "No live local dinosaur pawn is available."
    end
    return ctrl, pawn, nil
end

local function meshFromPawn(pawn)
    local mesh = nil
    pcall(function() mesh = pawn.Mesh end)
    if safeAddress(mesh) == nil then
        pcall(function() mesh = pawn:GetMesh() end)
    end
    if safeAddress(mesh) == nil then return nil end
    return mesh
end

local function skeletalAssetFromMesh(mesh)
    if safeAddress(mesh) == nil then return nil end
    local asset = nil
    pcall(function() asset = mesh.SkeletalMesh end)
    if safeAddress(asset) == nil then
        pcall(function() asset = mesh:GetSkeletalMeshAsset() end)
    end
    if safeAddress(asset) == nil then return nil end
    return asset
end

local function materialSlotNames(mesh)
    local names = {}
    if safeAddress(mesh) == nil then return names end

    local slots = nil
    local ok = pcall(function() slots = mesh:GetMaterialSlotNames() end)
    if not ok or slots == nil then return names end

    pcall(function()
        slots:ForEach(function(index, value)
            local text = safeFName(value)
            if text ~= nil then names[#names + 1] = text end
        end)
    end)
    return names
end

local function materialSnapshot(mesh)
    local out = {}
    if safeAddress(mesh) == nil then return out end

    local count = 0
    pcall(function() count = tonumber(mesh:GetNumMaterials()) or 0 end)
    count = math.max(0, math.min(64, count))

    local slotNames = materialSlotNames(mesh)
    for index = 0, count - 1 do
        local material = nil
        pcall(function() material = mesh:GetMaterial(index) end)
        out[#out + 1] = {
            index = index,
            slot = slotNames[index + 1],
            object = safeFullName(material),
            class = safeClassName(material),
            address = safeAddress(material),
        }
    end
    return out
end

local function speciesFromPawn(pawn)
    local fullName = safeFullName(pawn) or ""
    local class = safeClassName(pawn) or ""

    local source = class ~= "" and class or fullName
    local species = source:match("BP_([%w_]+)_C")
    if species ~= nil then return species end
    species = source:match("([%w_]+)_C")
    return species or "unknown"
end

local function customizerSnapshot(pawn)
    local customizer = nil
    local ok = pcall(function() customizer = pawn.CustomizerData end)
    if not ok or customizer == nil then
        return {
            available = false,
            note = "pawn.CustomizerData could not be read",
        }
    end

    local colors = {}
    for _, item in ipairs(COLOR_FIELDS) do
        colors[item[1]] = colorSnapshot(customizer, item[2])
    end

    return {
        available = true,
        female = scalarSnapshot(customizer, "bIsFemale"),
        patternIndex = scalarSnapshot(customizer, "PatternIndex"),
        themeIndex = scalarSnapshot(customizer, "ThemeIndex"),
        skinVariation = scalarSnapshot(customizer, "SkinVariation"),
        colors = colors,
        note = "SkinCode intentionally not inspected; it is an unsafe FString marshaling surface in current UE4SS/EVRIMA.",
    }
end

local function capture()
    local ctrl, pawn, err = localPawn()
    if pawn == nil then
        log("Capture skipped: " .. tostring(err))
        return
    end

    local mesh = meshFromPawn(pawn)
    local skeletalAsset = skeletalAssetFromMesh(mesh)
    local growth = nil
    local elderStacks = nil
    pcall(function() growth = tonumber(pawn:GetGrowth()) end)
    pcall(function() elderStacks = tonumber(pawn:GetElderReplicationStacks()) end)

    local payload = {
        schema = "hollow-valley-skin-inspector/v1",
        inspectorVersion = MOD_VERSION,
        capturedAtUnix = os.time(),
        species = speciesFromPawn(pawn),
        pawn = {
            object = safeFullName(pawn),
            class = safeClassName(pawn),
            address = safeAddress(pawn),
            growth = growth,
            elderReplicationStacks = elderStacks,
        },
        controller = {
            object = safeFullName(ctrl),
            class = safeClassName(ctrl),
            address = safeAddress(ctrl),
        },
        customizer = customizerSnapshot(pawn),
        mesh = {
            componentObject = safeFullName(mesh),
            componentClass = safeClassName(mesh),
            componentAddress = safeAddress(mesh),
            skeletalAssetObject = safeFullName(skeletalAsset),
            skeletalAssetClass = safeClassName(skeletalAsset),
            skeletalAssetAddress = safeAddress(skeletalAsset),
            materialSlots = materialSnapshot(mesh),
        },
        limitations = {
            rawUvs = "not captured in Lua v001; planned for a UE4SS C++ sidecar after metadata validation",
            textures = "not traversed from TextureParameterValues because UObject pointers inside USTRUCTs are intentionally avoided in Lua",
            writes = "none",
        },
    }

    captureCounter = captureCounter + 1
    ensureDir(SAVED_DIR)
    ensureDir(CAPTURE_DIR)

    local species = tostring(payload.species or "unknown"):gsub("[^%w_-]", "_")
    local filename = string.format("%s/%s-%d-%03d.json", CAPTURE_DIR, species, os.time(), captureCounter)
    local json = encodeJson(payload)

    local file = io.open(filename, "wb")
    if file == nil then
        log("ERROR: could not write " .. filename)
        return
    end
    file:write(json)
    file:close()

    local latest = io.open(SAVED_DIR .. "/latest.json", "wb")
    if latest ~= nil then
        latest:write(json)
        latest:close()
    end

    log(string.format(
        "Captured %s | mesh=%s | materials=%d | file=%s",
        tostring(payload.species),
        tostring(payload.mesh.skeletalAssetObject or "unavailable"),
        #(payload.mesh.materialSlots or {}),
        filename
    ))
end

ensureDir(SAVED_DIR)
ensureDir(CAPTURE_DIR)

RegisterKeyBind(Key.F8, { ModifierKey.CONTROL, ModifierKey.ALT }, function()
    log("CTRL+ALT+F8 capture requested")
    ExecuteInGameThread(function()
        capture()
    end)
end)

log("Loaded. Spawn/select a dinosaur and press CTRL+ALT+F8 to capture it.")
