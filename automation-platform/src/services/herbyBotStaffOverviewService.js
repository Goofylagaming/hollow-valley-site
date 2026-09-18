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

module.exports = { buildStaffOverview };
