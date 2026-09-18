const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

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
  if (["pending", "preparing", "queued", "acknowledged", "unknown"].includes(latest.status)) {
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

// Both status and request traffic now go through the isolated automation
// service. Publishing remains locked there until it is explicitly confirmed as
// the sole CommandBridge publisher.
router.get("/", requireAuth, (req, res) =>
  automationRoutes.getBodyDropState(req, res, { options: getDropTypes() }));

router.post("/", requireAuth, (req, res) =>
  automationRoutes.requestBodyDrop(req, res));

// Once a command has been submitted it must never be treated as safely
// cancellable just because the browser timed out. Reconciliation is explicit.
router.delete("/", requireAuth, (_req, res) => {
  res.status(409).json({
    error: "A submitted Body Drop command may still execute. An operator must reconcile its request state before releasing it.",
  });
});

module.exports = router;
module.exports._private = { cooldownFor, getDropTypes };
