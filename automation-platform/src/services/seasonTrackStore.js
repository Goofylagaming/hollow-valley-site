"use strict";
const { createHash } = require('node:crypto');
const { parseSourceTimestamp } = require('./progressionSourceTime');

const SOURCES = Object.freeze({
  playtime: { reference: 'playtime_interval', basis: 'playtime-observation', policy: 'interval-end' },
  quest: { reference: 'quest', basis: 'quest-achievement', policy: 'achievement-time' },
  event: { reference: 'event', basis: 'event-confirmation', policy: 'confirmation-time' },
});
const fail = message => { throw new Error(message); };
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail('Complete season fields are required; unknown fields are not accepted');
  }
}
function text(value, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('Invalid season text');
  return value.trim();
}
function identity(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(value)) fail('Invalid season identity');
  return value;
}
function steam(value) {
  if (typeof value !== 'string' || !/^\d{17}$/.test(value)) fail('A verified Steam identity is required');
  return value;
}
function describe(input) {
  fields(input, ['id', 'title', 'startsAt', 'endsAt', 'settlesAt', 'free', 'sources', 'tiers']);
  if (input.free !== true) fail('Season enrollment and progression must be free');
  const startsAt = parseSourceTimestamp(input.startsAt), endsAt = parseSourceTimestamp(input.endsAt), settlesAt = parseSourceTimestamp(input.settlesAt);
  if (startsAt === null || endsAt === null || settlesAt === null || endsAt <= startsAt ||
      endsAt - startsAt > 366 * 86400000 || settlesAt < endsAt || settlesAt - endsAt > 30 * 86400000) fail('Invalid season or delayed-grant window');
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 3) fail('Review at least one supported XP source');
  const seen = new Set();
  const sources = input.sources.map(source => {
    fields(source, ['source', 'policy']);
    if (typeof source.source !== 'string' || !Object.hasOwn(SOURCES, source.source) ||
        SOURCES[source.source].policy !== source.policy || seen.has(source.source)) fail('Unsupported or duplicate season source policy');
    seen.add(source.source);
    return { source: source.source, policy: source.policy };
  }).sort((a, b) => a.source.localeCompare(b.source));
  if (!Array.isArray(input.tiers) || !input.tiers.length || input.tiers.length > 100) fail('Choose between one and 100 tiers');
  let previous = 0;
  const tiers = input.tiers.map(tier => {
    // Labels are milestones only. Reward definitions need their own approved contract.
    fields(tier, ['xp', 'title']);
    if (!Number.isSafeInteger(tier.xp) || tier.xp <= previous || tier.xp > 1000000000) fail('Tier XP must increase strictly');
    previous = tier.xp;
    return { xp: tier.xp, title: text(tier.title, 1, 80) };
  });
  const definition = { id: identity(input.id), title: text(input.title, 3, 120),
    startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
    settlesAt: new Date(settlesAt).toISOString(), free: true, sources, tiers };
  const json = JSON.stringify(definition);
  return { definition, digest: createHash('sha256').update(json).digest('hex') };
}

