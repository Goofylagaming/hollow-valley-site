'use strict';

const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const arcade = require('../services/valleyArcade');
const recentWins = require('../services/valleyArcadeRecentWins');

const router = express.Router();
router.use(requireWebsiteToken);

// Same website token as the weekly board. steamId stays in the payload for the name lookup.
router.get('/recent-wins', (_req, res) => {
  if (process.env.VALLEY_ARCADE_ENABLED !== '1') return res.sendStatus(404);
  try {
    const config = arcade.settings();
    if (!config.enabled || config.emergency) return res.sendStatus(404);
    return res.json(recentWins.recent(Date.now()));
  } catch {
    return res.status(409).json({ error: 'Arcade unavailable. Try again later.' });
  }
});

module.exports = router;
