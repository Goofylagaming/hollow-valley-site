const express = require('express');
const { requireAdmin } = require('../middleware/requireAuth');
const combat = require('../services/combatControlClient');

const router = express.Router();
router.use(requireAdmin);

router.post('/reset', async (req, res) => {
  const steamId = String(req.body?.steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) {
    return res.status(400).json({ error: 'A valid 17-digit Steam ID is required.' });
  }
  if (String(req.body?.confirm || '') !== 'RESET COMBAT') {
    return res.status(400).json({ error: 'Combat reset requires the exact confirmation RESET COMBAT.' });
  }

  try {
    const result = await combat.resetPlayerStats(steamId);
    return res.json(result);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || 'Could not reset combat stats.' });
  }
});

module.exports = router;
