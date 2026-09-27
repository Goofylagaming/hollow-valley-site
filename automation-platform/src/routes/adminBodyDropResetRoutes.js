const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const store = require('../services/automationStore');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireAdminToken);

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) {
    const error = new Error('A valid 17-digit Steam ID is required');
    error.code = 'INVALID_STEAM_ID';
    throw error;
  }
  return steamId;
}

router.post('/', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const latest = store.getLatestForSteam(steamId, 'bodydrop');

    if (!latest) {
      return res.json({
        ok: true,
        reset: {
          steamId,
          changed: false,
          message: 'No BodyDrop request exists for this Steam ID.',
        },
      });
    }

    const resetAt = new Date().toISOString();
    const previousStatus = latest.status;

    const result = await audit.run(
      'bodydrop',
      'admin_reset_cooldown',
      {
        steamId,
        requestId: latest.id,
        previousStatus,
      },
      async () => {
        const request = store.updateRequest(latest.id, {
          status: 'cancelled',
          details: {
            ...(latest.details || {}),
            adminCooldownReset: {
              at: resetAt,
              previousStatus,
            },
          },
          message: 'Admin reset BodyDrop cooldown/pending lock. Original game command may already have executed.',
          error: null,
        });

        return {
          steamId,
          changed: true,
          requestId: latest.id,
          previousStatus,
          currentStatus: request?.status || 'cancelled',
          resetAt,
          message: 'BodyDrop cooldown and pending lock reset by admin.',
        };
      },
      (value) => ({
        steamId: value.steamId,
        requestId: value.requestId,
        previousStatus: value.previousStatus,
        currentStatus: value.currentStatus,
      })
    );

    return res.json({ ok: true, reset: result });
  } catch (error) {
    return res.status(error.code === 'INVALID_STEAM_ID' ? 400 : 500).json({
      error: error.message || 'Unable to reset BodyDrop cooldown.',
      code: error.code || null,
    });
  }
});

module.exports = router;
