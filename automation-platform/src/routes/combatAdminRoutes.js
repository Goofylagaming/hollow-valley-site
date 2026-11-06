const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const audit = require('../services/auditService');
const combatEvents = require('../services/combatEventService');

const router = express.Router();
router.use(requireAdminToken);
router.get('/report-context', (req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{return res.json(combatEvents.reportContext(req.query));}
  catch(error){const status=[400,503].includes(error.status)?error.status:503;return res.status(status).json({error:status===400?'A valid report time and participants are required.':'Report context is unavailable.'});}
});

router.post('/reset-stats', async (req, res) => {
  if (String(req.body?.confirm || '') !== 'RESET COMBAT') {
    return res.status(400).json({
      error: 'Combat stat reset requires the exact confirmation "RESET COMBAT".',
      code: 'COMBAT_RESET_CONFIRMATION_REQUIRED',
    });
  }

  try {
    const steamId = String(req.body?.steamId || '').trim();
    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({ error: 'A valid 17-digit Steam ID is required.' });
    }

    const result = await audit.run(
      'combat',
      'reset_player_stats',
      { steamId },
      async () => combatEvents.resetPlayerStats(steamId, { reason: 'Admin leaderboard reset' }),
      (value) => ({
        steamId: value.steamId,
        displayName: value.displayName,
        resetAt: value.resetAt,
        previousResetAt: value.previousResetAt,
      })
    );

    return res.json({ ok: true, reset: result });
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'Unable to reset combat stats.',
      code: error.code || null,
    });
  }
});

module.exports = router;
