const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const audit = require('../services/auditService');
const discordEvents = require('../services/discordEventService');

const router = express.Router();
router.use(requireAdminToken);

router.delete('/:eventId', async (req, res) => {
  try {
    const result = await audit.run(
      'discord',
      'website_event_delete',
      {
        eventId: String(req.params.eventId || '').trim(),
        deletedBySteamId: String(req.body?.deletedBySteamId || '').trim() || null,
      },
      () => discordEvents.hideEventFromWebsite(req.params.eventId),
      (value) => ({
        eventId: value.eventId,
        title: value.title,
        duplicate: Boolean(value.duplicate),
      })
    );

    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'DISCORD_EVENT_NOT_FOUND' ? 404 : 400;
    res.status(status).json({
      error: error.message || 'Unable to delete event from the website.',
      code: error.code || null,
    });
  }
});

module.exports = router;
