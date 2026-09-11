const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { getSkinsForSpecies, getUserSkins, createSkin, getWallet, creditWallet } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");

const router = express.Router();
const speciesPath = path.join(__dirname, "..", "data", "species.json");
const species = JSON.parse(fs.readFileSync(speciesPath, "utf8"));
const speciesIds = new Set(species.map((entry) => entry.id));

const CREATE_SKIN_COST = 500; // Valley Coin cost to submit a custom skin.

router.get("/", (req, res) => {
  const { species: speciesId } = req.query;
  if (speciesId) return res.json(getSkinsForSpecies(speciesId));
  res.json(species.map((entry) => ({ speciesId: entry.id, skins: getSkinsForSpecies(entry.id) })));
});

router.get("/mine", requireAuth, (req, res) => {
  res.json(getUserSkins(req.user.id));
});

// Players spend Valley Coin to submit a custom skin design for one of their dinos.
router.post("/", requireAuth, (req, res) => {
  const { speciesId, name } = req.body || {};
  if (!speciesId || !speciesIds.has(speciesId)) return res.status(400).json({ error: "Unknown species" });
  if (!name || name.trim().length < 2) return res.status(400).json({ error: "Skin name is required" });

  const wallet = getWallet(req.user.id);
  if (wallet.balance < CREATE_SKIN_COST) {
    return res.status(402).json({ error: `Creating a skin costs ${CREATE_SKIN_COST} Valley Coin` });
  }
  creditWallet(req.user.id, -CREATE_SKIN_COST, `Created skin: ${name.trim()}`);
  const skin = createSkin({ ownerUserId: req.user.id, speciesId, name: name.trim() });
  res.json(skin);
});

// Admins can create free "premium" skins available to every player of a species.
router.post("/premium", requireAdmin, (req, res) => {
  const { speciesId, name } = req.body || {};
  if (!speciesId || !speciesIds.has(speciesId)) return res.status(400).json({ error: "Unknown species" });
  if (!name || name.trim().length < 2) return res.status(400).json({ error: "Skin name is required" });
  const skin = createSkin({ ownerUserId: null, speciesId, name: name.trim(), isPremium: true });
  res.json(skin);
});

module.exports = router;
