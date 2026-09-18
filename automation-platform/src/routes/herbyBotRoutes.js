const express = require('express');
const { requireHerbyBotToken } = require('../middleware/herbyBotAuth');
const herbyBot = require('../services/herbyBotOutboxService');
const { getPublicStatus, getServerSnapshot, requestSummary } = require('../services/statusService');

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
    const charactersBySteamId = new Map(
      (snapshot.characters || []).map((character) => [character.steamId, character])
    );
    const players = (snapshot.players || []).map((player) => {
      const character = charactersBySteamId.get(player.steamId);
      return {
        name: player.name || 'Unknown player',
        species: character?.species || null,
        growth: Number.isFinite(character?.growth) ? character.growth : null,
      };
    });

    res.json({
      server: {
        online: Boolean(snapshot.online),
        configured: snapshot.configured !== false,
        playerCount: players.length,
        maxPlayers: snapshot.maxPlayers ?? null,
        checkedAt: snapshot.checkedAt || null,
        players,
      },
      requests: requestSummary(),
      outbox: herbyBot.getState().outbox,
    });
  } catch (error) {
    res.status(503).json({ error: error.message || 'HerbyBot staff overview unavailable.' });
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
