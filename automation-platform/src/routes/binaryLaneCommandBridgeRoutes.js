const express = require('express');
const { requireBinaryLaneCommandToken } = require('../middleware/binaryLaneCommandAuth');
const bridge = require('../services/commandBridgeHttpService');
const dinoStorage = require('../services/dinoStorageService');

const router = express.Router();
router.use(requireBinaryLaneCommandToken);

router.get('/poll', (_req, res) => {
  try {
    const payloads = bridge.claimPending(10);
    res.type('application/x-ndjson');
    return res.send(payloads.length ? `${payloads.join('\n')}\n` : '');
  } catch (error) {
    console.error('[binarylane-command-bridge] poll failed', error.message);
    return res.status(500).json({ error: 'Command poll failed.' });
  }
});

router.post('/result', async (req, res) => {
  try {
    const outcome = bridge.acceptResult(req.body || {});

    // A late result for a request already rotated out should not make the
    // game-side bridge retry or spam logs. It is not accepted into state.
    if (!outcome.accepted && outcome.reason === 'unknown_id') {
      return res.status(202).json(outcome);
    }
    if (!outcome.accepted) return res.status(400).json(outcome);

    if (outcome.final && req.body?.source === 'DinoStorage') {
      try {
        await dinoStorage.reconcileDinoStorageRequest(req.body.id);
      } catch (error) {
        // The game-side result is already durably accepted. Do not make the
        // BinaryLane agent retry a terminal mutation merely because local
        // request-state reconciliation failed; the periodic reconciler remains
        // available as a fallback.
        console.warn('[binarylane-command-bridge] DinoStorage reconcile failed', error.message);
      }
    }

    return res.json(outcome);
  } catch (error) {
    console.error('[binarylane-command-bridge] result failed', error.message);
    return res.status(500).json({ error: 'Command result ingestion failed.' });
  }
});

module.exports = router;
