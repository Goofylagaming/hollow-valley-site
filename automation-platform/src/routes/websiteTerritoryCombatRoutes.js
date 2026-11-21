const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const combat = require('../services/combatEventService');

const router = express.Router();
router.use(requireWebsiteToken);

router.get('/events', (req, res) => {
  try {
    const payload = combat.listForTerritory({
      since: req.query.since || null,
      limit: req.query.limit,
    });
    res.json({ ok: true, ...payload });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read territory combat events.' });
  }
});

module.exports = router;
