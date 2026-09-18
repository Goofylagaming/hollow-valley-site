const express = require('express');
const { requireHerbyBotToken } = require('../middleware/herbyBotAuth');
const herbyBot = require('../services/herbyBotOutboxService');
const { getPublicStatus, getServerSnapshot, requestSummary } = require('../services/statusService');
const { buildStaffOverview } = require('../services/herbyBotStaffOverviewService');
const scheduler = require('../services/schedulerService');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireHerbyBotToken);

router.get('/status', async (_req, res) => {
  try {
    const publicStatus = await getPublicStatus();
    res.json({
      ok: true,
      bridge: herbyBot.getState(),
      server: publicStatus.server,
      automation: {
        service: publicStatus.service,
        time: publicStatus.time,
        integrations: publicStatus.integrations,
        modules: publicStatus.modules,
      },
    });
  } catch (error) {
    res.status(503).json({ error: error.message || 'HerbyBot bridge status unavailable.' });
  }
});

router.get('/staff-overview', async (_req, res) => {
  try {
    const snapshot = await getServerSnapshot();
    res.json(buildStaffOverview(snapshot, {
      requests: requestSummary(),
      outbox: herbyBot.getState().outbox,
    }));
  } catch (error) {
    res.status(503).json({ error: error.message || 'HerbyBot staff overview unavailable.' });
  }
});

router.post('/commands/announcement', async (req, res) => {
  const message = String(req.body?.message || '');
  const nonce = String(req.body?.nonce || '').trim();
  try {
    if (!/^slash:[0-9]{8,32}$/.test(nonce)) throw new Error('A valid Discord interaction nonce is required');
    const event = await audit.run('herbybot', 'slash_announcement', {
      messageLength: message.trim().length,
    }, async () => herbyBot.queueAnnouncement(message, { nonce }),
    (value) => ({ outboxEventId: value.id, destination: value.destination }));
    res.status(202).json({ ok: true, event });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to queue HerbyBot announcement.' });
  }
});

router.post('/commands/schedule', async (req, res) => {
  const message = String(req.body?.message || '');
  const runAt = req.body?.runAt;
  const recurrence = req.body?.recurrence || 'none';
  const nonce = String(req.body?.nonce || '').trim();
  try {
    if (!/^[0-9]{8,32}$/.test(nonce)) throw new Error('A valid Discord interaction nonce is required');
    const job = await audit.run('scheduler', 'herbybot_slash_schedule', {
      messageLength: message.trim().length,
      runAt: runAt || null,
      recurrence,
    }, async () => scheduler.createDiscordAnnouncementJob({
      message,
      runAt,
      recurrence,
      jobId: `herbybot:${nonce}`,
    }), (value) => ({ jobId: value.id, status: value.status }));
    res.status(201).json({ ok: true, job });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to schedule HerbyBot announcement.' });
  }
});

router.post('/outbox/claim', (req, res) => {
  try {
    const events = herbyBot.claimMessages({
      limit: req.body?.limit,
      leaseSeconds: req.body?.leaseSeconds,
    });
    res.json({ events });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to claim HerbyBot messages.' });
  }
});

router.post('/outbox/:id/ack', (req, res) => {
  try {
    res.json({ ok: true, event: herbyBot.acknowledgeMessage(req.params.id) });
  } catch (error) {
    res.status(404).json({ error: error.message || 'HerbyBot outbox event not found.' });
  }
});

router.post('/outbox/:id/fail', (req, res) => {
  try {
    res.json({
      ok: true,
      event: herbyBot.failMessage(req.params.id, req.body?.error || 'HerbyBot delivery failed'),
    });
  } catch (error) {
    res.status(404).json({ error: error.message || 'HerbyBot outbox event not found.' });
  }
});

module.exports = router;
