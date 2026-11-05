"use strict";
const router = require('express').Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getSkinStudioSafety } = require('../middleware/skinStudioSafety');
const { db } = require('../db');
const automation = require('../services/automationWebsiteClient');
const enabled = () => process.env.SEASON_TRACK_ENABLED === '1';
const available = () => enabled() || process.env.SEASON_TRACK_MANAGEMENT_ENABLED === '1';
const readOnly = () => process.env.SEASON_TRACK_READ_ONLY === '1' || getSkinStudioSafety().readOnly;
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/capabilities', (_req, res) => res.json({ enabled: enabled(), managementAvailable: available(), readOnly: readOnly(), rewardsEnabled: false }));
router.use((_req, res, next) => available() ? next() : res.status(503).json({ error: 'Season tracking is not enabled' }));
router.use(requireAuth);
router.use((req, res, next) => {
  const who = req.user;
  if (!Number.isSafeInteger(who?.id) || typeof who.steam_id !== 'string' || !/^\d{17}$/.test(who.steam_id) ||
      !db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=?').get(who.id, who.steam_id)) return res.status(403).json({ error: 'Sign in again with your current linked Steam account' });
  next();
});
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  if (readOnly()) return res.status(403).json({ error: 'This preview cannot change season progress' });
  if (req.get('origin') !== `${req.protocol}://${req.get('host')}` || req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json')) return res.status(403).json({ error: 'Use the website to manage season progress' });
  if (!enabled() && !(req.path === '/participation' && req.body?.selected === false)) return res.status(503).json({ error: 'Season tracking is paused' });
  next();
});
const run = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : 'Season progress is temporarily unavailable' }); }
};
const call = (req, action, body) => automation.seasonTrackRequest(action, { ...body, steamId: req.user.steam_id });
router.get('/catalog', run(req => {
  const raw = req.query.before;
  if (raw !== undefined && (typeof raw !== 'string' || !/^[1-9]\d{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw)))) throw Object.assign(new Error('Invalid season page'), { status: 400 });
  return call(req, 'catalog', { before: raw === undefined ? null : Number(raw) });
}));
router.get('/:id', run(req => call(req, 'status', { id: req.params.id })));
router.post('/participation', run(req => call(req, 'participation', {
  id: req.body?.id, selected: req.body?.selected, expectedRevision: req.body?.expectedRevision,
  requestKey: req.body?.requestKey, seasonDigest: req.body?.seasonDigest,
})));
router.post('/sync', run(req => call(req, 'sync', {
  id: req.body?.id, expectedRevision: req.body?.expectedRevision, seasonDigest: req.body?.seasonDigest,
})));
module.exports = router;
