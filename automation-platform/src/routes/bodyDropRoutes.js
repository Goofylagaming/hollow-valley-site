const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const bodyDrop = require('../services/bodyDropService');
const audit = require('../services/auditService');
const store = require('../services/automationStore');

const router = express.Router();

router.get('/options', (_req, res) => {
  res.json({ options: bodyDrop.getDropTypes(), cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 600) });
});

router.get('/requests', requireAdminToken, (req, res) => {
  res.json({
    requests: store.listRequests({
      kind: 'bodydrop',
      limit: Math.max(1, Math.min(200, Number(req.query.limit) || 50)),
    }),
  });
});

router.get('/cooldown/:steamId', requireAdminToken, async (req, res) => {
  try {
    res.json(await bodyDrop.getBodyDropState(req.params.steamId));
  } catch (error) {
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message || 'Unable to read BodyDrop state.' });
  }
});

router.post('/request', requireAdminToken, async (req, res) => {
  const dropType = String(req.body?.dropType || '').trim();
  try {
    const request = await audit.run('bodydrop', 'request', { dropType },
      () => bodyDrop.requestBodyDrop({
        steamId: req.body?.steamId,
        dropType,
      }),
      (value) => ({ requestId: value.id, status: value.status }));
    res.status(202).json({ ok: true, request });
  } catch (error) {
    if (error.code === 'BODYDROP_COOLDOWN') {
      return res.status(429).json({ error: error.message, cooldown: error.cooldown });
    }
    if (error.code === 'BODYDROP_INELIGIBLE') {
      return res.status(403).json({ error: error.message, eligibility: error.eligibility });
    }
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message || 'BodyDrop request failed.' });
  }
});

router.post('/reconcile', requireAdminToken, async (_req, res) => {
  try {
    const result = await audit.run('bodydrop', 'manual_reconcile', {},
      () => bodyDrop.reconcileBodyDrops(),
      (value) => ({ checked: value.checked || 0, changed: value.changed || 0 }));
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(503).json({ error: error.message || 'BodyDrop reconciliation failed.' });
  }
});

module.exports = router;
