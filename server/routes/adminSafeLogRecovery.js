const express = require('express');
const { requireAdmin } = require('../middleware/requireAuth');
const safeLogRecovery = require('../services/safeLogRecoveryClient');

const router = express.Router();
router.use(requireAdmin);

function mapError(error, fallback) {
  if (Number.isInteger(error?.status)) return { status: error.status, body: { error: error.message || fallback } };
  if (error?.code === 'AUTOMATION_TIMEOUT') {
    return { status: 504, body: { error: 'The automation service did not respond in time.' } };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

router.get('/:steamId', async (req, res) => {
  try {
    const steamId = safeLogRecovery.validateSteamId(req.params.steamId);
    const source = safeLogRecovery.validateSource(req.query.source);
    res.set('Cache-Control', 'no-store');
    return res.json(await safeLogRecovery.getRecovery(steamId, source));
  } catch (error) {
    if (!Number.isInteger(error?.status) && /valid 17-digit Steam ID|source must/i.test(error.message || '')) {
      return res.status(400).json({ error: error.message });
    }
    const mapped = mapError(error, 'Could not load Safe Log recovery.');
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post('/restore', async (req, res) => {
  if (String(req.body?.confirm || '') !== 'RESTORE SAFELOG') {
    return res.status(400).json({ error: 'Safe Log restore requires confirmation.' });
  }
  try {
    const steamId = safeLogRecovery.validateSteamId(req.body?.steamId);
    const source = safeLogRecovery.validateSource(req.body?.source);
    return res.json(await safeLogRecovery.restoreRecovery({
      steamId,
      source,
      confirm: 'RESTORE SAFELOG',
    }));
  } catch (error) {
    if (!Number.isInteger(error?.status) && /valid 17-digit Steam ID|source must/i.test(error.message || '')) {
      return res.status(400).json({ error: error.message });
    }
    const mapped = mapError(error, 'Could not restore Safe Log recovery.');
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post('/clear', async (req, res) => {
  if (String(req.body?.confirm || '') !== 'CLEAR SAFELOG') {
    return res.status(400).json({ error: 'Safe Log clear requires confirmation.' });
  }
  try {
    const steamId = safeLogRecovery.validateSteamId(req.body?.steamId);
    const source = safeLogRecovery.validateSource(req.body?.source || 'both', { allowBoth: true, optional: false });
    return res.json(await safeLogRecovery.clearRecovery({
      steamId,
      source,
      confirm: 'CLEAR SAFELOG',
    }));
  } catch (error) {
    if (!Number.isInteger(error?.status) && /valid 17-digit Steam ID|source must/i.test(error.message || '')) {
      return res.status(400).json({ error: error.message });
    }
    const mapped = mapError(error, 'Could not clear Safe Log recovery.');
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
