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

function validateMessage(value) {
  const message = String(value || "").trim();
  if (!message) throw new Error("Announcement message is required.");
  if (message.length > 1800) throw new Error("Announcement message must be 1,800 characters or fewer.");
  return message;
}

router.use(requireAdmin);

router.get("/", async (_req, res) => {
  try {
    const [discord, jobs] = await Promise.all([
      automation.getAdminDiscordState(),
      automation.getAdminJobs(),
    ]);
    return res.json({ discord, jobs });
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not load Discord automation.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/sync-status", async (_req, res) => {
  try {
    return res.json(await automation.syncAdminDiscordStatus());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not sync Discord server status.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/announce", async (req, res) => {
  let message;
  try {
    message = validateMessage(req.body?.message);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    return res.status(202).json(await automation.sendAdminDiscordAnnouncement(message));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not queue Discord announcement.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/schedule", async (req, res) => {
  let message;
  try {
    message = validateMessage(req.body?.message);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const recurrence = String(req.body?.recurrence || "none").trim().toLowerCase();
  if (!["none", "daily", "weekly"].includes(recurrence)) {
    return res.status(400).json({ error: "Recurrence must be none, daily or weekly." });
  }

  const runAt = String(req.body?.runAt || "").trim();
  if (!runAt || !Number.isFinite(new Date(runAt).getTime())) {
    return res.status(400).json({ error: "A valid future date/time is required." });
  }

  try {
    return res.status(201).json(await automation.scheduleAdminDiscordAnnouncement({ message, runAt, recurrence }));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not schedule Discord announcement.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/jobs/:id/cancel", async (req, res) => {
  try {
    return res.json(await automation.cancelAdminJob(req.params.id));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not cancel scheduled announcement.");
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
