const express = require("express");
const { getLeaderboards } = require("../db");

const router = express.Router();

// Empty until stats are ingested from the live game server (see DEPLOYMENT.md).
router.get("/", (req, res) => {
  res.json(getLeaderboards());
});

module.exports = router;
