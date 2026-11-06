const router = require('express').Router();
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const legacy = require('../services/valleyLegacyService');
const { createDeathRecapService } = require('../services/deathRecapService');
router.use(requireWebsiteToken);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.post('/list', (req, res) => {
  if (process.env.DEATH_RECAP_ENABLED !== '1') return res.status(503).json({ error: 'Death recaps are not enabled' });
  if (!req.body || Array.isArray(req.body) || Object.keys(req.query).length || Object.keys(req.body).some(key => key !== 'steamId')) return res.status(400).json({ error: 'Invalid death recap request' });
  try { res.json(createDeathRecapService(legacy.get().db).list(req.body?.steamId)); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Death recaps are temporarily unavailable' }); }
});
module.exports = router;
