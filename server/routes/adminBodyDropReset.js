const express = require('express');
const { requireAdmin } = require('../middleware/requireAuth');
const bodyDropReset = require('../services/adminBodyDropResetClient');

const router = express.Router();
router.use(requireAdmin);

router.post('/', async (req, res) => {
  if (String(req.body?.confirm || '') !== 'RESET BODYDROP') {
    return res.status(400).json({ error: 'Reset requires the exact confirmation RESET BODYDROP.' });
  }

  try {
    const steamId = bodyDropReset.validateSteamId(req.body?.steamId);
    return res.json(await bodyDropReset.resetBodyDropCooldown(steamId));
  } catch (error) {
    return res.status(Number.isInteger(error?.status) ? error.status : 502).json({
      error: error.message || 'Could not reset BodyDrop cooldown.',
    });
  }
});

module.exports = router;
