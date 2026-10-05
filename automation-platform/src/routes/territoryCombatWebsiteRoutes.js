const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const combatEvents = require('../services/combatEventService');

const router = express.Router();
router.use(requireWebsiteToken);

router.get('/events', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 100));
    const since = req.query.since ? String(req.query.since) : null;
    res.set('Cache-Control', 'private, no-store');
    res.json({
      state: combatEvents.state(),
      events: combatEvents.listEvents({ since, limit }),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read recent combat events.' });
  }
});

module.exports = router;
