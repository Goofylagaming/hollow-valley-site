'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const automation = require('../services/automationWebsiteClient');
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  if (!/^\d{17}$/.test(String(req.user?.steam_id || ''))) return res.status(403).json({ error: 'Steam login required' });
  next();
});
router.get('/', async (req, res) => {
  try { res.json(await automation.getPlayerMilestones(req.user.steam_id, req.query.after)); }
  catch { res.status(503).json({ error: 'Player notifications are temporarily unavailable.' }); }
});
router.post('/preferences', async (req, res) => {
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
  const prefs = req.body;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs) || Object.entries(prefs).some(([key, value]) =>
    !['sanctuary', 'patrol', 'migration', 'inGame'].includes(key) || typeof value !== 'boolean')) {
    return res.status(400).json({ error: 'Invalid notification settings' });
  }
  try { res.json(await automation.setPlayerMilestonePreferences(req.user.steam_id, prefs)); }
  catch { res.status(503).json({ error: 'Notification settings could not be saved.' }); }
});
module.exports = router;
