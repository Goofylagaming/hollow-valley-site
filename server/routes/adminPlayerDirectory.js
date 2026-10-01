const express = require('express');
const { requireAdmin } = require('../middleware/requireAuth');
const playerDirectory = require('../services/playerDirectoryClient');

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await playerDirectory.listPlayers());
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    res.status(status).json({ error: error.message || 'Could not load player directory.' });
  }
});

module.exports = router;
