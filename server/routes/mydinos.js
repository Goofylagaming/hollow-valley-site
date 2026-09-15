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
const { respondToDinoStorageAction } = require("../services/dinoStorage");

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
  return respondToDinoStorageAction(req, res, "store");
});

router.post("/:id/redeem", requireAuth, async (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;

  res.status(409).json({ error: "Website roster entries are not DinoStorage slots. Use the separate DinoStorage default-slot controls." });
});

router.post("/:id/park", requireAuth, async (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;

  res.status(409).json({ error: "Website roster entries are not DinoStorage slots. Use the separate DinoStorage default-slot controls." });
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