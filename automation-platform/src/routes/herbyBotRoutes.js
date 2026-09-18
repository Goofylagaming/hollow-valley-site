const express = require('express');
const { requireHerbyBotToken } = require('../middleware/herbyBotAuth');
const herbyBot = require('../services/herbyBotOutboxService');
const { getPublicStatus } = require('../services/statusService');

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
