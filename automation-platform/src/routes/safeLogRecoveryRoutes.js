const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const safeLogRecovery = require('../services/safeLogRecoveryService');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireAdminToken);

function errorStatus(error) {
  if (error?.code === 'SAFELOG_COMMAND_TIMEOUT') return 504;
  if (error?.code === 'SAFELOG_COMMAND_FAILED') return 409;
  return 400;
}

router.get('/:steamId', async (req, res) => {
  try {
    const steamId = safeLogRecovery.validateSteamId(req.params.steamId);
    const source = safeLogRecovery.validateSource(req.query.source);
    const result = await safeLogRecovery.getRecovery({ steamId, source });
    return res.json({ ok: true, steamId, recovery: result.recovery });
  } catch (error) {
    return res.status(errorStatus(error)).json({
      error: error.message || 'Unable to read Safe Log recovery.',
      code: error.code || null,
      requestId: error.requestId || null,
    });
  }
});

router.post('/restore', async (req, res) => {
  if (String(req.body?.confirm || '') !== 'RESTORE SAFELOG') {
    return res.status(400).json({ error: 'Safe Log restore requires the exact confirmation "RESTORE SAFELOG".' });
  }

  try {
    const steamId = safeLogRecovery.validateSteamId(req.body?.steamId);
    const source = safeLogRecovery.validateSource(req.body?.source);
    const result = await audit.run(
      'safelog_recovery',
      'restore',
      { steamId, source: source || 'latest' },
      () => safeLogRecovery.restoreRecovery({ steamId, source }),
      (value) => ({
        steamId,
        source: source || 'latest',
        confirmed: value?.outcome?.state === 'confirmed',
        message: value?.outcome?.message || null,
      })
    );
    return res.json({
      ok: true,
      restore: {
        steamId,
        source: source || 'latest',
        confirmed: result?.outcome?.state === 'confirmed',
        message: result?.outcome?.message || 'Safe Log recovery restored.',
      },
    });
  } catch (error) {
    return res.status(errorStatus(error)).json({
      error: error.message || 'Unable to restore Safe Log recovery.',
      code: error.code || null,
      requestId: error.requestId || null,
    });
  }
});

router.post('/clear', async (req, res) => {
  if (String(req.body?.confirm || '') !== 'CLEAR SAFELOG') {
    return res.status(400).json({ error: 'Safe Log clear requires the exact confirmation "CLEAR SAFELOG".' });
  }

  try {
    const steamId = safeLogRecovery.validateSteamId(req.body?.steamId);
    const source = safeLogRecovery.validateSource(req.body?.source || 'both', { allowBoth: true, optional: false });
    const result = await audit.run(
      'safelog_recovery',
      'clear',
      { steamId, source },
      () => safeLogRecovery.clearRecovery({ steamId, source }),
      (value) => ({
        steamId,
        source,
        confirmed: value?.outcome?.state === 'confirmed',
        message: value?.outcome?.message || null,
      })
    );
    return res.json({
      ok: true,
      clear: {
        steamId,
        source,
        confirmed: result?.outcome?.state === 'confirmed',
        message: result?.outcome?.message || 'Safe Log recovery cleared.',
      },
    });
  } catch (error) {
    return res.status(errorStatus(error)).json({
      error: error.message || 'Unable to clear Safe Log recovery.',
      code: error.code || null,
      requestId: error.requestId || null,
    });
  }
});

module.exports = router;
