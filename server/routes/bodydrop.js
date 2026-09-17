const express = require("express");
const {
  createBodyDropRequest,
  updateBodyDropRequest,
  getLatestBodyDropRequest,
  getRecentBodyDropRequests,
} = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { executeBodyDrop } = require("../services/bodyDrop");
const commandBridge = require("../services/commandBridge");
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

const BODYDROP_MAX_GROWTH_PERCENT = 60;
const CARNIVORE_SPECIES = [
  "Allosaurus",
  "Austroraptor",
  "Baryonyx",
  "Carnotaurus",
  "Ceratosaurus",
  "Compsognathus",
  "Deinosuchus",
  "Dilophosaurus",
  "Herrerasaurus",
  "Omniraptor",
  "Omnoraptor",
  "Pteranodon",
  "Troodon",
  "Tyrannosaurus",
  "Utahraptor",
];

function normalizeSpecies(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCarnivoreSpecies(value) {
  const normalized = normalizeSpecies(value);
  if (!normalized) return false;
  return CARNIVORE_SPECIES.some((species) => normalized.includes(normalizeSpecies(species)));
}

function growthPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const growth = Number(value);
  if (!Number.isFinite(growth) || growth < 0) return null;
  return growth <= 1 ? growth * 100 : growth;
}

function bodyDropEligibility(character) {
  if (!character) {
    return { eligible: false, reason: "You must be spawned in-game to request a body drop." };
  }

  const species = String(character.species || "Unknown");
  if (!isCarnivoreSpecies(species)) {
    return { eligible: false, reason: "Body drops are only available to carnivores.", species };
  }

  const percent = growthPercent(character.growth);
  if (percent === null) {
    return {
      eligible: false,
      reason: "Your dinosaur growth could not be verified. Try again after the next server sync.",
      species,
    };
  }

  if (percent > BODYDROP_MAX_GROWTH_PERCENT) {
    return {
      eligible: false,
      reason: `Body drops are only available at ${BODYDROP_MAX_GROWTH_PERCENT}% growth or below. Your ${species} is ${Math.round(percent)}%.`,
      species,
      growthPercent: percent,
    };
  }

  return {
    eligible: true,
    reason: null,
    species,
    growthPercent: percent,
    maxGrowthPercent: BODYDROP_MAX_GROWTH_PERCENT,
  };
}

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

  // Failed requests never consume a player's cooldown. A cooldown should only
  // protect successful body drops; transport/mod/placement errors should be
  // immediately retryable after the underlying issue is fixed.
  if (latest.status === "failed") {
    return { active: false, reason: null, nextAvailableAt: null, remainingSeconds: 0 };
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

router.get("/", requireAuth, async (req, res, next) => {
  try {
    let latest = getLatestBodyDropRequest(req.user.id);
    if (latest && ["pending", "queued"].includes(latest.status) && latest.bridge_request_id &&
        (process.env.BODYDROP_BRIDGE_MODE || "commandbridge").trim() === "commandbridge") {
      try {
        const result = await commandBridge.inspectBodyDropResult(latest.bridge_request_id, latest.steam_id);
        const current = getLatestBodyDropRequest(req.user.id);
        if (result && current?.id === latest.id && ["pending", "queued"].includes(current.status)) {
          updateBodyDropRequest(latest.id, {
            status: result.ok ? "completed" : "failed",
            bridgeRequestId: latest.bridge_request_id,
            error: result.ok ? null : result.msg,
          });
        }
      } catch (err) {
        console.warn("[Body Drop] reconciliation deferred", { requestId: latest.bridge_request_id, error: err.message });
      }
      latest = getLatestBodyDropRequest(req.user.id);
    }

    const state = serverStatus.getState();
    const character = req.user.steam_id
      ? (state.characters || []).find((c) => c.steamId === req.user.steam_id)
      : null;
    const eligibility = req.user.steam_id && state.online
      ? bodyDropEligibility(character)
      : { eligible: false, reason: null };

    res.json({
      enabled: Boolean(req.user.steam_id),
      steamLinked: Boolean(req.user.steam_id),
      serverOnline: state.online,
      cooldownSeconds: getCooldownSeconds(),
      cooldown: cooldownFor(latest),
      eligibility,
      restrictions: {
        carnivoreOnly: true,
        maxGrowthPercent: BODYDROP_MAX_GROWTH_PERCENT,
      },
      options: getDropTypes(),
      latest,
      recent: getRecentBodyDropRequests(req.user.id),
    });
  } catch (err) { next(err); }
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

  // The requesting player must currently be spawned in-game. The mod resolves
  // the live pawn again before spawning, but the RCON record is also used here
  // to enforce BodyDrop eligibility and provide the bridge with raw coordinates.
  const character = (state.characters || []).find((c) => c.steamId === req.user.steam_id);
  const location = character?.location;
  if (!location || !Number.isFinite(location.x) || !Number.isFinite(location.y) || !Number.isFinite(location.z)) {
    return res.status(400).json({ error: "You must be spawned in-game to request a body drop." });
  }

  const eligibility = bodyDropEligibility(character);
  if (!eligibility.eligible) {
    return res.status(403).json({ error: eligibility.reason, eligibility });
  }

  const selected = options.find((option) => option.id === dropType);

  const request = createBodyDropRequest({
    userId: req.user.id,
    steamId: req.user.steam_id,
    dropType,
  });

  const result = await executeBodyDrop({
    steamId: req.user.steam_id,
    species: selected.species,
    growth: selected.growth,
    dropType,
    bodyDropRequestId: request.id,
    location,
    onPrepared: (command) => updateBodyDropRequest(request.id, {
      status: "pending", bridgeRequestId: command.id,
    }),
  });

  if (!result.ok && !result.queued) {
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
    error: result.queued ? result.message : null,
  });

  res.status(result.queued ? 202 : 200).json({ ok: result.ok, request: queued, result });
});

router.delete("/", requireAuth, (req, res) => {
  const latest = getLatestBodyDropRequest(req.user.id);
  if (!latest || latest.status !== "queued") {
    return res.status(409).json({ error: "There is no uploaded Body Drop request awaiting reconciliation." });
  }

  res.status(409).json({ error: "The uploaded command may still execute. An operator must reconcile its queues and results before releasing this request." });
});

module.exports = router;
module.exports._private = {
  cooldownFor,
  getDropTypes,
  bodyDropEligibility,
  growthPercent,
  isCarnivoreSpecies,
};
