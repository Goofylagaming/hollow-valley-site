const router = require('express').Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getSkinStudioSafety } = require('../middleware/skinStudioSafety');
const { db } = require('../db');
const service = require('../services/groupHeadquarters').createGroupHeadquarters(db, require('../groupsStore'));
const readOnly = () => process.env.GROUP_HQ_READ_ONLY === '1' || getSkinStudioSafety().readOnly;

router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/capabilities', (_req, res) => res.json({ enabled: process.env.GROUP_HQ_ENABLED === '1', readOnly: readOnly() }));
router.use((_req, res, next) => process.env.GROUP_HQ_ENABLED === '1' ? next() : res.status(503).json({ error: 'Group Headquarters is not enabled' }));
router.use(requireAuth);
router.use((req, res, next) => /^\d{17}$/.test(String(req.user?.steam_id || '')) ? next() : res.status(403).json({ error: 'A linked Steam account is required' }));
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  if (readOnly()) return res.status(403).json({ error: 'This preview cannot change Headquarters' });
  if (req.get('origin') !== `${req.protocol}://${req.get('host')}` || !req.is('application/json')) return res.status(403).json({ error: 'Use the website to edit Headquarters' });
  next();
});
const run = action => (req, res) => {
  try { res.json(action(req)); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Headquarters is temporarily unavailable' }); }
};
router.get('/', run(req => service.get(req.user.steam_id)));
router.post('/', run(req => service.update(req.user.steam_id, { description: req.body?.description, expectedRevision: req.body?.expectedRevision })));
module.exports = router;
