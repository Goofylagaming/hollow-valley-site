const express = require("express");
const { getRoster } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

// Empty until the game server is live and can report which dinos a player owns/has active.
router.get("/", requireAuth, (req, res) => {
  res.json(getRoster(req.user.id));
});

module.exports = router;
