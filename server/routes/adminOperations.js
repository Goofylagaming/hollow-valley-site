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

router.get("/server-mods", async (_req, res) => {
  try {
    return res.json(await automation.getAdminServerMods());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not inspect live server mods.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/server-mods/deploy", async (_req, res) => {
  try {
    return res.status(201).json(await automation.deployAdminServerMods());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not deploy server mods.");
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
