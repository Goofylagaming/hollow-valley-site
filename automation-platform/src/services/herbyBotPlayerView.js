// Deliberately small DTOs: never return the upstream object, account IDs or coordinates.
async function playerView(discordId, view, services) {
  if (!/^[0-9]{8,32}$/.test(String(discordId))) throw new Error('INVALID_ID');
  if (!['player', 'wallet', 'quests', 'prime', 'dino'].includes(view)) throw new Error('INVALID_VIEW');
  const steamId = services.progression.steamIdForDiscord(discordId);
  if (!steamId) throw new Error('NOT_LINKED');
  let fields;
  if (view === 'player' || view === 'quests') {
    const profile = services.progression.getProfile(steamId, { sync: false });
    fields = view === 'player'
      ? { level: profile.level, xp: profile.xp, questsCompleted: profile.questsCompleted }
      : { completed: profile.questsCompleted };
  } else if (view === 'wallet') {
    fields = { balance: services.economy.getWallet(steamId).balance };
  } else if (view === 'prime') {
    const tracker = services.prime.trackerState(steamId);
    fields = { status: tracker.activeLife ? 'tracking' : 'no_active_life', prime: tracker.progress?.isPrime ?? false };
  } else {
    const snapshot = await services.status.getServerSnapshot();
    const character = snapshot.online && (snapshot.characters || []).find(c => c.steamId === steamId);
    fields = character ? { species: character.species, growth: character.growth, prime: character.isPrime === true }
      : { status: snapshot.online ? 'not_in_game' : 'server_offline' };
  }
  fields = Object.fromEntries(Object.entries(fields).filter(([,v]) =>
    ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v))));
  return { fields };
}
module.exports = { playerView };
