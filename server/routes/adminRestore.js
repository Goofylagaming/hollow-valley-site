const express = require("express");
const { requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

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

router.get("/", requireAdmin, async (_req, res) => {
  try {
    const result = await automation.getAdminRestoreState();
    return res.json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read Admin Restore state.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/build", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.buildAdminRestoreJson({
      restore: req.body?.restore,
      fullNutrients: req.body?.fullNutrients === true,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not build Admin Restore JSON.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/upload", requireAdmin, async (req, res) => {
  const steamId = String(req.body?.steamId || "").trim();
  const slot = String(req.body?.slot || "").trim();
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: "A valid 17-digit Steam ID is required." });
  }
  if (slot && !/^[A-Za-z0-9_-]{1,80}$/.test(slot)) {
    return res.status(400).json({ error: "Slot may contain only letters, numbers, underscores and hyphens." });
  }
  try {
    return res.status(201).json(await automation.uploadAdminRestore({
      steamId,
      slot,
      restore: req.body?.restore,
      fullNutrients: req.body?.fullNutrients === true,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not upload Admin Restore JSON.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
