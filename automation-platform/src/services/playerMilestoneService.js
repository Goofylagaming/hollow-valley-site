'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createMilestoneStore } = require('./playerMilestoneStore');
let store;
let delivering = false;
function gameAvailable() {
  const rcon = require('./rconControlService');
  return process.env.PLAYER_MILESTONES_ENABLED !== 'false' && process.env.PLAYER_MILESTONES_INGAME_ENABLED === 'true' &&
    process.env.RCON_DIRECT_MESSAGE_WRITE_ENABLED === 'true' &&
    rcon.writeEnabled('directMessage') && rcon.getState().configured;
}
async function deliver() {
  if (delivering || !gameAvailable()) return;
  delivering = true;
  try {
    for (const message of get().claimGameMessages()) {
      if (!gameAvailable()) break;
      try { await require('./rconControlService').execute('directMessage', message); }
      catch { console.warn('[player-milestones] private message unconfirmed; not retried'); }
    }
  } finally { delivering = false; }
}
function get() {
  if (!store) {
    const file = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '../../data/automation.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    try { require('./playerMilestoneBackup').backupBeforeMilestones(db, file); }
    catch (error) { db.close(); throw error; }
    const prime = require('./primeTrackerService');
    store = createMilestoneStore(db, { membership: location => {
      const layers = prime.loadZoneLayers();
      if (!location || !['x','y','z'].every(k => typeof location[k] === 'number' && Number.isFinite(location[k])) ||
          !Object.values(layers).some(value => Array.isArray(value) && value.length)) return { point: null };
      return prime.zoneMembership(location);
    }, normalizeSpecies: prime.normalizeSpecies, growthFraction: prime.growthFraction });
  }
  return store;
}
function recordSnapshot(players, sampledAt) {
  if (process.env.PLAYER_MILESTONES_ENABLED === 'false') return;
  for (const player of players) {
    try { get().record(player, Date.parse(sampledAt)); }
    catch (error) { console.warn('[player-milestones] observation failed:', error.message); }
  }
  void deliver().catch(error => console.warn('[player-milestones] delivery unavailable:', error.message));
}
function feed(id, after) {
  const enabled = process.env.PLAYER_MILESTONES_ENABLED !== 'false';
  const result = get().feed(id, after);
  return { ...result, events: enabled ? result.events : [], enabled, inGameAvailable: gameAvailable() };
}
module.exports = { get, recordSnapshot, feed, gameAvailable };
