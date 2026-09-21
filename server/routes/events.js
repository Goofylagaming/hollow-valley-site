const express = require("express");
const discordEvents = require("../services/discordEvents");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const result = await discordEvents.listScheduledEvents();
    return res.json({
      ...result,
      source: "discord",
    });
  } catch (error) {
    console.error("[events] failed to load Discord scheduled events:", error.message);
    return res.status(502).json({
      error: "Discord events could not be loaded right now.",
      source: "discord",
    });
  }
});

module.exports = router;
