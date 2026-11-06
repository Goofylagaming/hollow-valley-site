const express = require('express');
const { randomUUID } = require('node:crypto');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const economy = require('../services/economyStore');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireWebsiteToken);

const MONTHLY_SUPPORTER_BONUS = Object.freeze({
  supporter: 15000,
  guardian: 20000,
  legend: 25000,
});

const SUPPORTER_TIER_LABELS = Object.freeze({
  supporter: 'Valley Member',
  guardian: 'Valley Elite',
  legend: 'Valley Legend',
});

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

router.post('/daily-login/:action', (req, res) => {
  if (process.env.DAILY_LOGIN_REWARDS_ENABLED !== '1') return res.sendStatus(404);
  const daily = require('../services/dailyLoginWallet');
  const { steamId, tier, day } = req.body || {};
  if (!/^\d{17}$/.test(steamId)) return res.sendStatus(400);
  if (req.params.action === 'status') return res.json(daily.dailyStatus(steamId,tier));
  if (req.params.action === 'claim') return res.json(daily.claimDaily(steamId,tier,day));
  return res.sendStatus(404);
});

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

router.post('/supporter-bonus', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const tier = String(req.body?.tier || '').trim().toLowerCase();
    const invoiceId = String(req.body?.invoiceId || '').trim();
    const amount = Number(req.body?.amount);
    const expectedAmount = MONTHLY_SUPPORTER_BONUS[tier];

    if (!expectedAmount) {
      return res.status(400).json({ error: 'Invalid supporter tier.' });
    }
    if (!/^in_[A-Za-z0-9_]+$/.test(invoiceId)) {
      return res.status(400).json({ error: 'A valid Stripe invoice ID is required.' });
    }
    if (!Number.isSafeInteger(amount) || amount !== expectedAmount) {
      return res.status(400).json({
        error: `Monthly bonus for ${SUPPORTER_TIER_LABELS[tier]} must be ${expectedAmount} Valley Coin.`,
      });
    }

    const idempotencyKey = `supporter-monthly:${invoiceId}`;
    const result = await audit.run(
      'wallet',
      'supporter_monthly_bonus',
      { steamId, tier, invoiceId, amount },
      async () => economy.applyWalletTransaction({
        steamId,
        amount,
        kind: 'supporter_monthly_bonus',
        reason: `${SUPPORTER_TIER_LABELS[tier]} monthly subscriber bonus`,
        idempotencyKey,
        referenceType: 'stripe_invoice',
        referenceId: invoiceId,
        metadata: {
          source: 'stripe_subscription',
          rewardType: 'monthly_subscriber_bonus',
          tier,
          tierLabel: SUPPORTER_TIER_LABELS[tier],
        },
      }),
      (value) => ({
        steamId,
        tier,
        invoiceId,
        amount,
        balance: value.wallet?.balance ?? null,
        duplicate: Boolean(value.duplicate),
      })
    );

    return res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to credit monthly supporter bonus.' });
  }
});

router.post('/arcade/:action', (req,res) => {
  if (process.env.VALLEY_ARCADE_ENABLED !== '1') return res.sendStatus(404);
  const arcade=require('../services/valleyArcade');
  const games=require('../services/valleyArcadeGames');
  const body=req.body || {};
  try {
    switch(req.params.action) {
      case 'settings': return res.json(arcade.settings());
      case 'configure': return res.json(arcade.configure(body.actor,body));
      case 'start': return res.json(games.start(body.steamId,body.game));
      case 'answer': return res.json(games.answer(body.steamId,body.id,body.choice));
      case 'leaderboard': {
        const config=arcade.settings();
        if (!config.enabled || config.emergency) return res.sendStatus(404);
        const rows=economy.db.prepare(`SELECT sum(score) AS score FROM arcade_rounds
          WHERE settled_day=? GROUP BY steam_id ORDER BY score DESC LIMIT 10`).all(arcade.dayKey(Date.now()));
        return res.json(rows);
      }
      default: return res.sendStatus(404);
    }
  } catch { return res.status(409).json({error:'Round or settings unavailable.'}); }
});

module.exports = router;
