const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const playerDirectory = require('../services/playerDirectoryService');

const router = express.Router();
router.use(requireAdminToken);

router.get('/', (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const players = playerDirectory.listPlayers();
    res.json({ players, count: players.length });
  } catch (error) {
    console.error('[player-directory]', error);
    res.status(500).json({ error: error.message || 'Unable to load player directory.' });
  }
});

module.exports = router;
