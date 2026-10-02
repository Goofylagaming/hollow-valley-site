const express = require('express');
const { requireBinaryLaneCommandToken } = require('../middleware/binaryLaneCommandAuth');
const bridge = require('../services/commandBridgeHttpService');
const dinoStorage = require('../services/dinoStorageService');
const deathSuppression = require('../services/combatDeathSuppressionService');
const restartTelemetry = require('../services/restartTelemetryService');

const router = express.Router();
router.use(requireBinaryLaneCommandToken);

router.get('/poll', (_req, res) => {
  try {
    const payloads = bridge.claimPending(10);

    // Parking intentionally transitions the live pawn into a corpse a few
    // seconds after DinoStorage captures it. Arm a one-use natural-death
    // suppression before the command reaches UE4SS so the resulting system
    // death cannot damage the player's combat K:D/death leaderboard stats.
    for (const payload of payloads) {
      try {
        const command = JSON.parse(payload);
        if (command?.verb === 'dino_store') {
          deathSuppression.arm({
            requestId: command.id,
            steamId: command.steam,
            reason: 'dinostorage_store',
            ttlSeconds: 30,
          });
        }
      } catch (error) {
        console.warn('[binarylane-command-bridge] death suppression arm failed', error.message);
      }
    }

    res.type('application/x-ndjson');
    return res.send(payloads.length ? `${payloads.join('\n')}\n` : '');
  } catch (error) {
    console.error('[binarylane-command-bridge] poll failed', error.message);
    return res.status(500).json({ error: 'Command poll failed.' });
  }
});

router.post('/restart-event', (req, res) => {
  try {
    const outcome = restartTelemetry.ingest(req.body || {});
    return res.status(outcome.duplicate ? 200 : 201).json({ ok: true, ...outcome });
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'Restart telemetry ingestion failed.',
      code: error.code || 'RESTART_TELEMETRY_INVALID',
    });
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
      const request = bridge.getRequest(req.body.id);
      if (request?.verb === 'dino_store' && req.body?.ok === false) {
        // If DinoStorage rejected the store before the deferred corpse
        // transition, remove the window so a real natural death still counts.
        try {
          deathSuppression.cancel(req.body.id);
        } catch (error) {
          console.warn('[binarylane-command-bridge] death suppression cancel failed', error.message);
        }
      }

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
