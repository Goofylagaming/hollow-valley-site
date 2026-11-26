const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const { db } = require('../services/economyStore');

const router = express.Router();
router.use(requireWebsiteToken);

router.post('/', (req, res) => {
  const seasonIndex = Number(req.body?.seasonIndex);
  const standings = Array.isArray(req.body?.standings) ? req.body.standings : null;
  if (!Number.isSafeInteger(seasonIndex) || seasonIndex < 1 || !standings) {
    return res.status(400).json({ error: 'Territory season archive is invalid.' });
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS vl_territory_seasons (
      season_index INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const payload = JSON.stringify({
    version: 1,
    seasonIndex,
    startedAt: req.body.startedAt || null,
    endedAt: req.body.endedAt || null,
    standings,
  });
  const existing = db.prepare('SELECT payload_json FROM vl_territory_seasons WHERE season_index = ?').get(seasonIndex);
  if (existing) {
    if (existing.payload_json !== payload) {
      return res.status(409).json({ error: 'Territory season archive already exists with different standings.' });
    }
    return res.json({ ok: true, duplicate: true });
  }
  db.prepare('INSERT INTO vl_territory_seasons (season_index, payload_json) VALUES (?, ?)').run(seasonIndex, payload);
  res.status(201).json({ ok: true, duplicate: false });
});

module.exports = router;
