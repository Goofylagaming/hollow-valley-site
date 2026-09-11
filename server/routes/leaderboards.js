const express = require("express");
const { getLeaderboards } = require("../db");

const router = express.Router();

// Empty until stats are ingested from the live game server (see /server/README-DEPLOY.md).
router.get("/", (req, res) => {
  res.json(getLeaderboards());
});

module.exports = router;
