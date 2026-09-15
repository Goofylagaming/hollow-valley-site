const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { runDinoStorageAction } = require("../services/dinoStorage");

const router = express.Router();

router.post("/:action", requireAuth, async (req, res) => {
  const action = req.params.action;
  if (!["store", "redeem"].includes(action)) {
    return res.status(404).json({ error: "Unsupported DinoStorage action." });
  }
  if (!req.user.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }

  try {
    const result = await runDinoStorageAction(action, req.user.steam_id);
    res.json({
      ok: true,
      action,
      message: action === "store"
        ? "DinoStorage store command sent. Your dinosaur will be stored and killed by the mod; respawn naturally before using redeem."
        : "DinoStorage redeem command sent. Respawn naturally first, then allow the mod to restore your stored dinosaur.",
      result,
    });
  } catch (err) {
    console.error("[DinoStorage]", { action, error: err.message });
    res.status(502).json({ error: `DinoStorage command failed: ${err.message}` });
  }
});

module.exports = router;
