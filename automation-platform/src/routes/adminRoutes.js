const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const { getAdminStatus } = require('../services/statusService');
const bodyDrop = require('../services/bodyDropService');
const dinoStorage = require('../services/dinoStorageService');
const adminRestore = require('../services/adminRestoreService');
const discordAutomation = require('../services/discordAutomationService');
const scheduler = require('../services/schedulerService');
const rconControl = require('../services/rconControlService');
const serverMonitor = require('../services/serverMonitorService');
const playerPresence = require('../services/playerPresenceService');
const audit = require('../services/auditService');
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
      serverMonitor: serverMonitor.getState(),
      playerPresence: playerPresence.getPresenceSummary(),
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

router.post('/dinostorage/admin-restore-json', async (req, res) => {
  try {
    const restore = await audit.run(
      'dinostorage',
      'build_admin_restore_json',
      {
        fullNutrientsRequested: req.body?.fullNutrients === true,
        hasRestorePayload: Boolean(req.body?.restore),
      },
      async () => adminRestore.buildAdminRestoreJson({
        restore: req.body?.restore,
        fullNutrients: req.body?.fullNutrients,
      }),
      (value) => ({
        fullNutrients: value.fullNutrients,
        explicitNutrients: value.explicitNutrients,
        slot: value.state?.slot || null,
        classPath: value.state?.classPath || null,
      })
    );
    res.json({ ok: true, restore });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to build admin restore JSON.' });
  }
});

router.get('/audit', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const category = String(req.query.category || '').trim() || null;
  res.json({ audit: store.listAudit({ category, limit }) });
});

router.get('/presence', (req, res) => {
  try {
    const steamId = String(req.query.steamId || '').trim() || null;
    const activeOnly = String(req.query.active || '') === '1';
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    res.json({
      summary: playerPresence.getPresenceSummary(),
      sessions: playerPresence.listSessions({ steamId, activeOnly, limit }),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read player presence history.' });
  }
});

router.post('/presence/sample', async (_req, res) => {
  try {
    const result = await audit.run('presence', 'manual_sample', {},
      () => playerPresence.samplePresence({ force: true }),
      (value) => ({ skipped: Boolean(value.skipped), opened: value.opened || 0, updated: value.updated || 0, closed: value.closed || 0 }));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Player presence sample failed.' });
  }
});

router.post('/reconcile', async (_req, res) => {
  try {
    const result = await audit.run('commandbridge', 'manual_reconcile', {}, async () => {
      const [bodyDropResult, dinoStorageResult] = await Promise.all([
        bodyDrop.reconcileBodyDrops(),
        dinoStorage.reconcileDinoStorage(),
      ]);
      return { bodyDrop: bodyDropResult, dinoStorage: dinoStorageResult };
    }, (value) => ({
      bodyDropChecked: value.bodyDrop?.checked || 0,
      bodyDropChanged: value.bodyDrop?.changed || 0,
      dinoStorageChecked: value.dinoStorage?.checked || 0,
      dinoStorageChanged: value.dinoStorage?.changed || 0,
    }));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Automation reconciliation failed.' });
  }
});

router.get('/discord', (_req, res) => {
  res.json(discordAutomation.getState());
});

router.post('/discord/sync-status', async (_req, res) => {
  try {
    const result = await audit.run('discord', 'sync_status_channel', {},
      () => discordAutomation.syncStatusChannel({ force: true }),
      (value) => ({ changed: Boolean(value.changed), channelName: value.name || null }));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Discord status sync failed.' });
  }
});

router.post('/discord/announce', async (req, res) => {
  const message = String(req.body?.message || '');
  try {
    const announcement = await audit.run('discord', 'send_announcement', { messageLength: message.trim().length },
      () => discordAutomation.sendAnnouncement(message),
      (value) => ({ discordMessageId: value.id || null }));
    res.status(201).json({ ok: true, announcement });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Discord announcement failed.' });
  }
});

router.get('/monitor', (_req, res) => {
  res.json(serverMonitor.getState());
});

router.post('/monitor/check', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await serverMonitor.checkServerMonitor({ force: true })) });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Server monitor check failed.' });
  }
});

router.get('/jobs', (_req, res) => {
  res.json(scheduler.getSchedulerState());
});

router.post('/jobs/discord-announcement', async (req, res) => {
  const message = String(req.body?.message || '');
  const runAt = req.body?.runAt;
  const recurrence = req.body?.recurrence;
  try {
    const job = await audit.run('scheduler', 'create_discord_announcement', {
      messageLength: message.trim().length,
      runAt: runAt || null,
      recurrence: recurrence || 'none',
    }, async () => scheduler.createDiscordAnnouncementJob({ message, runAt, recurrence }),
    (value) => ({ jobId: value.id, status: value.status }));
    res.status(201).json({ ok: true, job });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to schedule Discord announcement.' });
  }
});

router.post('/jobs/:id/cancel', async (req, res) => {
  try {
    const job = await audit.run('scheduler', 'cancel_job', { jobId: req.params.id },
      async () => scheduler.cancelJob(req.params.id),
      (value) => ({ jobId: value.id, status: value.status }));
    res.json({ ok: true, job });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to cancel scheduled job.' });
  }
});

router.post('/jobs/run-due', async (_req, res) => {
  try {
    const result = await audit.run('scheduler', 'run_due_jobs', {},
      () => scheduler.runDueJobs(),
      (value) => ({ checked: value.checked || 0, completed: value.completed || 0, failed: value.failed || 0, skipped: Boolean(value.skipped) }));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Scheduler run failed.' });
  }
});

router.get('/rcon', (_req, res) => {
  res.json(rconControl.getState());
});

function rconAuditDetails(action, payload = {}) {
  if (action === 'announce') return { messageLength: String(payload.message || '').trim().length };
  if (action === 'directMessage') return { hasTarget: Boolean(payload.steamId), messageLength: String(payload.message || '').trim().length };
  if (action === 'aiDensity') return { value: payload.value };
  if (action === 'wipeCorpses') return { confirmationProvided: payload.confirm === 'WIPE CORPSES' };
  return {};
}

async function runRcon(res, action, payload = {}) {
  try {
    const result = await audit.run('rcon', action, rconAuditDetails(action, payload),
      () => rconControl.execute(action, payload),
      (value) => ({ sent: Boolean(value.sent), confirmed: Boolean(value.confirmed), warning: value.warning || null }));
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
