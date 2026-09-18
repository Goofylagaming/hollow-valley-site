const express = require('express');
const { randomUUID } = require('node:crypto');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const economy = require('../services/economyStore');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireWebsiteToken);

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

router.post('/credit', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const amount = Number(req.body?.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ error: 'Credit amount must be a whole number between 1 and 1,000,000.' });
    }

    const result = await audit.run(
      'wallet',
      'admin_credit',
      { steamId, amount },
      async () => economy.applyWalletTransaction({
        steamId,
        amount,
        kind: 'admin_credit',
        reason: 'Admin Valley Coin credit',
        idempotencyKey: `admin-credit:${randomUUID()}`,
        referenceType: 'website_admin',
        metadata: { source: 'production-dashboard' },
      }),
      (value) => ({
        steamId,
        amount,
        balance: value.wallet?.balance ?? null,
        duplicate: Boolean(value.duplicate),
      })
    );

    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to credit Valley Coin.' });
  }
});

module.exports = router;