// Internal domain store only. No routes or producers call it yet. The eventual
// host/operator and player boundaries must authorize current identities themselves.
function createSeasonTrackStore(db, { now = Date.now, initialize = true, writable = () => {} } = {}) {
  if (initialize) db.exec(`
    CREATE TABLE IF NOT EXISTS progression_seasons (
      id TEXT PRIMARY KEY, definition_json TEXT NOT NULL, digest TEXT NOT NULL,
      reviewed_by TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('staged','published','closed')), revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progression_season_audit (
      id INTEGER PRIMARY KEY, season_id TEXT NOT NULL, revision INTEGER NOT NULL,
      action TEXT NOT NULL, actor TEXT NOT NULL, digest TEXT NOT NULL, at INTEGER NOT NULL,
      UNIQUE(season_id,revision));
    CREATE TABLE IF NOT EXISTS progression_season_enrollments (
      season_id TEXT NOT NULL, steam_id TEXT NOT NULL, enrolled_at INTEGER NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(season_id,steam_id));
    CREATE TABLE IF NOT EXISTS progression_season_evidence (
      season_id TEXT NOT NULL, steam_id TEXT NOT NULL, ledger_id TEXT NOT NULL,
      amount INTEGER NOT NULL, source TEXT NOT NULL, reference_type TEXT NOT NULL,
      source_at INTEGER NOT NULL, basis TEXT NOT NULL, ledger_created_at TEXT NOT NULL, accepted_at INTEGER NOT NULL,
      PRIMARY KEY(season_id,steam_id,ledger_id));
    CREATE TABLE IF NOT EXISTS progression_season_source_positions (
      position INTEGER PRIMARY KEY AUTOINCREMENT,ledger_id TEXT UNIQUE NOT NULL,steam_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS progression_season_source_cursor ON progression_season_source_positions(steam_id,position);
    CREATE TRIGGER IF NOT EXISTS progression_season_source_insert AFTER INSERT ON progression_xp_ledger BEGIN
      INSERT OR IGNORE INTO progression_season_source_positions(ledger_id,steam_id) VALUES(NEW.id,NEW.steam_id);
    END;
  `);
  function atomic(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const find = id => db.prepare('SELECT * FROM progression_seasons WHERE id=?').get(identity(id));
  function checked(id) {
    const row = find(id);
    if (!row) fail('Season not found');
    const reviewed = describe(JSON.parse(row.definition_json));
    const audit = db.prepare('SELECT * FROM progression_season_audit WHERE season_id=? AND revision=?').get(id, row.revision);
    if (reviewed.definition.id !== id || reviewed.digest !== row.digest ||
        !audit || audit.digest !== row.digest || audit.action !== row.state ||
        !['staged', 'published', 'closed'].includes(row.state)) fail('Season review evidence is unavailable');
    return { ...row, definition: reviewed.definition };
  }
  function read(id) {
    const row = checked(id);
    return { definition: row.definition, digest: row.digest, state: row.state, revision: row.revision };
  }
  function audit(id, revision, action, actor, digest) {
    db.prepare('INSERT INTO progression_season_audit(season_id,revision,action,actor,digest,at) VALUES(?,?,?,?,?,?)')
      .run(id, revision, action, actor, digest, now());
  }
  function stage(input, { reviewer, digest } = {}) {
    steam(reviewer); const value = describe(input);
    if (digest !== value.digest) fail('Season changed after review');
    return atomic(() => {
      writable(); const old = find(value.definition.id);
      if (old) {
        const current = read(value.definition.id);
        if (old.digest !== digest) fail('Season identity already has different immutable rules');
        return { ...current, duplicate: true };
      }
      if (Date.parse(value.definition.startsAt) <= now()) fail('Stage a future season; retroactive seasons are not supported');
      db.prepare('INSERT INTO progression_seasons VALUES(?,?,?,?,?,?,?)')
        .run(value.definition.id, JSON.stringify(value.definition), digest, reviewer, now(), 'staged', 1);
      audit(value.definition.id, 1, 'staged', reviewer, digest);
      return { ...read(value.definition.id), duplicate: false };
    });
  }
  function stateChangePlan(id, { digest, expectedRevision, action, reviewer } = {}) {
    steam(reviewer);
    if (!['publish', 'close'].includes(action) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('Review a supported season transition');
    const row = checked(id);
    if (row.digest !== digest || row.revision !== expectedRevision) fail('Season changed; inspect the current review');
    if (action === 'publish') {
      if (row.state !== 'staged' || now() >= Date.parse(row.definition.startsAt)) fail('Only a future staged season can be published');
      const others = db.prepare("SELECT id FROM progression_seasons WHERE state='published'").all();
      for (const other of others) {
        const def = checked(other.id).definition;
        if (Date.parse(def.startsAt) < Date.parse(row.definition.endsAt) && Date.parse(def.endsAt) > Date.parse(row.definition.startsAt)) fail('Published season windows must not overlap');
      }
    } else if (row.state !== 'published' || now() < Date.parse(row.definition.settlesAt)) {
      fail('Close a published season only after its delayed-grant window ends');
    }
    return { row, state: action === 'publish' ? 'published' : 'closed', reviewer, digest };
  }
  function reviewStateChange(id, options) {
    const plan = stateChangePlan(id, options);
    return { season: read(id), nextState: plan.state };
  }
  function changeState(id, options) {
    return atomic(() => {
      writable(); const { row, state, reviewer, digest } = stateChangePlan(id, options);
      db.prepare('UPDATE progression_seasons SET state=?,revision=revision+1 WHERE id=?').run(state, id);
      audit(id, row.revision + 1, state, reviewer, digest);
      return read(id);
    });
  }
  function enroll(id, steamId) {
    steam(steamId);
    return atomic(() => {
      writable(); const row = checked(id), at = now();
      if (row.state !== 'published' || at < Date.parse(row.definition.startsAt) || at >= Date.parse(row.definition.endsAt)) fail('Season enrollment is not open');
      // Bind consent to the source ledger position too: same-millisecond delete /
      // rejoin and small future clock skew cannot resurrect pre-consent grants.
      const cursor = db.prepare('SELECT coalesce(max(position),0) n FROM progression_season_source_positions WHERE steam_id=?').get(steamId).n;
      db.prepare('INSERT OR IGNORE INTO progression_season_enrollments(season_id,steam_id,enrolled_at,cursor) VALUES(?,?,?,?)').run(id, steamId, at, cursor);
      return enrollment(id, steamId);
    });
  }
  const enrollment = (id, steamId) => db.prepare('SELECT enrolled_at AS enrolledAt,cursor FROM progression_season_enrollments WHERE season_id=? AND steam_id=?').get(id, steamId) || null;
  function erase(id, steamId) {
    steam(steamId); identity(id);
    // Recovery/privacy action stays available even if catalog evidence is corrupt.
    return atomic(() => {
      writable();
      db.prepare('DELETE FROM progression_season_evidence WHERE season_id=? AND steam_id=?').run(id, steamId);
      return { erased: Boolean(db.prepare('DELETE FROM progression_season_enrollments WHERE season_id=? AND steam_id=?').run(id, steamId).changes) };
    });
  }
  function reconcile(id, steamId, { limit = 500 } = {}) {
    steam(steamId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('Invalid season evidence batch size');
    return atomic(() => {
      writable(); const row = checked(id), participant = enrollment(id, steamId), at = now();
      if (!participant) fail('Enroll before collecting seasonal progress');
      if (!['published', 'closed'].includes(row.state)) fail('Season has not been published');
      const rows = db.prepare(`SELECT p.position,l.*,t.source_at,t.basis FROM progression_season_source_positions p
        LEFT JOIN progression_xp_ledger l ON l.id=p.ledger_id AND l.steam_id=p.steam_id
        LEFT JOIN progression_xp_source_times t ON t.ledger_id=l.id
        WHERE p.steam_id=? AND p.position>? ORDER BY p.position LIMIT ?`).all(steamId, participant.cursor, limit + 1);
      const batch = rows.slice(0, limit), enabled = new Set(row.definition.sources.map(s => s.source));
      const start = Math.max(participant.enrolledAt, Date.parse(row.definition.startsAt)), end = Date.parse(row.definition.endsAt);
      let accepted = 0;
      for (const grant of batch) {
        const contract = Object.hasOwn(SOURCES, grant.source) ? SOURCES[grant.source] : null;
        const receivedAt = parseSourceTimestamp(grant.created_at);
        if (!enabled.has(grant.source) || !contract || grant.reference_type !== contract.reference || grant.basis !== contract.basis ||
            !Number.isSafeInteger(grant.source_at) || grant.source_at < start || grant.source_at >= end || grant.source_at > at + 120000 ||
            receivedAt === null || receivedAt >= Date.parse(row.definition.settlesAt) || receivedAt > at || grant.source_at > receivedAt + 120000 ||
            !Number.isSafeInteger(grant.amount) || grant.amount <= 0 || grant.amount > 1000000000) continue;
        accepted += db.prepare('INSERT OR IGNORE INTO progression_season_evidence VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(id, steamId, grant.id, grant.amount, grant.source, grant.reference_type, grant.source_at, grant.basis, grant.created_at, at).changes;
      }
      if (batch.length) db.prepare('UPDATE progression_season_enrollments SET cursor=? WHERE season_id=? AND steam_id=?').run(batch.at(-1).position, id, steamId);
      return { accepted, scanned: batch.length, more: rows.length > limit };
    });
  }
  function progress(id, steamId) {
    steam(steamId); const row = checked(id), participant = enrollment(id, steamId), at = now();
    if (!participant) return { season: read(id), enrolled: false, xp: 0, tier: 0, nextTier: row.definition.tiers[0], pending: false };
    // Recheck original evidence on every projection. Deleted/altered source rows
    // cannot leave a previously copied seasonal entitlement in force.
    const totals = db.prepare(`SELECT coalesce(sum(CASE WHEN l.id IS NOT NULL AND l.steam_id=e.steam_id
      AND l.amount=e.amount AND l.source=e.source AND l.reference_type=e.reference_type AND l.created_at=e.ledger_created_at
      AND t.source_at=e.source_at AND t.basis=e.basis AND e.source_at<=? THEN e.amount ELSE 0 END),0) AS xp,
      sum(CASE WHEN l.id IS NULL OR l.steam_id!=e.steam_id OR l.amount!=e.amount OR l.source!=e.source
      OR l.reference_type IS NOT e.reference_type OR l.created_at IS NOT e.ledger_created_at
      OR t.source_at IS NOT e.source_at OR t.basis IS NOT e.basis THEN 1 ELSE 0 END) AS invalid
      FROM progression_season_evidence e LEFT JOIN progression_xp_ledger l ON l.id=e.ledger_id
      LEFT JOIN progression_xp_source_times t ON t.ledger_id=e.ledger_id WHERE e.season_id=? AND e.steam_id=?`).get(at, id, steamId);
    if (!Number.isSafeInteger(totals.xp)) fail('Season progress exceeds supported range');
    const pending = Boolean(db.prepare('SELECT 1 FROM progression_season_source_positions WHERE steam_id=? AND position>? LIMIT 1').get(steamId, participant.cursor));
    const tier = row.definition.tiers.filter(t => t.xp <= totals.xp).length;
    return { season: read(id), enrolled: true, enrolledAt: participant.enrolledAt, xp: totals.xp, tier,
      nextTier: row.definition.tiers[tier] || null, pending,
      evidenceUnavailable: Boolean(totals.invalid), collectionClosed: row.state === 'closed' || at >= Date.parse(row.definition.settlesAt) };
  }
  return { stage, read, reviewStateChange, changeState, enroll, erase, reconcile, progress };
}
module.exports = { describe, createSeasonTrackStore, SOURCES };
