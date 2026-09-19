const express = require("express");
const { randomUUID } = require("node:crypto");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

function requireSteam(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Not logged in" });
    return null;
  }
  if (!req.user.steam_id) {
    res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
    return null;
  }
  return String(req.user.steam_id);
}

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return { status: error.status, body: { error: error.message || fallback } };
  }
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return { status: 504, body: { error: "The automation service did not respond in time." } };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

router.get("/", async (req, res) => {
  try {
    const steamId = req.user?.steam_id ? String(req.user.steam_id) : null;
    const species = req.query.species ? String(req.query.species) : null;
    return res.json(await automation.listSkinStore(steamId, species));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read the skin store.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const species = req.query.species ? String(req.query.species) : null;
    return res.json(await automation.listMySkins(steamId, species));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read your skins.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/share/:code", async (req, res) => {
  try {
    return res.json(await automation.getSharedSkin(req.params.code));
  } catch (error) {
    const mapped = mapAutomationError(error, "Skin share code was not found.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/studio", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.saveStudioSkin({
      steamId,
      species: req.body?.species,
      name: req.body?.name,
      description: req.body?.description,
      skin: req.body?.skin,
      idempotencyKey: req.body?.idempotencyKey || `web-skin-save:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not save the skin design.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/import", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.importSharedSkin({
      steamId,
      shareCode: req.body?.shareCode,
      idempotencyKey: req.body?.idempotencyKey || `web-skin-import:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not import the shared skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/from-stored", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.createSkinFromStored({
      steamId,
      slot: req.body?.slot,
      name: req.body?.name,
      idempotencyKey: req.body?.idempotencyKey || `web-skin-capture:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not capture the stored dinosaur skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/buy", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.buySkin({
      steamId,
      presetId: req.params.id,
      idempotencyKey: req.body?.idempotencyKey || `web-skin-buy:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not unlock this skin.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/wear", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.wearSkin({ steamId, presetId: req.params.id });
    return res.status(result.confirmed ? 200 : 202).json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not apply this skin to your live dinosaur.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/apply-stored", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(await automation.applySkinToStored({
      steamId,
      presetId: req.params.id,
      slot: req.body?.slot,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not apply this skin to the parked dinosaur.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/publish", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.publishSkin({
      presetId: req.params.id,
      price: req.body?.price,
      description: req.body?.description,
      published: req.body?.published !== false,
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not update skin publication.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
