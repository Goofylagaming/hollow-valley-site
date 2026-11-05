const router = require('express').Router();
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const legacy = require('../services/valleyLegacyService');
const { createDeathRecapService } = require('../services/deathRecapService');
router.use(requireWebsiteToken);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.post('/list', (req, res) => {
  try { res.json(createDeathRecapService(legacy.get().db).list(req.body?.steamId)); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Death recaps are temporarily unavailable' }); }
});
module.exports = router;
