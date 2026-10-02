const express = require('express');
const { requireAdminToken } = require('../middleware/adminAuth');
const playerPresence = require('../services/playerPresenceService');

const router = express.Router();
router.use(requireAdminToken);

router.get('/', (_req, res) => {
  try {
    const sessions = playerPresence.listSessions({ limit: 500 });
    const bySteam = new Map();

    for (const session of sessions) {
      const steamId = String(session.steam_id || '').trim();
      if (!/^\d{17}$/.test(steamId)) continue;

      const startedAt = session.started_at || null;
      const lastSeenAt = session.ended_at || session.last_seen_at || startedAt;
      const startMs = Date.parse(startedAt || '');
      const endMs = Date.parse(lastSeenAt || '');
      const durationSeconds = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.floor((endMs - startMs) / 1000))
        : 0;

      const existing = bySteam.get(steamId) || {
        uniquePlayerId: steamId,
        name: session.player_name || 'Unknown player',
        firstSeen: startedAt,
        lastSeen: lastSeenAt,
        totalPlaytimeSeconds: 0,
        online: false,
      };

      if (startedAt && (!existing.firstSeen || Date.parse(startedAt) < Date.parse(existing.firstSeen))) {
        existing.firstSeen = startedAt;
      }
      if (lastSeenAt && (!existing.lastSeen || Date.parse(lastSeenAt) >= Date.parse(existing.lastSeen))) {
        existing.lastSeen = lastSeenAt;
        existing.name = session.player_name || existing.name;
      }
      existing.totalPlaytimeSeconds += durationSeconds;
      if (!session.ended_at) existing.online = true;
      bySteam.set(steamId, existing);
    }

    const players = [...bySteam.values()].sort((a, b) =>
      Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );

    res.json({ players });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to build player directory.' });
  }
});

module.exports = router;
