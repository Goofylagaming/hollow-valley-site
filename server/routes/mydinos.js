const express = require("express");
const {
  getRoster,
  getRosterEntry,
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

router.post("/:id/redeem", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  res.json(setRosterStatus(dino.id, "active"));
});

router.post("/:id/park", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  res.json(setRosterStatus(dino.id, "parked"));
});

router.post("/:id/set-prime", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  res.json(setRosterPrime(dino.id, Boolean(req.body?.prime)));
});

router.post("/:id/sell", requireAuth, (req, res) => {
  const dino = ownedOr404(req, res);
  if (!dino) return;
  // Selling back to the server for a fraction of catalog value, since there's no live buyer yet
  // unless the player lists it on the peer marketplace instead.
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
