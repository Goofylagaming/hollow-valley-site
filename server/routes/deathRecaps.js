const router = require('express').Router();
const { requireAuth } = require('../middleware/requireAuth');
const automation = require('../services/automationWebsiteClient');
const enabled = () => process.env.DEATH_RECAP_ENABLED === '1' && process.env.VALLEY_LEGACY_ENABLED === '1';
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/capabilities', (_req, res) => res.json({ enabled: enabled() }));
router.use((_req, res, next) => enabled() ? next() : res.status(503).json({ error: 'Death recaps are not enabled' }));
router.use(requireAuth);
router.get('/', async (req, res) => {
  if (!/^\d{17}$/.test(String(req.user?.steam_id || ''))) return res.status(403).json({ error: 'A linked Steam account is required' });
  try {
    res.json(await automation.legacyRequest('/death-recaps/list', { method: 'POST', body: { steamId: req.user.steam_id } }));
  } catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : 'Death recaps are temporarily unavailable' }); }
});
module.exports = router;
