const express = require('express');
const { requirePresenceFeedToken } = require('../middleware/presenceFeedAuth');
const playerPresence = require('../services/playerPresenceService');
const restartTelemetry = require('../services/restartTelemetryService');

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

router.post('/restart-event', (req, res) => {
  try {
    const result = restartTelemetry.ingest(req.body || {});
    return res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'Restart telemetry ingestion failed.',
      code: error.code || 'RESTART_TELEMETRY_INVALID',
    });
  }
});

module.exports = router;
