const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateSlot,
  speciesFromClassPath,
  normalizeStoredDino,
} = require("../server/services/dinoStorageFiles");
const dinoStorage = require("../server/services/dinoStorage");
const commandBridge = require("../server/services/commandBridge");

test("DinoStorage slot names are filesystem-safe", () => {
  assert.equal(validateSlot("dino-1234_abcd"), "dino-1234_abcd");
  assert.throws(() => validateSlot("../default"), /Invalid DinoStorage slot/);
  assert.throws(() => validateSlot("with spaces"), /Invalid DinoStorage slot/);
});

test("stored state normalization exposes species, gender and mutations", () => {
  const state = normalizeStoredDino({
    slot: "dino-1",
    classPath: "/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C",
    isFemale: true,
    mutations: { Slot1: "Truculency", Slot2: "", ParentSlot1: "Truculency", Slot3: "None" },
  }, "fallback");
  assert.equal(state.species, "Tyrannosaurus");
  assert.equal(state.gender, "Female");
  assert.deepEqual(state.mutationList, ["Truculency"]);
});

test("My Dinos can generate a unique filesystem-safe storage slot", () => {
  const slot = dinoStorage.createSlotId();
  assert.match(slot, /^dino-[0-9a-f-]{36}$/);
  assert.equal(validateSlot(slot), slot);
});

test("store uses an explicitly selected unique slot", async (t) => {
  const call = t.mock.method(commandBridge, "executeCommand", async (verb, steam, tokens) => ({
    ok: true,
    queued: false,
    confirmed: true,
    requestId: "req",
    source: "DinoStorage",
    message: "stored",
    verb,
    steam,
    tokens,
  }));
  const slot = dinoStorage.createSlotId();
  const result = await dinoStorage.runDinoStorageAction("store", "76561198000000000", slot);
  assert.equal(result.slot, slot);
  assert.equal(call.mock.calls[0].arguments[0], "dino_store");
  assert.deepEqual(call.mock.calls[0].arguments[2], [slot]);
});

test("redeem uses the selected stored slot", async (t) => {
  const call = t.mock.method(commandBridge, "executeCommand", async () => ({ ok: true, queued: false, message: "redeem" }));
  const result = await dinoStorage.runDinoStorageAction("redeem", "76561198000000000", "dino-abc");
  assert.equal(result.slot, "dino-abc");
  assert.deepEqual(call.mock.calls[0].arguments[2], ["dino-abc"]);
});

test("species parser handles EVRIMA blueprint class paths", () => {
  assert.equal(speciesFromClassPath("/Game/X/BP_Deinosuchus.BP_Deinosuchus_C"), "Deinosuchus");
});
