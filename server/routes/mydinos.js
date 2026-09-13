const express = require("express");
const {
  getRoster,
  getRosterEntry,
  addRosterDino,
  setRosterStatus,
  setRosterPrime,
  removeRosterDino,
  transferRosterDino,
  creditWallet,
  getUserByUsername,
  applySkinToRoster,
  getSkinEntry,
} = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { executeGameAction } = require("../services/sftpBridge");
const serverStatus = require("../services/serverStatus");

const router = express.Router();

function ownedOr404(req, res) {
  const dino = getRosterEntry(Number(req.params.id));
  if (!dino || dino.user_id !== req.user.id) {
    res.status(404).json({ error: "Dino not found in your storage" });
    return null;
  }
  return dino;
}

router.get("/", requireAuth, (req, res) => {
  res.json(getRoster(req.user.id));
});

router.get("/active-character", requireAuth, (req, res) => {
  const steamId = req.user.steam_id;
  if (!steamId) return res.json({ active: false, reason: "steam_not_linked" });

  const state = serverStatus.getState();
  if (!state.online) return res.json({ active: false, reason: "server_offline" });

  const char = (state.characters || []).find((c) => c.steamId === steamId);
  if (!char) return res.json({ active: false, reason: "not_in_game" });

  res.json({
    active: true,
    character: {
      name: char.name,
      species: char.species,
      growth: char.growth,
      health: char.health,
      isPrime: char.isPrime,
    },
  });
});

router.post("/park-active", requireAuth, async (req, res) => {
  const steamId = req.user.steam_id;
  if (!steamId) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }

  const result = await executeGameAction({
    action: "park",
    steamId,
  });

  if (!result.ok) {
    return res.status(400).json({ error: result.error || "Failed to park active character in game" });
  }

  let speciesId = "Unknown";
  let sizePercent = 100;
  let isPrime = false;

  if (result.data) {
    try {
      const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
      if (data.species) speciesId = data.species;
      if (data.growth) sizePercent = Math.round(data.growth * 100);
      if (data.isPrime !== undefined) isPrime = Boolean(data.isPrime);
    } catch (e) {
      console.error("Failed to parse park result data", e);
    }
  }

  const dino = addRosterDino(req.user.id, speciesId, sizePercent, isPrime, "parked");
  res.json({ ok: true, dino });
});

router.post("/:id/redeem", requireAuth, async (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;

  const steamId = req.user.steam_id;
  if (steamId) {
    const result = await executeGameAction({
      action: "redeem",
      steamId,
      species: dino.species_id,
      growth: (dino.size_percent || 100) / 100,
      prime: dino.is_prime,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Failed to redeem dino in game" });
    }
  }

  res.json(setRosterStatus(dino.id, "active"));
});

router.post("/:id/park", requireAuth, async (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;

  const steamId = req.user.steam_id;
  if (steamId) {
    const result = await executeGameAction({
      action: "park",
      steamId,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Failed to park dino in game" });
    }
  }

  res.json(setRosterStatus(dino.id, "parked"));
});

router.post("/:id/set-prime", requireAuth, async (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;

  const isPrime = Boolean(req.body?.prime);
  const steamId = req.user.steam_id;
  if (steamId) {
    const result = await executeGameAction({
      action: "set_prime",
      steamId,
      prime: isPrime,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Failed to update prime status in game" });
    }
  }

  res.json(setRosterPrime(dino.id, isPrime));
});

router.post("/:id/sell", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  const scrapValue = Math.max(10, Math.round((dino.size_percent || 10) * 8));
  removeRosterDino(dino.id);
  const wallet = creditWallet(req.user.id, scrapValue, `Scrapped ${dino.species_id}`);
  res.json({ ok: true, wallet, scrapValue });
});

router.post("/:id/gift", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "Recipient username is required" });
  const recipient = getUserByUsername(username);
  if (!recipient) return res.status(404).json({ error: "No user found with that username" });
  if (recipient.id === req.user.id) return res.status(400).json({ error: "You already own this dino" });
  const updated = transferRosterDino(dino.id, recipient.id);
  res.json({ ok: true, dino: updated });
});

router.post("/:id/apply-skin", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  const skinId = req.body?.skinId ?? null;
  if (skinId !== null) {
    const skin = getSkinEntry(Number(skinId));
    if (!skin || skin.species_id !== dino.species_id) {
      return res.status(400).json({ error: "That skin does not fit this species" });
    }
    if (!skin.is_premium && skin.owner_user_id !== req.user.id) {
      return res.status(403).json({ error: "You do not own that skin" });
    }
  }
  res.json(applySkinToRoster(dino.id, skinId));
});

module.exports = router;