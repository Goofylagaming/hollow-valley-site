const express = require('express');
const { requireCombatFeedToken } = require('../middleware/combatFeedAuth');
const combat = require('../services/combatEventService');
const deathSuppression = require('../services/combatDeathSuppressionService');

const router = express.Router();
router.use(requireCombatFeedToken);

function ingestWithSuppression(input) {
  // Preserve the existing disabled-feed behaviour instead of consuming a
  // suppression while authoritative combat ingestion is unavailable.
  if (!combat.enabled()) return combat.ingestEvent(input);

  const normalized = combat.normalizeEvent(input);
  const suppression = deathSuppression.consumeNaturalDeath(normalized);
  if (suppression) {
    console.log(
      `[combat] Suppressed ${normalized.id} victim=${normalized.victimSteamId} reason=${suppression.reason}`
    );
    return {
      duplicate: false,
      suppressed: true,
      event: null,
      suppression,
    };
  }

  return combat.ingestEvent(input);
}

router.get('/status', (_req, res) => {
  const board = combat.leaderboard({ hours: 24 * 31, limit: 1 });
  res.json({
    ok: true,
    state: combat.state(),
    eventCount31d: board.eventCount,
    latestEventAt: board.latestEventAt,
  });
});

router.post('/events', (req, res) => {
  try {
    const batch = Array.isArray(req.body?.events) ? req.body.events : null;

    if (batch) {
      if (!batch.length) {
        return res.status(400).json({
          error: 'Combat event batch is empty.',
          code: 'COMBAT_EVENT_INVALID',
        });
      }
      if (batch.length > 100) {
        return res.status(400).json({
          error: 'Combat event batch exceeds 100 events.',
          code: 'COMBAT_EVENT_INVALID',
        });
      }

      const results = batch.map((event) => ingestWithSuppression(event));
      const inserted = results.filter((result) => !result.duplicate && !result.suppressed).length;
      const duplicates = results.filter((result) => result.duplicate).length;
      const suppressed = results.filter((result) => result.suppressed).length;
      const body = {
        ok: true,
        received: results.length,
        inserted,
        duplicates,
      };
      if (suppressed > 0) body.suppressed = suppressed;
      return res.status(inserted > 0 ? 201 : 200).json(body);
    }

    const result = ingestWithSuppression(req.body);
    const body = {
      ok: true,
      duplicate: Boolean(result.duplicate),
      eventId: result.event?.id || null,
    };
    if (result.suppressed) body.suppressed = true;
    return res.status(result.duplicate || result.suppressed ? 200 : 201).json(body);
  } catch (error) {
    const status =
      error.code === 'COMBAT_EVENT_CONFLICT' ? 409 :
      error.code === 'COMBAT_FEED_DISABLED' ? 503 :
      400;
    return res.status(status).json({
      error: error.message || 'Combat event ingestion failed.',
      code: error.code || 'COMBAT_EVENT_INVALID',
    });
  }
});

module.exports = router;
