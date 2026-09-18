const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const {
  createSlotId,
  respondToDinoStorageAction,
} = require("../services/dinoStorage");
const { validateSlot } = require("../services/dinoStorageFiles");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

// Read-only My Dinos traffic goes through the isolated automation service.
router.get("/", requireAuth, (req, res) => automationRoutes.listDinos(req, res));

router.get("/active-character", requireAuth, (req, res) =>
  automationRoutes.getActiveCharacter(req, res));

router.post("/park-active", requireAuth, async (req, res) => {
  return respondToDinoStorageAction(req, res, "store", createSlotId());
});

router.get("/stored/:slot/mutations", requireAuth, async (req, res) => {
  let slot;
  try { slot = validateSlot(req.params.slot); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  return automationRoutes.getParkedDinoMutations(req, res, slot);
});

router.put("/stored/:slot/mutations", requireAuth, async (req, res) => {
  let slot;
  try { slot = validateSlot(req.params.slot); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  return automationRoutes.updateParkedDinoMutations(req, res, slot);
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
