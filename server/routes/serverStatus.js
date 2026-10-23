const express = require("express");
const { getDisplayState } = require("../services/serverStatus");

const router = express.Router();

router.get("/", (req, res) => {
  const state = getDisplayState();
  res.json({
    configured: state.configured,
    online: state.online,
    playerCount: state.playerCount,
    maxPlayers: state.maxPlayers,
    // Names only - never expose SteamIDs/EOS IDs to the public site.
    players: state.players.map((p) => p.name),
    lastChecked: state.lastChecked,
    stale: state.stale,
  });
});

module.exports = router;
