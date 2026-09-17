const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const bodyDrop = require('../services/bodyDropService');
const store = require('../services/automationStore');

const router = express.Router();

router.get('/options', (_req, res) => {
  res.json({ options: bodyDrop.getDropTypes(), cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 900) });
});

router.get('/requests', requireAdminToken, (req, res) => {
  res.json({
    requests: store.listRequests({
      kind: 'bodydrop',
      limit: Math.max(1, Math.min(200, Number(req.query.limit) || 50)),
    }),
  });
});

router.get('/cooldown/:steamId', requireAdminToken, (req, res) => {
  const steamId = String(req.params.steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'Invalid Steam ID.' });
  res.json({ steamId, cooldown: bodyDrop.getCooldown(steamId) });
});

router.post('/request', requireAdminToken, async (req, res) => {
  try {
    const request = await bodyDrop.requestBodyDrop({
      steamId: req.body?.steamId,
      dropType: req.body?.dropType,
    });
    res.status(202).json({ ok: true, request });
  } catch (error) {
    if (error.code === 'BODYDROP_COOLDOWN') {
      return res.status(429).json({ error: error.message, cooldown: error.cooldown });
    }
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message || 'BodyDrop request failed.' });
  }
});

router.post('/reconcile', requireAdminToken, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await bodyDrop.reconcileBodyDrops()) });
  } catch (error) {
    res.status(503).json({ error: error.message || 'BodyDrop reconciliation failed.' });
  }
});

module.exports = router;
