const express = require("express");
const { getState } = require("../services/serverStatus");

const router = express.Router();

router.get("/", (req, res) => {
  const state = getState();
  res.json({
    configured: state.configured,
    online: state.online,
    playerCount: state.playerCount,
    maxPlayers: state.maxPlayers,
    // Names only - never expose SteamIDs/EOS IDs to the public site.
    players: state.players.map((p) => p.name),
    lastChecked: state.lastChecked,
  });
});

module.exports = router;
