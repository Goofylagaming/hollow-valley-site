function buildStaffOverview(snapshot = {}, { requests = {}, outbox = {} } = {}) {
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

  return {
    server: {
      online: Boolean(snapshot.online),
      configured: snapshot.configured !== false,
      playerCount: players.length,
      maxPlayers: snapshot.maxPlayers ?? null,
      checkedAt: snapshot.checkedAt || null,
      players,
    },
    requests,
    outbox,
  };
}

function buildStaffActivityAnalytics(analytics = {}) {
  return {
    enabled: Boolean(analytics.enabled),
    hours: Number(analytics.hours) || 24,
    uniquePlayers: Number(analytics.uniquePlayers) || 0,
    returningPlayers: Number(analytics.returningPlayers) || 0,
    sessions: Number(analytics.sessions) || 0,
    trackedMinutes: Number(analytics.trackedMinutes) || 0,
    peakConcurrent: Number(analytics.peakConcurrent) || 0,
    averageOnline: Number(analytics.averageOnline) || 0,
    averageSessionMinutes: Number(analytics.averageSessionMinutes) || 0,
    medianSessionMinutes: Number(analytics.medianSessionMinutes) || 0,
    longestSessionMinutes: Number(analytics.longestSessionMinutes) || 0,
    sampleCount: Number(analytics.sampleCount) || 0,
    topPlayers: (analytics.topPlayers || []).slice(0, 10).map((player) => ({
      name: player.name || 'Unknown player',
      sessions: Number(player.sessions) || 0,
      trackedMinutes: Number(player.trackedMinutes) || 0,
    })),
    topSpecies: (analytics.topSpecies || []).slice(0, 8).map((item) => ({
      species: item.species || 'Unknown',
      samplePlayerCount: Number(item.samplePlayerCount) || 0,
    })),
    windowStart: analytics.windowStart || null,
    windowEnd: analytics.windowEnd || null,
  };
}

module.exports = { buildStaffOverview, buildStaffActivityAnalytics };
