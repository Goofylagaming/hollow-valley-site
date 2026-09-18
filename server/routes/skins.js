const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { getSkinsForSpecies, createSkin } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();
const speciesPath = path.join(__dirname, "..", "data", "species.json");
const species = JSON.parse(fs.readFileSync(speciesPath, "utf8"));
const speciesIds = new Set(species.map((entry) => entry.id));

// Real skin presets are captured from parked DinoStorage JSON. This preserves
// the actual customizer colors/pattern/theme rather than storing a name only.
router.get("/mine", requireAuth, (req, res) => automationRoutes.listSkinPresets(req, res));
router.post("/from-stored", requireAuth, (req, res) => automationRoutes.createSkinPreset(req, res));
router.post("/:id/apply", requireAuth, (req, res) => automationRoutes.applySkinPreset(req, res, req.params.id));

// Keep the public legacy library read route during migration so old premium
// display records are not silently removed from the site. New player presets
// are created only from parked dinos through /from-stored.
router.get("/", (req, res) => {
  const speciesId = req.query.species;
  if (speciesId) return res.json(getSkinsForSpecies(speciesId));
  res.json(species.map((entry) => ({ speciesId: entry.id, skins: getSkinsForSpecies(entry.id) })));
});

// Existing admin premium-name route is retained branch-side for compatibility;
// a future premium-preset editor should capture real CustomizerData as well.
router.post("/premium", requireAdmin, (req, res) => {
  const { speciesId, name } = req.body || {};
  if (!speciesId || !speciesIds.has(speciesId)) return res.status(400).json({ error: "Unknown species" });
  if (!name || name.trim().length < 2) return res.status(400).json({ error: "Skin name is required" });
  res.json(createSkin({ ownerUserId: null, speciesId, name: name.trim(), isPremium: true }));
});

module.exports = router;
