const router = require('express').Router();
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const legacy = require('../services/valleyLegacyService');
router.use(requireWebsiteToken);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  if (process.env.POI_DISCOVERY_ENABLED !== '1') return res.status(503).json({ error: 'Discovery is not enabled' });
  next();
});
const run = action => (req, res) => {
  try { res.json(action(req, legacy.get().discoveries)); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Discovery could not complete this request' }); }
};
router.post('/settings', run((req, service) => service.settings(req.body?.steamId)));
router.post('/points', run((req, service) => service.discovered(req.body?.steamId, process.env.POI_DISCOVERY_CATALOG_VERSION)));
router.post('/change', (req, res, next) => process.env.POI_DISCOVERY_READ_ONLY === '1' ? res.status(403).json({ error: 'Discovery is read-only' }) : next(),
  run((req, service) => service.change(req.body?.steamId, { enabled: req.body?.enabled, expectedRevision: req.body?.expectedRevision, erase: req.body?.erase ?? false })));
module.exports = router;
