const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { validateSlot } = require("../services/dinoStorageFiles");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

// My Dinos reads and writes go through the isolated automation service on the
// automation branch. The automation service still fail-closes all game writes
// until CommandBridge is explicitly enabled as the sole publisher.
router.get("/", requireAuth, (req, res) => automationRoutes.listDinos(req, res));

router.get("/active-character", requireAuth, (req, res) =>
  automationRoutes.getActiveCharacter(req, res));

router.post("/park-active", requireAuth, (req, res) =>
  automationRoutes.parkActive(req, res));

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
  return automationRoutes.redeemStored(req, res, slot);
});

module.exports = router;
