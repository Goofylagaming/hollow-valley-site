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

const DEFAULT_DROP_TYPES = [
  { id: "small", name: "Small body", description: "A small emergency food drop." },
  { id: "medium", name: "Medium body", description: "A balanced body drop for a small group." },
  { id: "large", name: "Large body", description: "A larger drop for bigger carnivores or packs." },
];

function getCooldownSeconds() {
  const value = Number(process.env.BODYDROP_COOLDOWN_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : 900;
}

function getDropTypes() {
  const raw = process.env.BODYDROP_TYPES;
  if (!raw) return DEFAULT_DROP_TYPES;

  const parsed = raw
    .split(",")
    .map((entry) => {
      const [id, name, description] = entry.split(":").map((part) => part?.trim());
      if (!/^[a-z0-9_-]{2,32}$/i.test(id || "")) return null;
      return {
        id,
        name: name || id,
        description: description || "Body drop request.",
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
  if (latest.status === "pending") {
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

  const request = createBodyDropRequest({
    userId: req.user.id,
    steamId: req.user.steam_id,
    dropType,
  });

  const result = await executeGameAction({
    action: "body_drop",
    steamId: req.user.steam_id,
    dropType,
    bodyDropRequestId: request.id,
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

module.exports = router;
module.exports._private = { cooldownFor, getDropTypes };
