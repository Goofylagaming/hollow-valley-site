'use strict';
const { randomUUID } = require('node:crypto');
const DEFAULTS = Object.freeze({ sanctuary: true, patrol: true, migration: true, inGame: false });
const KINDS = ['sanctuary', 'patrol', 'migration'];
const GAP_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;

// Optional stable save identity and explicit death evidence from the trusted scanner.
function telemetry(player) {
  return {
    dinosaurId: typeof player.dinosaurId === 'string' && /^[\w:.-]{1,128}$/.test(player.dinosaurId) ? player.dinosaurId : null,
    isDead: typeof player.isDead === 'boolean' ? player.isDead : null,
  };
}
function steam(value) {
  if (!/^\d{17}$/.test(String(value))) throw new Error('Steam login required');
  return String(value);
}
function createMilestoneStore(db, { membership, normalizeSpecies, growthFraction }) {
  const growthValue = value => typeof value === 'number' && Number.isFinite(value) ? growthFraction(value) : null;
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_milestone_state (
      steam_id TEXT PRIMARY KEY, sampled_at INTEGER NOT NULL, state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_milestone_preferences (
      steam_id TEXT PRIMARY KEY, preferences_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_milestone_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, steam_id TEXT NOT NULL,
      life_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, category TEXT NOT NULL,
      message TEXT NOT NULL, game_attempted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS milestone_events_player ON player_milestone_events(steam_id,id);
  `);
  function preferences(id) {
    const row = db.prepare('SELECT preferences_json FROM player_milestone_preferences WHERE steam_id=?').get(steam(id));
    return { ...DEFAULTS, ...(row ? JSON.parse(row.preferences_json) : {}) };
  }
  function setPreferences(id, patch) {
    steam(id);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.entries(patch).some(([key, value]) => !Object.hasOwn(DEFAULTS, key) || typeof value !== 'boolean')) {
      throw new Error('Notification settings must be boolean values');
    }
    const next = { ...preferences(id), ...patch };
    db.prepare(`INSERT INTO player_milestone_preferences VALUES (?,?)
      ON CONFLICT(steam_id) DO UPDATE SET preferences_json=excluded.preferences_json`).run(id, JSON.stringify(next));
    return next;
  }
  function read(id) {
    const row = db.prepare('SELECT * FROM player_milestone_state WHERE steam_id=?').get(steam(id));
    return row ? { ...JSON.parse(row.state_json), sampledAt: row.sampled_at } : null;
  }
  function fresh(player, at) {
    return { lifeId: randomUUID(), startedAt: at, species: normalizeSpecies(player.species),
      growth: growthValue(player.growth), dinosaurId: telemetry(player).dinosaurId,
      ended: false, current: {}, pending: {}, lastNotice: {},
      visits: Object.fromEntries(KINDS.map(k => [k, []])), entries: Object.fromEntries(KINDS.map(k => [k, 0])) };
  }
  function record(player, at) {
    const id = steam(player.steamId);
    if (!Number.isFinite(at)) throw new Error('Invalid observation timestamp');
    db.exec('BEGIN IMMEDIATE');
    try {
      let state = read(id);
      if (state && at <= state.sampledAt) { db.exec('COMMIT'); return; }
      const data = telemetry(player);
      const species = normalizeSpecies(player.species);
      const growth = growthValue(player.growth);
      // Combat evidence is read locally, never a network dependency in the transaction.
      const hasCombat = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='combat_events'").get();
      const death = state && hasCombat ? db.prepare(`SELECT occurred_at FROM combat_events
        WHERE victim_steam_id=? AND julianday(occurred_at)>julianday(?) AND julianday(occurred_at)<=julianday(?)
        ORDER BY occurred_at DESC LIMIT 1`).get(id, new Date(state.startedAt).toISOString(), new Date(at).toISOString()) : null;
      const deadNow = data.isDead === true || (typeof player.health === 'number' && player.health <= 0);
      const newDinosaur = state && ((data.dinosaurId && state.dinosaurId && data.dinosaurId !== state.dinosaurId) ||
        (species && state.species && species !== state.species) ||
        (growth !== null && state.growth !== null && state.growth >= 0.35 && growth <= 0.12));
      // Missing species/health after death is not evidence of a respawn.
      if (!state || newDinosaur || (state.ended && !deadNow && species &&
          (data.isDead === false || (typeof player.health === 'number' && player.health > 0)))) state = fresh(player, at);
      if (death && !newDinosaur && Date.parse(death.occurred_at) > state.startedAt) {
        // A later live observation starts a new life; the death sample itself closes it.
        if (!deadNow && species && typeof player.health === 'number' && player.health > 0 && at > Date.parse(death.occurred_at)) state = fresh(player, at);
        else state.ended = true;
      }
      if (deadNow) state.ended = true;
      const baseline = !state.sampledAt || at - state.sampledAt > GAP_MS;
      const prefs = preferences(id);
      const emit = (category, message) => {
        if (baseline || !prefs[category] || at - (state.lastNotice[category] || 0) < COOLDOWN_MS) return;
        state.lastNotice[category] = at;
        db.prepare(`INSERT INTO player_milestone_events(steam_id,life_id,occurred_at,category,message)
          VALUES (?,?,?,?,?)`).run(id, state.lifeId, at, category, message);
      };
      const observe = (key, value, changed) => {
        state.unknown ||= {};
        if (value === null) { delete state.pending[key]; state.unknown[key] = true; return; }
        const encoded = JSON.stringify(value);
        if (baseline || state.unknown[key] || !Object.hasOwn(state.current, key)) {
          delete state.unknown[key];
          state.current[key] = value; delete state.pending[key]; changed(value, null); return;
        }
        if (encoded === JSON.stringify(state.current[key])) { delete state.pending[key]; return; }
        const pending = state.pending[key];
        if (!pending || pending.value !== encoded) { state.pending[key] = { value: encoded, at }; return; }
        if (at - pending.at < 3000) return;
        const prior = state.current[key]; state.current[key] = value; delete state.pending[key]; changed(value, prior);
      };
      if (!state.ended) {
        const zones = membership(player.location);
        for (const [kind, key] of [['sanctuary','sanctuaries'], ['patrol','patrolZones'], ['migration','migrations']]) {
          observe(kind, zones.point ? [...new Set(zones[key])].sort() : null, (names, prior) => {
            const entered = names.filter(name => !(prior || []).includes(name));
            for (const name of entered) {
              const known = state.visits[kind].includes(name);
              // On reconnect, only a previously unseen footprint proves another visit.
              if (prior !== null || !known) state.entries[kind]++;
              if (!known) state.visits[kind].push(name);
            }
            if (prior === null) return; // Initial observation is not an entrance alert.
            if (kind === 'sanctuary') {
              const left = prior.filter(name => !names.includes(name));
              const parts = [];
              if (left.length) parts.push(`Sanctuary left: ${left.join(', ')}`);
              if (entered.length) parts.push(`Sanctuary entered: ${entered.join(', ')}`);
              if (parts.length) emit(kind, parts.join(' · '));
            } else if (entered.length) {
              emit(kind, `${kind === 'patrol' ? 'Patrol' : 'Migration'} mapped zone entered: ${entered.join(', ')} — ${state.visits[kind].length} unique, ${state.entries[kind]} entries this life.`);
            }
          });
        }
      }
      state.species = species || state.species;
      if (growth !== null) state.growth = growth;
      state.dinosaurId = data.dinosaurId || state.dinosaurId;
      db.prepare(`INSERT INTO player_milestone_state VALUES (?,?,?) ON CONFLICT(steam_id)
        DO UPDATE SET sampled_at=excluded.sampled_at,state_json=excluded.state_json`).run(id, at, JSON.stringify(state));
      db.prepare(`DELETE FROM player_milestone_events WHERE steam_id=? AND id NOT IN
        (SELECT id FROM player_milestone_events WHERE steam_id=? ORDER BY id DESC LIMIT 100)`).run(id, id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function feed(id, after) {
    const state = read(id), prefs = preferences(id);
    const latest = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM player_milestone_events WHERE steam_id=?').get(id).id;
    const cursor = after === undefined ? latest : Number(after);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid notification cursor');
    const events = db.prepare(`SELECT id,life_id AS lifeId,occurred_at AS occurredAt,category,message FROM player_milestone_events
      WHERE steam_id=? AND id>? ORDER BY id LIMIT 100`).all(id, cursor);
    return { steamId: id, cursor: latest, preferences: prefs,
      events: events.filter(e => prefs[e.category] && e.lifeId === state?.lifeId && !state?.ended && Date.now() - e.occurredAt < 120000),
      stats: state ? { lifeId: state.lifeId, startedAt: state.startedAt, sampledAt: state.sampledAt, ended: state.ended,
        unique: Object.fromEntries(KINDS.map(k => [k, state.visits[k].length])), entries: state.entries } : null };
  }
  function claimGameMessages(now = Date.now()) {
    // Claim before sending: a timeout or crash may drop a message, never replay it.
    db.exec('BEGIN IMMEDIATE');
    try {
      const rows = db.prepare(`SELECT * FROM player_milestone_events WHERE game_attempted=0 AND occurred_at>? ORDER BY id LIMIT 100`).all(now - 120000);
      const messages = new Map();
      for (const row of rows) {
        const prefs = preferences(row.steam_id), state = read(row.steam_id);
        db.prepare('UPDATE player_milestone_events SET game_attempted=1 WHERE id=?').run(row.id);
        if (!prefs.inGame || !prefs[row.category] || state?.ended || state?.lifeId !== row.life_id) continue;
        const list = messages.get(row.steam_id) || [];
        list.push(row.message); messages.set(row.steam_id, list);
      }
      db.exec('COMMIT');
      return [...messages].map(([steamId, parts]) => ({ steamId, message: parts.join(' | ').replace(/[\x00-\x1f\x7f,]/g, ' ').slice(0, 240) }));
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { record, read, feed, preferences, setPreferences, claimGameMessages };
}
module.exports = { createMilestoneStore, telemetry, DEFAULTS };
