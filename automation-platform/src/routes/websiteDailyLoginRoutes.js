const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const audit = require('../services/auditService');
const dailyLogin = require('../services/dailyLoginBonusService');
const supporterBonuses = require('../services/supporterBonusService');

const router = express.Router();
router.use(requireWebsiteToken);

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

router.get('/:steamId', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    try {
      await supporterBonuses.refreshMemberships([steamId]);
    } catch (error) {
      console.warn('[daily-login-supporter]', error.message);
    }
    res.json(dailyLogin.status(steamId));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read daily login bonus.' });
  }
});

router.post('/:steamId/claim', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    try {
      await supporterBonuses.refreshMemberships([steamId]);
    } catch (error) {
      console.warn('[daily-login-supporter]', error.message);
    }
    const result = await audit.run(
      'website',
      'daily_login_bonus',
      { steamId },
      async () => dailyLogin.claim(steamId),
      (value) => ({
        duplicate: Boolean(value.duplicate),
        amount: value.amount,
        dayKey: value.dayKey,
        balance: value.wallet?.balance ?? null,
      })
    );
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'DAILY_LOGIN_BONUS_DISABLED' ? 503 : 400;
    res.status(status).json({ error: error.message || 'Unable to claim daily login bonus.', code: error.code || null });
  }
});

module.exports = router;
