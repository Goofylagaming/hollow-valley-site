const express = require('express');
const { requirePresenceFeedToken } = require('../middleware/presenceFeedAuth');
const playerPresence = require('../services/playerPresenceService');

const router = express.Router();
router.use(requirePresenceFeedToken);

router.post('/snapshot', async (req, res) => {
  try {
    const result = await playerPresence.ingestExternalPresenceSnapshot(req.body || {});
    const status = result.duplicate ? 200 : result.stale ? 202 : 201;
    return res.status(status).json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'PRESENCE_SAMPLE_CONFLICT' ? 409 : 400;
    return res.status(status).json({
      error: error.message || 'Presence snapshot ingestion failed.',
      code: error.code || 'PRESENCE_SAMPLE_INVALID',
    });
  }
});

module.exports = router;
