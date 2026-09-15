const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { respondToDinoStorageAction } = require("../services/dinoStorage");

const router = express.Router();

router.post("/:action", requireAuth, async (req, res) => {
  const action = req.params.action;
  if (!["store", "redeem"].includes(action)) {
    return res.status(404).json({ error: "Unsupported DinoStorage action." });
  }
  return respondToDinoStorageAction(req, res, action);
});

module.exports = router;
