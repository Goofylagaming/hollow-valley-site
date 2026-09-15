const express = require("express");
const {
  createBodyDropRequest,
  updateBodyDropRequest,
  getLatestBodyDropRequest,
  getRecentBodyDropRequests,
} = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { executeGameAction } = require("../services/sftpBridge");
const serverStatus = require("../services/serverStatus");

const router = express.Router();

// species must exactly match a key in the HollowValleyBodyDrop mod's SPECIES
// table (main.lua) or the game server will reject the job as
// "species-not-allowed". growth is 0..1 and scales the spawned corpse size.
const DEFAULT_DROP_TYPES = [
  { id: "small", name: "Small body", description: "A small emergency food drop.", species: "Compsognathus", growth: 1 },
  { id: "medium", name: "Medium body", description: "A balanced body drop for a small group.", species: "Dryosaurus", growth: 1 },
  { id: "large", name: "Large body", description: "A larger drop for bigger carnivores or packs.", species: "Triceratops", growth: 1 },
];

function getCooldownSeconds() {
  const value = Number(process.env.BODYDROP_COOLDOWN_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : 900;
}

function getDropTypes() {
  const raw = process.env.BODYDROP_TYPES;
  if (!raw) return DEFAULT_DROP_TYPES;

  // Format: id:name:description:species:growth
  const parsed = raw
    .split(",")
    .map((entry) => {
      const [id, name, description, species, growth] = entry.split(":").map((part) => part?.trim());
      if (!/^[a-z0-9_-]{2,32}$/i.test(id || "")) return null;
      if (!species) return null;
      const growthNum = Number(growth);
      return {
        id,
        name: name || id,
        description: description || "Body drop request.",
        species,
        growth: Number.isFinite(growthNum) && growthNum > 0 ? Math.min(1, growthNum) : 1,
      };
    })
    .filter(Boolean);

  return parsed.length ? parsed : DEFAULT_DROP_TYPES;
}

function toDate(value) {
  if (!value) return null;
  const time = Date.parse(`${String(value).replace(" ", "T")}Z`);
  return Number.isFinite(time) ? new Date(time) : null;
}

function cooldownFor(latest, now = new Date()) {
  if (!latest) return { active: false, nextAvailableAt: null, remainingSeconds: 0 };
  if (latest.status === "pending" || latest.status === "queued") {
    return { active: true, reason: "pending", nextAvailableAt: null, remainingSeconds: null };
  }

  const createdAt = toDate(latest.created_at);
  if (!createdAt) return { active: false, nextAvailableAt: null, remainingSeconds: 0 };

  const cooldownMs = getCooldownSeconds() * 1000;
  const next = new Date(createdAt.getTime() + cooldownMs);
  const remainingSeconds = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));

  return {
    active: remainingSeconds > 0,
    reason: remainingSeconds > 0 ? "cooldown" : null,
    nextAvailableAt: remainingSeconds > 0 ? next.toISOString() : null,
    remainingSeconds,
  };
}

router.get("/", requireAuth, (req, res) => {
  const latest = getLatestBodyDropRequest(req.user.id);
  const state = serverStatus.getState();
  res.json({
    enabled: Boolean(req.user.steam_id),
    steamLinked: Boolean(req.user.steam_id),
    serverOnline: state.online,
    cooldownSeconds: getCooldownSeconds(),
    cooldown: cooldownFor(latest),
    options: getDropTypes(),
    latest,
    recent: getRecentBodyDropRequests(req.user.id),
  });
});

router.post("/", requireAuth, async (req, res) => {
  if (!req.user.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }

  const state = serverStatus.getState();
  if (!state.online) {
    return res.status(503).json({ error: "The Isle server is not online or RCON is not synced yet." });
  }

  const options = getDropTypes();
  const dropType = String(req.body?.dropType || "").trim();
  if (!options.some((option) => option.id === dropType)) {
    return res.status(400).json({ error: "Unknown body drop type." });
  }

  const latest = getLatestBodyDropRequest(req.user.id);
  const cooldown = cooldownFor(latest);
  if (cooldown.active) {
    return res.status(429).json({
      error: cooldown.reason === "pending" ? "You already have a body drop request pending." : "Body drop is still on cooldown.",
      cooldown,
    });
  }

  // The mod spawns the corpse at a fixed world location, so the requesting
  // player must currently be spawned in-game (their RCON character record has
  // a live X/Y/Z). Use the raw RCON location, NOT the swapped/projected
  // coordinates used for the map display - the mod places actors using the
  // same raw Unreal world units RCON reports.
  const character = state.characters.find((c) => c.steamId === req.user.steam_id);
  const location = character?.location;
  if (!location || !Number.isFinite(location.x) || !Number.isFinite(location.y) || !Number.isFinite(location.z)) {
    return res.status(400).json({ error: "You must be spawned in-game to request a body drop." });
  }

  const selected = options.find((option) => option.id === dropType);

  const request = createBodyDropRequest({
    userId: req.user.id,
    steamId: req.user.steam_id,
    dropType,
  });

  const result = await executeGameAction({
    action: "body_drop",
    steamId: req.user.steam_id,
    species: selected.species,
    growth: selected.growth,
    dropType,
    bodyDropRequestId: request.id,
    location,
  });

  if (!result.ok) {
    const failed = updateBodyDropRequest(request.id, {
      status: "failed",
      bridgeRequestId: result.requestId,
      error: result.error || "Game server did not process body drop request.",
    });
    return res.status(400).json({ error: failed.error, request: failed });
  }

  const queued = updateBodyDropRequest(request.id, {
    status: result.queued ? "queued" : "completed",
    bridgeRequestId: result.requestId,
  });

  res.json({ ok: true, request: queued, result });
});

router.delete("/", requireAuth, (req, res) => {
  const latest = getLatestBodyDropRequest(req.user.id);
  if (!latest || latest.status !== "queued") {
    return res.status(409).json({ error: "There is no uploaded Body Drop request awaiting reconciliation." });
  }

  const cancelled = updateBodyDropRequest(latest.id, {
    status: "failed",
    error: "Player confirmed that no body spawned; request released for a retry.",
  });
  res.json({ ok: true, request: cancelled });
});

module.exports = router;
module.exports._private = { cooldownFor, getDropTypes };
