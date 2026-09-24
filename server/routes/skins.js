const express = require("express");
const { randomUUID } = require("node:crypto");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");
const externalSkinImport = require("../../public/assets/external-skin-import.js");

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

router.get("/", async (req, res) => {
  try {
    const steamId = req.user?.steam_id ? String(req.user.steam_id) : null;
    const species = req.query.species ? String(req.query.species) : null;
    return res.json(await automation.listSkinStore(steamId, species));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load the skin shop.");
    return res.status(mapped.status).json(mapped.body);
  }
});

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

router.get("/share/:code", async (req, res) => {
  try {
    return res.json(await automation.getSharedSkin(req.params.code));
  } catch (error) {
    const mapped = mapAutomationError(error, "Skin share code was not found.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/studio", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.saveStudioSkin({
      steamId,
      species: req.body?.species,
      name: req.body?.name,
      description: req.body?.description,
      skin: req.body?.skin,
      idempotencyKey: req.body?.idempotencyKey || `website-skin-studio:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not save the Skin Studio design.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/external/preview", requireAuth, async (req, res) => {
  try {
    const parsed = externalSkinImport.parseExternalSkinCode(req.body?.rawCode);
    const skin = externalSkinImport.mergeWithSkin(req.body?.baseSkin, parsed);
    return res.json({
      source: parsed.source,
      sourceLabel: parsed.sourceLabel,
      speciesCode: parsed.speciesCode || null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      importedColorCount: Object.keys(parsed.skinPatch || {}).length,
      importedIndexCount: Object.keys(parsed.indices || {}).length,
      skin,
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Could not parse external skin code." });
  }
});

router.post("/external/batch-preview", requireAdmin, async (req, res) => {
  try {
    const parsedBatch = externalSkinImport.parseExternalSkinBatch(req.body?.rawCode);
    const baseSkin = req.body?.baseSkin;
    const items = parsedBatch.map((parsed) => ({
      source: parsed.source,
      sourceLabel: parsed.sourceLabel,
      speciesCode: parsed.speciesCode || null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      importedColorCount: Object.keys(parsed.skinPatch || {}).length,
      importedIndexCount: Object.keys(parsed.indices || {}).length,
      skin: externalSkinImport.mergeWithSkin(baseSkin, parsed),
    }));
    return res.json({ items });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Could not parse external skin batch." });
  }
});

router.post("/import", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.importSharedSkin({
      steamId,
      shareCode: req.body?.shareCode,
      idempotencyKey: req.body?.idempotencyKey || `website-skin-import:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not import the shared skin.");
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
      idempotencyKey: req.body?.idempotencyKey || `website-skin:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not save skin preset.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(await automation.updateSkin({
      steamId,
      presetId: req.params.id,
      species: req.body?.species,
      name: req.body?.name,
      description: req.body?.description,
      skin: req.body?.skin,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not update this skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(await automation.deleteSkin({ steamId, presetId: req.params.id }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not delete this skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/buy", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.buySkin({
      steamId,
      presetId: req.params.id,
      idempotencyKey: req.body?.idempotencyKey || `website-skin-buy:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not unlock this skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/wear", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.wearSkin({ steamId, presetId: req.params.id });
    return res.status(result.confirmed ? 200 : 202).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not apply this skin to your live dinosaur.");
    return res.status(mapped.status).json(mapped.body);
  }
});

// Existing parked-dino route kept for My Dinos compatibility.
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

router.post("/:id/grant", requireAdmin, async (req, res) => {
  const targetSteamId = String(req.body?.steamId || "").trim();
  if (!/^\d{17}$/.test(targetSteamId)) {
    return res.status(400).json({ error: "Enter a valid 17-digit Steam ID to grant this skin." });
  }
  try {
    return res.status(201).json(await automation.grantExclusiveSkin({
      presetId: req.params.id,
      steamId: targetSteamId,
      grantedBySteamId: req.user?.steam_id || null,
      note: req.body?.note,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not grant this exclusive skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/revoke", requireAdmin, async (req, res) => {
  const targetSteamId = String(req.body?.steamId || "").trim();
  if (!/^\d{17}$/.test(targetSteamId)) {
    return res.status(400).json({ error: "Enter a valid 17-digit Steam ID to revoke this skin." });
  }
  try {
    return res.json(await automation.revokeExclusiveSkin({
      presetId: req.params.id,
      steamId: targetSteamId,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not revoke this exclusive skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/:id/grants", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.listExclusiveSkinGrants(req.params.id));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load exclusive skin grants.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/publish", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.publishSkin({
      presetId: req.params.id,
      price: req.body?.price,
      description: req.body?.description,
      published: req.body?.published !== false,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not update skin publication.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
