const router = require('express').Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getSkinStudioSafety } = require('../middleware/skinStudioSafety');
const automation = require('../services/automationWebsiteClient');
const enabled = () => process.env.POI_DISCOVERY_ENABLED === '1' && process.env.VALLEY_LEGACY_ENABLED === '1';
const readOnly = () => process.env.POI_DISCOVERY_READ_ONLY === '1' || getSkinStudioSafety().readOnly;

router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/capabilities', (_req, res) => res.json({ enabled: enabled(), readOnly: readOnly() }));
router.use((_req, res, next) => enabled() ? next() : res.status(503).json({ error: 'Discovery is not enabled' }));
router.use(requireAuth);
router.use((req, res, next) => /^\d{17}$/.test(String(req.user?.steam_id || '')) ? next() : res.status(403).json({ error: 'A linked Steam account is required' }));
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  if (readOnly()) return res.status(403).json({ error: 'This preview cannot change discovery progress' });
  if (req.get('origin') !== `${req.protocol}://${req.get('host')}` || !req.is('application/json')) return res.status(403).json({ error: 'Use the website to manage discovery' });
  next();
});
const run = action => async (req, res) => {
  try { res.json(await action(req)); }
  catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : 'Discovery is temporarily unavailable' }); }
};
const call = (req, action, body = {}) => automation.legacyRequest('/discovery/' + action, { method: 'POST', body: { ...body, steamId: req.user.steam_id } });
router.get('/settings', run(req => call(req, 'settings')));
router.get('/points', run(req => call(req, 'points')));
router.post('/settings', run(req => call(req, 'change', { enabled: req.body?.enabled, expectedRevision: req.body?.expectedRevision, erase: false })));
router.post('/delete', run(req => call(req, 'change', { enabled: false, expectedRevision: req.body?.expectedRevision, erase: true })));
module.exports = router;
