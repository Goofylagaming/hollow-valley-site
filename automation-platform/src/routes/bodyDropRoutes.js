const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const bodyDrop = require('../services/bodyDropService');
const speciesBodyDrop = require('../services/speciesBodyDropService');
const audit = require('../services/auditService');
const store = require('../services/automationStore');

const router = express.Router();

router.get('/options', (_req, res) => {
  res.json({
    mode: 'species-diet',
    dietCatalog: speciesBodyDrop.getDietCatalog(),
    cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 600),
  });
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
    res.json(await speciesBodyDrop.getBodyDropState(req.params.steamId));
  } catch (error) {
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message || 'Unable to read BodyDrop state.' });
  }
});

router.post('/request', requireAdminToken, async (req, res) => {
  const dropType = String(req.body?.dropType || '').trim();
  try {
    const request = await audit.run('bodydrop', 'request', { dropType },
      () => speciesBodyDrop.requestBodyDrop({
        steamId: req.body?.steamId,
        dropType,
      }),
      (value) => ({ requestId: value.id, status: value.status }));
    res.status(202).json({ ok: true, request });
  } catch (error) {
    if (error.code === 'BODYDROP_COOLDOWN') {
      return res.status(429).json({ error: error.message, cooldown: error.cooldown });
    }
    if (error.code === 'BODYDROP_INELIGIBLE' || error.code === 'BODYDROP_DIET_MISMATCH') {
      return res.status(403).json({
        error: error.message,
        eligibility: error.eligibility,
        allowedDropTypes: error.allowedDropTypes || [],
      });
    }
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message || 'BodyDrop request failed.' });
  }
});

router.post('/reset', requireAdminToken, async (req, res) => {
  const steamId = String(req.body?.steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'A valid 17-digit Steam ID is required.' });
  }

  try {
    // Give any terminal BodyDrop result one final chance to reconcile first.
    // The admin reset remains an explicit override if that result was lost.
    try { await bodyDrop.reconcileBodyDrops(); } catch {}

    const latest = store.getLatestForSteam(steamId, 'bodydrop');
    if (!latest) {
      return res.json({
        ok: true,
        reset: {
          steamId,
          changed: false,
          requestId: null,
          previousStatus: null,
          status: null,
          message: 'No BodyDrop cooldown or pending request exists for this player.',
        },
      });
    }

    const previousStatus = latest.status;
    const request = await audit.run(
      'bodydrop',
      'admin_reset',
      { steamId, requestId: latest.id, previousStatus },
      () => store.updateRequest(latest.id, {
        status: 'cancelled',
        message: 'BodyDrop cooldown/pending lock reset by administrator.',
        error: null,
      }),
      (value) => ({
        steamId,
        requestId: value?.id || latest.id,
        previousStatus,
        status: value?.status || null,
      })
    );

    return res.json({
      ok: true,
      reset: {
        steamId,
        changed: previousStatus !== 'cancelled',
        requestId: request?.id || latest.id,
        previousStatus,
        status: request?.status || 'cancelled',
        message: 'BodyDrop cooldown/pending lock reset. A body that already spawned is not removed.',
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to reset BodyDrop state.' });
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
