const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

const DEFAULT_DROP_TYPES = [
  { id: "small", name: "Small body", description: "A small emergency food drop.", species: "Compsognathus", growth: 1 },
  { id: "medium", name: "Medium body", description: "A balanced body drop for a small group.", species: "Dryosaurus", growth: 1 },
  { id: "large", name: "Large body", description: "A larger drop for bigger carnivores or packs.", species: "Triceratops", growth: 1 },
];

function getDropTypes() {
  const raw = process.env.BODYDROP_TYPES;
  if (!raw) return DEFAULT_DROP_TYPES;
  const parsed = raw.split(",").map((entry) => {
    const [id, name, description, species, growth] = entry.split(":").map((part) => part?.trim());
    if (!/^[a-z0-9_-]{2,32}$/i.test(id || "") || !species) return null;
    const growthNum = Number(growth);
    return {
      id,
      name: name || id,
      description: description || "Body drop request.",
      species,
      growth: Number.isFinite(growthNum) && growthNum > 0 ? Math.min(1, growthNum) : 1,
    };
  }).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_DROP_TYPES;
}

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return {
      status: error.status,
      body: {
        error: error.message || fallback,
        ...(error.payload?.cooldown ? { cooldown: error.payload.cooldown } : {}),
        ...(error.payload?.eligibility ? { eligibility: error.payload.eligibility } : {}),
        ...(error.payload?.request ? { request: error.payload.request } : {}),
      },
    };
  }
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return {
      status: 504,
      body: { error: "The automation service did not respond in time. The request was not automatically retried." },
    };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

router.get("/", requireAuth, async (req, res) => {
  if (!req.user.steam_id) {
    return res.json({
      enabled: false,
      steamLinked: false,
      serverOnline: false,
      cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 600),
      cooldown: { active: false, nextAvailableAt: null, remainingSeconds: 0 },
      eligibility: { eligible: false, reason: null },
      restrictions: { carnivoreOnly: true, maxGrowthPercent: 60 },
      options: getDropTypes(),
      latest: null,
      recent: [],
    });
  }
  try {
    const result = await automation.getBodyDropCooldown(String(req.user.steam_id));
    const cooldown = result.cooldown || { active: false, remainingSeconds: 0 };
    const latest = result.latest || cooldown.latest || null;
    return res.json({
      enabled: true,
      steamLinked: true,
      serverOnline: result.serverOnline !== false,
      cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 600),
      cooldown,
      eligibility: result.eligibility || { eligible: false, reason: null },
      restrictions: result.restrictions || { carnivoreOnly: true, maxGrowthPercent: 60 },
      options: getDropTypes(),
      latest,
      recent: latest ? [latest] : [],
    });
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read BodyDrop state.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/", requireAuth, async (req, res) => {
  if (!req.user.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }
  const dropType = String(req.body?.dropType || "").trim();
  if (!dropType) return res.status(400).json({ error: "Unknown body drop type." });
  try {
    const result = await automation.requestBodyDrop({ steamId: String(req.user.steam_id), dropType });
    const request = result.request || null;
    return res.status(202).json({
      ok: true,
      request,
      result: {
        ok: false,
        accepted: true,
        queued: true,
        confirmed: false,
        requestId: request?.id || null,
        message: request?.message || "BodyDrop request accepted for automation processing.",
      },
    });
  } catch (error) {
    const mapped = mapAutomationError(error, "BodyDrop request failed.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.delete("/", requireAuth, (_req, res) => {
  res.status(409).json({
    error: "A submitted Body Drop command may still execute. An operator must reconcile its request state before releasing it.",
  });
});

module.exports = router;
module.exports._private = { getDropTypes };
