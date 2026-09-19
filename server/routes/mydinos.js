const express = require("express");
const { randomUUID } = require("node:crypto");
const { requireAuth } = require("../middleware/requireAuth");
const { validateSlot } = require("../services/dinoStorageFiles");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return {
      status: error.status,
      body: {
        error: error.message || fallback,
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

router.get("/", requireAuth, async (req, res) => {
  if (!req.user.steam_id) return res.json([]);
  try {
    const result = await automation.listStoredDinos(String(req.user.steam_id));
    return res.json(result.dinos || []);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read DinoStorage.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/active-character", requireAuth, async (req, res) => {
  if (!req.user.steam_id) return res.json({ active: false, reason: "steam_not_linked" });
  try {
    return res.json(await automation.getActiveCharacter(String(req.user.steam_id)));
  } catch (error) {
    const mapped = mapAutomationError(error, "Live character state unavailable.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/requests/:id", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(await automation.getRequestStatus(req.params.id, steamId));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read automation request status.");
    return res.status(mapped.status).json(mapped.body);
  }
});

async function runDinoAction(req, res, action, slot) {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.requestDinoAction(action, { steamId, slot });
    const request = result.request || null;
    const message = request?.message || `DinoStorage ${action} accepted for processing.`;
    return res.status(202).json({
      ok: true,
      action,
      slot,
      message,
      result: {
        ok: false,
        accepted: true,
        queued: true,
        confirmed: false,
        completionConfirmed: false,
        requestId: request?.id || null,
        action,
        slot,
        message,
      },
    });
  } catch (error) {
    const mapped = mapAutomationError(error, `DinoStorage ${action} failed.`);
    return res.status(mapped.status).json(mapped.body);
  }
}

router.post("/park-active", requireAuth, (req, res) =>
  runDinoAction(req, res, "store", `dino-${randomUUID()}`));

router.get("/stored/:slot/mutations", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  let slot;
  try { slot = validateSlot(req.params.slot); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    return res.json(await automation.getParkedDinoMutations(steamId, slot));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read parked dino mutations.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.put("/stored/:slot/mutations", requireAuth, async (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  let slot;
  try { slot = validateSlot(req.params.slot); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    return res.json(await automation.updateParkedDinoMutations({
      steamId,
      slot,
      mutations: req.body?.mutations || {},
    }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not update parked dino mutations.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/stored/:slot/redeem", requireAuth, async (req, res) => {
  let slot;
  try {
    slot = validateSlot(req.params.slot);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  return runDinoAction(req, res, "redeem", slot);
});

module.exports = router;
