const express = require("express");
const { randomUUID } = require("node:crypto");
const { requireAuth } = require("../middleware/requireAuth");
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

function requireSteam(req, res) {
  if (!req.user?.steam_id) {
    res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
    return null;
  }
  return String(req.user.steam_id);
}

router.get("/mine", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(await automation.listSkinPresets(steamId, req.query.species || null));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load skin presets.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/from-stored", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.createSkinPresetFromStored({
      steamId,
      slot: req.body?.slot,
      name: req.body?.name,
      idempotencyKey: `website-skin:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not save skin preset.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/apply", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(await automation.applySkinPreset({
      steamId,
      slot: req.body?.slot,
      presetId: req.params.id,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not apply skin preset.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
