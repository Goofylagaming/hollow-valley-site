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
