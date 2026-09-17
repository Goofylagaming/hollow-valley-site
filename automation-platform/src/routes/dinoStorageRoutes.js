const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const dinoStorage = require('../services/dinoStorageService');
const store = require('../services/automationStore');

const router = express.Router();

router.use(requireAdminToken);

router.get('/requests', (req, res) => {
  res.json({
    requests: store.listRequests({
      kind: 'dinostorage',
      limit: Math.max(1, Math.min(200, Number(req.query.limit) || 50)),
    }),
  });
});

router.get('/:steamId', async (req, res) => {
  try {
    const dinos = await dinoStorage.listStoredDinos(req.params.steamId);
    res.json({ steamId: String(req.params.steamId), dinos });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Unable to list DinoStorage slots.' });
  }
});

async function action(req, res, actionName) {
  try {
    const request = await dinoStorage.requestDinoStorageAction({
      action: actionName,
      steamId: req.body?.steamId,
      slot: req.body?.slot || 'default',
    });
    res.status(202).json({ ok: true, completionConfirmed: false, request });
  } catch (error) {
    if (error.code === 'DINOSTORAGE_PENDING') {
      return res.status(409).json({ error: error.message, request: error.request });
    }
    res.status(502).json({ error: error.message || `DinoStorage ${actionName} failed.` });
  }
}

router.post('/store', (req, res) => action(req, res, 'store'));
router.post('/redeem', (req, res) => action(req, res, 'redeem'));

router.post('/reconcile', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await dinoStorage.reconcileDinoStorage()) });
  } catch (error) {
    res.status(503).json({ error: error.message || 'DinoStorage reconciliation failed.' });
  }
});

module.exports = router;
