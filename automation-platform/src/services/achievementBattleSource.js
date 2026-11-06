"use strict";
const { parseSourceTimestamp } = require('./progressionSourceTime');
const { canonicalCombatSpecies } = require('../config/combatSpecies');
const ready = (db, name, fields) => {
  const columns = new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
  return fields.every(field => columns.has(field));
};
function deriveCombatSource(db, steamId) {
  if (!ready(db, 'combat_events', ['id','occurred_at','killer_steam_id','victim_steam_id','victim_species','source'])) return null;
  const rows = db.prepare('SELECT id,occurred_at,victim_steam_id,victim_species,source FROM combat_events WHERE killer_steam_id=? AND killer_steam_id<>victim_steam_id AND victim_species IS NOT NULL LIMIT 10001').all(steamId);
  if (rows.length > 10000) return null;
  const entries = [];
  for (const row of rows) {
    const species = canonicalCombatSpecies(row.victim_species);
    if (!species) continue; // Unknown historical labels never become a species.
    const at = parseSourceTimestamp(row.occurred_at);
    if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 256 || typeof row.victim_steam_id !== 'string' || !/^\d{17}$/.test(row.victim_steam_id) ||
        typeof row.source !== 'string' || !/^[A-Za-z0-9_.:-]{2,80}$/.test(row.source) || at === null) return null;
    entries.push({ id: row.id, at, rawAt: row.occurred_at, species, rawSpecies: row.victim_species, victim: row.victim_steam_id, source: row.source });
  }
  entries.sort((a,b) => a.at-b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set(), selected = [];
  for (const entry of entries) {
    if (seen.has(entry.species)) continue;
    seen.add(entry.species); selected.push(entry);
    if (selected.length === 5) break;
  }
  return selected.length === 5 ? { sourceAt: selected[4].at, evidence: { killer: steamId, events: selected } } : null;
}
function deriveTerritorySource(db, steamId, { asOf = Date.now() } = {}) {
  if (!ready(db,'progression_territory_winners',['attack_id','steam_id']) ||
      !ready(db,'progression_territory_results',['attack_id','event_id','payload_json','received_at'])) return null;
  const rows = db.prepare(`SELECT w.attack_id AS winner_attack,r.* FROM progression_territory_winners w
    LEFT JOIN progression_territory_results r ON r.attack_id=w.attack_id WHERE w.steam_id=? LIMIT 10001`).all(steamId);
  if (!rows.length || rows.length > 10000) return null;
  const entries = [];
  for (const row of rows) {
    let payload; try { payload = JSON.parse(row.payload_json); } catch { return null; }
    const fields = ['version','attackId','eventId','startedAt','resolvedAt','outcome','provenance','winners'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== fields.length || fields.some(key => !Object.hasOwn(payload,key)) ||
        payload.version !== 1 || payload.provenance !== 'recorded-live' || payload.outcome !== 'capture' ||
        ![row.attack_id,row.event_id,payload.startedAt,payload.resolvedAt,row.received_at].every(Number.isSafeInteger) || row.attack_id <= 0 || row.event_id <= 0 ||
        payload.attackId !== row.attack_id || row.winner_attack !== row.attack_id || payload.eventId !== row.event_id || payload.startedAt < 0 || payload.resolvedAt <= payload.startedAt ||
        row.received_at < 0 || row.received_at > asOf || payload.resolvedAt > row.received_at+120000 ||
        !Array.isArray(payload.winners) || !payload.winners.length || payload.winners.length > 256 ||
        payload.winners.some(id => typeof id !== 'string' || !/^\d{17}$/.test(id)) || new Set(payload.winners).size !== payload.winners.length || !payload.winners.includes(steamId)) return null;
    entries.push({ at: payload.resolvedAt, receivedAt: row.received_at, payload: { version: 1, attackId: row.attack_id, eventId: row.event_id,
      startedAt: payload.startedAt, resolvedAt: payload.resolvedAt, outcome: 'capture', provenance: 'recorded-live', winners: [...payload.winners].sort() } });
  }
  entries.sort((a,b) => a.at-b.at || a.payload.attackId-b.payload.attackId);
  const first = entries[0];
  const roster = db.prepare('SELECT steam_id FROM progression_territory_winners WHERE attack_id=? ORDER BY steam_id LIMIT 257').all(first.payload.attackId).map(row=>row.steam_id);
  if (JSON.stringify(roster) !== JSON.stringify(first.payload.winners) ||
      db.prepare('SELECT 1 FROM progression_territory_results WHERE event_id=? AND attack_id<>? LIMIT 1').get(first.payload.eventId,first.payload.attackId)) return null;
  return { sourceAt: first.at, evidence: first };
}
module.exports = { deriveCombatSource, deriveTerritorySource };
