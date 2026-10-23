const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");
const snapshots = require('../services/readSnapshots');

const router = express.Router();

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return { status: error.status, body: { error: error.message || fallback } };
  }
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return { status: 504, body: { error: "The automation service did not respond in time." } };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

router.get("/", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }

  try {
    if (req.user.discord_id) {
      try {
        await automation.linkProgressionIdentity({
          steamId: String(req.user.steam_id),
          discordId: String(req.user.discord_id),
        });
      } catch (error) {
        console.warn("[progression] Discord identity sync failed:", error.message);
      }
    }
    const result = await automation.getProgression(String(req.user.steam_id));
    try { snapshots.save(`progression:${req.user.steam_id}`, result); } catch { console.warn('[progression] snapshot persistence failed'); }
    return res.json(result);
  } catch (error) {
    // Only transient availability failures may use this user's display snapshot.
    if (!error.status || [502, 503, 504].includes(error.status)) {
      try {
        const saved = snapshots.load(`progression:${req.user.steam_id}`, 24 * 60 * 60 * 1000);
        if (saved) return res.json({ ...saved.value, stale: true, capturedAt: saved.capturedAt });
      } catch { /* Preserve the original availability error. */ }
    }
    const mapped = mapAutomationError(error, "Could not read Hollow Valley progression.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
