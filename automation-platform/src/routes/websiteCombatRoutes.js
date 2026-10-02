const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const combatEvents = require('../services/combatEventService');

const router = express.Router();
router.use(requireWebsiteToken);

router.get('/leaderboards/combat', (req, res) => {
  try {
    const period = ['daily', 'weekly'].includes(String(req.query.period || '').toLowerCase())
      ? String(req.query.period).toLowerCase()
      : null;
    const hours = Math.max(1, Math.min(24 * 31, Number(req.query.hours) || 24 * 31));
    res.json(combatEvents.leaderboard({ period, hours, limit: 100 }));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read combat leaderboard.' });
  }
});

module.exports = router;
