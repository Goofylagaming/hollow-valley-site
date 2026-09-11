const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { creditWallet, periodKeyFor, hasClaimed, recordClaim } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();
const questsPath = path.join(__dirname, "..", "data", "quests.json");
const quests = JSON.parse(fs.readFileSync(questsPath, "utf8"));

router.get("/", (req, res) => {
  const userId = req.user?.id;
  const withStatus = quests.map((quest) => {
    const periodKey = periodKeyFor(quest.cadence);
    return {
      ...quest,
      claimed: userId ? hasClaimed(userId, quest.id, periodKey) : false,
    };
  });
  res.json(withStatus);
});

router.post("/:id/claim", requireAuth, (req, res) => {
  const quest = quests.find((entry) => entry.id === req.params.id);
  if (!quest) return res.status(404).json({ error: "Quest not found" });

  const periodKey = periodKeyFor(quest.cadence);
  if (hasClaimed(req.user.id, quest.id, periodKey)) {
    return res.status(409).json({ error: "Already claimed for this period" });
  }

  recordClaim(req.user.id, quest.id, periodKey);
  const wallet = creditWallet(req.user.id, quest.reward, `Quest: ${quest.title}`);
  res.json({ ok: true, wallet });
});

module.exports = router;
