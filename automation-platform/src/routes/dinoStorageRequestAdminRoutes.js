const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const audit = require('../services/auditService');
const recovery = require('../services/dinoStorageRequestRecoveryService');

const router = express.Router();
router.use(requireAdminToken);

router.get('/:steamId', (req, res) => {
  try {
    const requests = recovery.listForSteam(req.params.steamId, {
      limit: Number(req.query.limit) || 100,
    });
    res.json({
      steamId: String(req.params.steamId),
      staleUnlockSeconds: Math.round(recovery.staleAfterMs() / 1000),
      requests,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to load DinoStorage requests.' });
  }
});

router.post('/:requestId/reconcile', async (req, res) => {
  try {
    const result = await audit.run(
      'dinostorage',
      'admin_reconcile_request',
      { requestId: String(req.params.requestId || '').trim() },
      () => recovery.reconcileRequest(req.params.requestId),
      (value) => ({
        requestId: value.request?.id || null,
        beforeStatus: value.before?.status || null,
        afterStatus: value.request?.status || null,
      })
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'DINOSTORAGE_REQUEST_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Unable to reconcile DinoStorage request.' });
  }
});

router.post('/:requestId/cancel', async (req, res) => {
  try {
    const result = await audit.run(
      'dinostorage',
      'admin_cancel_request',
      {
        requestId: String(req.params.requestId || '').trim(),
        steamId: String(req.body?.steamId || '').trim() || null,
      },
      async () => recovery.cancelRequest({
        requestId: req.params.requestId,
        steamId: req.body?.steamId || null,
        reason: req.body?.reason || undefined,
      }),
      (value) => ({
        changed: Boolean(value.changed),
        requestId: value.request?.id || null,
        status: value.request?.status || null,
      })
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'DINOSTORAGE_REQUEST_NOT_FOUND' ? 404 :
      error.code === 'DINOSTORAGE_REQUEST_STEAM_MISMATCH' ? 409 : 400;
    res.status(status).json({ error: error.message || 'Unable to cancel DinoStorage request.' });
  }
});

router.post('/flush/:steamId', async (req, res) => {
  try {
    const result = await audit.run(
      'dinostorage',
      'admin_flush_pending_requests',
      { steamId: String(req.params.steamId || '').trim() },
      async () => recovery.flushPendingForSteam({
        steamId: req.params.steamId,
        reason: req.body?.reason || undefined,
      }),
      (value) => ({
        steamId: value.steamId,
        flushed: value.flushed,
        requestIds: value.requests.map((request) => request.id),
      })
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to flush DinoStorage requests.' });
  }
});

router.post('/sweep-stale/run', async (_req, res) => {
  try {
    const result = await audit.run(
      'dinostorage',
      'admin_sweep_stale_requests',
      {},
      () => recovery.reconcileAndExpireStaleRequests(),
      (value) => ({
        reconciled: Number(value.reconciliation?.changed || 0),
        expired: Number(value.stale?.expired || 0),
      })
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Unable to sweep stale DinoStorage requests.' });
  }
});

module.exports = router;
