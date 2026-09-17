const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const { getAdminStatus } = require('../services/statusService');
const bodyDrop = require('../services/bodyDropService');
const dinoStorage = require('../services/dinoStorageService');
const discordAutomation = require('../services/discordAutomationService');
const scheduler = require('../services/schedulerService');
const rconControl = require('../services/rconControlService');
const store = require('../services/automationStore');

const router = express.Router();
router.use(requireAdminToken);

router.get('/status', async (req, res) => {
  try {
    res.json({
      ...(await getAdminStatus({ force: req.query.force === '1' })),
      discordAutomation: discordAutomation.getState(),
      scheduler: scheduler.getSchedulerState().summary,
      rconControl: rconControl.getState(),
    });
  } catch (error) {
    console.error('[automation-admin-status]', error);
    res.status(503).json({ error: error.message || 'Admin status unavailable.' });
  }
});

router.get('/requests', (req, res) => {
  const kind = ['bodydrop', 'dinostorage'].includes(String(req.query.kind || '')) ? String(req.query.kind) : null;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  res.json({ requests: store.listRequests({ kind, limit }) });
});

router.post('/reconcile', async (_req, res) => {
  try {
    const [bodyDropResult, dinoStorageResult] = await Promise.all([
      bodyDrop.reconcileBodyDrops(),
      dinoStorage.reconcileDinoStorage(),
    ]);
    res.json({ ok: true, bodyDrop: bodyDropResult, dinoStorage: dinoStorageResult });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Automation reconciliation failed.' });
  }
});

router.get('/discord', (_req, res) => {
  res.json(discordAutomation.getState());
});

router.post('/discord/sync-status', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await discordAutomation.syncStatusChannel({ force: true })) });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Discord status sync failed.' });
  }
});

router.post('/discord/announce', async (req, res) => {
  try {
    const announcement = await discordAutomation.sendAnnouncement(req.body?.message);
    res.status(201).json({ ok: true, announcement });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Discord announcement failed.' });
  }
});

router.get('/jobs', (_req, res) => {
  res.json(scheduler.getSchedulerState());
});

router.post('/jobs/discord-announcement', (req, res) => {
  try {
    const job = scheduler.createDiscordAnnouncementJob({
      message: req.body?.message,
      runAt: req.body?.runAt,
      recurrence: req.body?.recurrence,
    });
    res.status(201).json({ ok: true, job });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to schedule Discord announcement.' });
  }
});

router.post('/jobs/:id/cancel', (req, res) => {
  try {
    res.json({ ok: true, job: scheduler.cancelJob(req.params.id) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to cancel scheduled job.' });
  }
});

router.post('/jobs/run-due', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await scheduler.runDueJobs()) });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Scheduler run failed.' });
  }
});

router.get('/rcon', (_req, res) => {
  res.json(rconControl.getState());
});

async function runRcon(res, action, payload = {}) {
  try {
    const result = await rconControl.execute(action, payload);
    res.json({ ok: true, result });
  } catch (error) {
    if (error.code === 'RCON_WRITE_DISABLED') return res.status(503).json({ error: error.message });
    if (/required|valid|between|confirm|240 characters|control characters/i.test(error.message || '')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(502).json({ error: error.message || 'RCON control action failed.' });
  }
}

router.post('/rcon/announce', (req, res) => runRcon(res, 'announce', req.body || {}));
router.post('/rcon/direct-message', (req, res) => runRcon(res, 'directMessage', req.body || {}));
router.post('/rcon/save', (_req, res) => runRcon(res, 'save'));
router.post('/rcon/wipe-corpses', (req, res) => runRcon(res, 'wipeCorpses', req.body || {}));
router.post('/rcon/ai-density', (req, res) => runRcon(res, 'aiDensity', req.body || {}));

module.exports = router;
