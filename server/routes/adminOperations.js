const express = require("express");
const { requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return { status: error.status, body: { error: error.message || fallback } };
  }
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return { status: 504, body: { error: "The automation service did not respond in time." } };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

router.use(requireAdmin);

function validateSteamId(value) {
  const steamId = String(value || "").trim();
  if (!/^\d{17}$/.test(steamId)) {
    const error = new Error("A valid 17-digit Steam ID is required.");
    error.status = 400;
    throw error;
  }
  return steamId;
}

function snapshotSteamId(entry) {
  return String(entry?.steamId ?? entry?.SteamId ?? entry?.PlayerID ?? entry?.playerId ?? "").trim();
}

function normalizeConnectedPlayers(snapshot) {
  if (!snapshot?.online) return [];
  const bySteam = new Map();

  for (const entry of Array.isArray(snapshot?.players) ? snapshot.players : []) {
    const steamId = snapshotSteamId(entry);
    if (!/^\d{17}$/.test(steamId)) continue;
    bySteam.set(steamId, {
      steamId,
      name: entry?.name || entry?.Name || "Unknown player",
      species: null,
      growth: null,
      isPrime: false,
    });
  }

  for (const entry of Array.isArray(snapshot?.characters) ? snapshot.characters : []) {
    const steamId = snapshotSteamId(entry);
    if (!/^\d{17}$/.test(steamId)) continue;
    const existing = bySteam.get(steamId) || {
      steamId,
      name: "Unknown player",
      species: null,
      growth: null,
      isPrime: false,
    };
    const rawGrowth = Number(entry?.growth ?? entry?.Growth);
    bySteam.set(steamId, {
      ...existing,
      name: entry?.name || entry?.Name || existing.name,
      species: entry?.species || entry?.Class || entry?.class || existing.species,
      growth: Number.isFinite(rawGrowth) ? rawGrowth : null,
      isPrime: entry?.isPrime === true || entry?.PrimeElder === true ||
        String(entry?.PrimeElder || "").toLowerCase() === "true",
    });
  }

  return [...bySteam.values()].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || "")) || a.steamId.localeCompare(b.steamId)
  );
}

router.get("/", async (req, res) => {
  try {
    const [status, readiness, backups, health, requests, audit, presence] = await Promise.all([
      automation.getAdminOperationsStatus({ force: req.query.force === "1" }),
      automation.getAdminMigrationReadiness(),
      automation.getAdminBackupState(),
      automation.getAdminServerHealth({ hours: Number(req.query.hours) || 24 }),
      automation.getAdminRequests({ limit: 25 }),
      automation.getAdminAudit({ limit: 25 }),
      automation.getAdminPresence({ limit: 25, activeOnly: true }),
    ]);
    return res.json({ status, readiness, backups, health, requests, audit, presence });
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load automation operations status.");
    return res.status(mapped.status).json(mapped.body);
  }
});


router.get("/players", async (_req, res) => {
  try {
    const snapshot = await automation.getServerSnapshot();
    return res.json({
      serverOnline: Boolean(snapshot?.online),
      checkedAt: snapshot?.checkedAt || snapshot?.lastChecked || null,
      players: normalizeConnectedPlayers(snapshot),
    });
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load connected players.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/slay", async (req, res) => {
  if (String(req.body?.confirm || "") !== "SLAY") {
    return res.status(400).json({ error: 'Slay requires the exact confirmation "SLAY".' });
  }

  let steamId;
  try {
    steamId = validateSteamId(req.body?.steamId);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  try {
    return res.json(await automation.slayAdminPlayer(steamId));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not slay the selected player.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/prime-target/:steamId", async (req, res) => {
  let steamId;
  try {
    steamId = validateSteamId(req.params.steamId);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  try {
    const snapshot = await automation.getServerSnapshot();
    const characters = Array.isArray(snapshot?.characters) ? snapshot.characters : [];
    const target = characters.find((entry) =>
      String(entry?.steamId ?? entry?.PlayerID ?? entry?.playerId ?? "") === steamId
    ) || null;
    return res.json({
      serverOnline: Boolean(snapshot?.online),
      target: target ? {
        steamId,
        name: target.name || target.Name || "Unknown player",
        species: target.species || target.Class || target.class || "Unknown",
        growth: Number.isFinite(Number(target.growth ?? target.Growth)) ? Number(target.growth ?? target.Growth) : null,
        isPrime: target.isPrime === true || target.PrimeElder === true || String(target.PrimeElder || "").toLowerCase() === "true",
      } : null,
    });
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not look up the live Prime target.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/prime-grant", async (req, res) => {
  let steamId;
  try {
    steamId = validateSteamId(req.body?.steamId);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  try {
    return res.json(await automation.grantAdminPrime(steamId));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not grant Prime Elder.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/bodydrop-global", async (_req, res) => {
  try {
    return res.json(await automation.getAdminGlobalBodyDropState());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load global BodyDrop state.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/bodydrop-global/toggle", async (req, res) => {
  try {
    return res.json(await automation.setAdminGlobalBodyDropEnabled(req.body?.enabled === true));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not change global BodyDrop state.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/bodydrop-global/activate", async (_req, res) => {
  try {
    return res.status(202).json(await automation.activateAdminGlobalBodyDrop());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not activate global BodyDrop.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/corpse-wipe", async (req, res) => {
  if (String(req.body?.confirm || "") !== "WIPE CORPSES") {
    return res.status(400).json({ error: 'Type "WIPE CORPSES" exactly to confirm this action.' });
  }
  try {
    return res.json(await automation.wipeAdminCorpses(req.body.confirm));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not wipe corpses.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/backup", async (_req, res) => {
  try {
    return res.status(201).json(await automation.createAdminBackup());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not create automation backup.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
