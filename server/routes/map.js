const express = require("express");

const router = express.Router();

// Stub: no real player-position feed exists yet. Once a game-server RCON/log
// bridge is available, have it POST positions here and this endpoint can
// return live data instead of an empty array.
router.get("/positions", (req, res) => {
  res.json({ positions: [], connected: false });
});

module.exports = router;
