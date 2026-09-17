const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const { getAdminStatus } = require('../services/statusService');
const bodyDrop = require('../services/bodyDropService');
const dinoStorage = require('../services/dinoStorageService');
const store = require('../services/automationStore');

const router = express.Router();
router.use(requireAdminToken);

router.get('/status', async (req, res) => {
  try {
    res.json(await getAdminStatus({ force: req.query.force === '1' }));
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

module.exports = router;
