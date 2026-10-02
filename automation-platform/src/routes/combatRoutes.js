const express = require('express');
const { requireCombatFeedToken } = require('../middleware/combatFeedAuth');
const combat = require('../services/combatEventService');

const router = express.Router();
router.use(requireCombatFeedToken);

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

      const results = batch.map((event) => combat.ingestEvent(event));
      const inserted = results.filter((result) => !result.duplicate).length;
      const duplicates = results.length - inserted;
      return res.status(inserted > 0 ? 201 : 200).json({
        ok: true,
        received: results.length,
        inserted,
        duplicates,
      });
    }

    const result = combat.ingestEvent(req.body);
    return res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      eventId: result.event?.id || null,
    });
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
