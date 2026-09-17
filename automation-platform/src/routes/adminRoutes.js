const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const { getAdminStatus } = require('../services/statusService');
const bodyDrop = require('../services/bodyDropService');
const dinoStorage = require('../services/dinoStorageService');
const discordAutomation = require('../services/discordAutomationService');
const store = require('../services/automationStore');

const router = express.Router();
router.use(requireAdminToken);

router.get('/status', async (req, res) => {
  try {
    res.json({
      ...(await getAdminStatus({ force: req.query.force === '1' })),
      discordAutomation: discordAutomation.getState(),
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

module.exports = router;
