const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const serverStatus = require("../services/serverStatus");
const {
  createSlotId,
  listStoredDinos,
  respondToDinoStorageAction,
} = require("../services/dinoStorage");
const { validateSlot } = require("../services/dinoStorageFiles");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  if (!req.user.steam_id) return res.json([]);
  try {
    res.json(await listStoredDinos(req.user.steam_id));
  } catch (err) {
    console.error("[My Dinos] failed to list DinoStorage files", { error: err.message });
    res.status(502).json({ error: `Could not read DinoStorage: ${err.message}` });
  }
});

router.get("/active-character", requireAuth, (req, res) => {
  const steamId = req.user.steam_id;
  if (!steamId) return res.json({ active: false, reason: "steam_not_linked" });

  const state = serverStatus.getState();
  if (!state.online) return res.json({ active: false, reason: "server_offline" });

  const char = (state.characters || []).find((c) => c.steamId === steamId);
  if (!char) return res.json({ active: false, reason: "not_in_game" });

  res.json({
    active: true,
    character: {
      name: char.name,
      species: char.species,
      gender: char.gender,
      growth: char.growth,
      health: char.health,
      stamina: char.stamina,
      hunger: char.hunger,
      thirst: char.thirst,
      isPrime: char.isPrime,
      mutations: char.mutations || [],
      location: char.location,
    },
  });
});

router.post("/park-active", requireAuth, async (req, res) => {
  return respondToDinoStorageAction(req, res, "store", createSlotId());
});

router.post("/stored/:slot/redeem", requireAuth, async (req, res) => {
  let slot;
  try {
    slot = validateSlot(req.params.slot);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  return respondToDinoStorageAction(req, res, "redeem", slot);
});

module.exports = router;
