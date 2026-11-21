const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const economy = require('../services/economyStore');

const router = express.Router();
router.use(requireWebsiteToken);

router.post('/', (req, res) => {
  const credits = Array.isArray(req.body?.credits) ? req.body.credits : null;
  if (!credits || credits.length > 80) {
    return res.status(400).json({ error: 'Territory holder reward batch is missing or too large.' });
  }
  try {
    const results = credits.map((credit) => economy.applyWalletTransaction({
      steamId: credit.steamId,
      amount: Number(credit.amount),
      kind: 'territory_hold_reward',
      reason: `Territory hold: ${String(credit.territoryName || credit.territoryKey || 'territory')}`,
      idempotencyKey: credit.idempotencyKey,
      referenceType: 'territory_hold',
      referenceId: String(credit.territoryKey || ''),
      metadata: {
        cashable: false,
        transferable: false,
        rule: 'valley-arcade-option-a',
        hourStart: credit.hourStart || null,
        groupId: credit.groupId || null,
      },
    }));
    res.status(201).json({ ok: true, credited: results.length });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to credit territory holder rewards.' });
  }
});

module.exports = router;
