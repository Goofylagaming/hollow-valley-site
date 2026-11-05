"use strict";
const router = require('express').Router();
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const service = require('../services/seasonTrackService');
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.use(requireWebsiteToken);
router.use((_req, res, next) => service.available() ? next() : res.status(503).json({ error: 'Season tracking is not enabled' }));
const run = fn => (req, res) => {
  try { res.json(fn(req, service.get())); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Season progress is temporarily unavailable' }); }
};
router.post('/catalog', run((req, store) => store.catalog({ before: req.body?.before ?? null })));
router.post('/status', run((req, store) => store.status(req.body?.id, req.body?.steamId)));
router.use((req, res, next) => process.env.SEASON_TRACK_READ_ONLY === '1' ? res.status(403).json({ error: 'Season progress is read-only' }) : next());
router.use((req, res, next) => service.enabled() || (req.path === '/participation' && req.body?.selected === false) ? next() : res.status(503).json({ error: 'Season tracking is paused' }));
router.post('/participation', run((req, store) => store.changeParticipation(req.body?.id, req.body?.steamId, {
  selected: req.body?.selected, expectedRevision: req.body?.expectedRevision, requestKey: req.body?.requestKey, seasonDigest: req.body?.seasonDigest,
})));
router.post('/sync', run((req, store) => {
  if (!Number.isSafeInteger(req.body?.expectedRevision) || typeof req.body?.seasonDigest !== 'string') throw Object.assign(new Error('Refresh the current season choice first'), { status: 400 });
  return store.reconcile(req.body?.id, req.body?.steamId, { expectedRevision: req.body.expectedRevision, seasonDigest: req.body.seasonDigest });
}));
module.exports = router;
