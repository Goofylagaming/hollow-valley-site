"use strict";
const { createHash } = require('node:crypto');
const { parseSourceTimestamp } = require('./progressionSourceTime');
const { CONTRACTS, createAchievementSourceTimeStore } = require('./achievementSourceTime');

const SOURCES = Object.freeze({
  playtime: { reference: 'playtime_interval', basis: 'playtime-observation', policy: 'interval-end' },
  quest: { reference: 'quest', basis: 'quest-achievement', policy: 'achievement-time' },
  event: { reference: 'event', basis: 'event-confirmation', policy: 'confirmation-time' },
});
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
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
  const retentionProvided = input && Object.hasOwn(input, 'retainUntil');
  const achievementsProvided = input && Object.hasOwn(input, 'achievementPoints');
  fields(input, ['id', 'title', 'startsAt', 'endsAt', 'settlesAt', 'free', 'sources', 'tiers', ...(retentionProvided ? ['retainUntil'] : []), ...(achievementsProvided ? ['achievementPoints'] : [])]);
  if (input.free !== true) fail('Season enrollment and progression must be free');
  const startsAt = parseSourceTimestamp(input.startsAt), endsAt = parseSourceTimestamp(input.endsAt), settlesAt = parseSourceTimestamp(input.settlesAt);
  if (startsAt === null || endsAt === null || settlesAt === null || endsAt <= startsAt ||
      endsAt - startsAt > 366 * 86400000 || settlesAt < endsAt || settlesAt - endsAt > 30 * 86400000) fail('Invalid season or delayed-grant window');
  const retainUntil = retentionProvided ? parseSourceTimestamp(input.retainUntil) : null;
  if (retentionProvided && (retainUntil === null || retainUntil <= settlesAt || retainUntil - settlesAt > 366 * 86400000)) fail('Review a retention date after settlement and within 366 days');
  let achievementPoints;
  if (achievementsProvided) {
    fields(input.achievementPoints, ['policy','awards']);
    if (input.achievementPoints.policy !== 'qualifying-source-time' || !Array.isArray(input.achievementPoints.awards) || !input.achievementPoints.awards.length || input.achievementPoints.awards.length > Object.keys(CONTRACTS).length) fail('Review a supported achievement point policy');
    const ids = new Set();
    const awards = input.achievementPoints.awards.map(award => {
      fields(award, ['id','xp']);
      if (typeof award.id !== 'string' || !Object.hasOwn(CONTRACTS, award.id) || ids.has(award.id) || !Number.isSafeInteger(award.xp) || award.xp < 1 || award.xp > 1000000) fail('Choose unique supported achievements and positive whole seasonal points');
      ids.add(award.id); return { id: award.id, xp: award.xp };
    }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    achievementPoints = { policy: 'qualifying-source-time', awards };
  }
  if (!Array.isArray(input.sources) || (!input.sources.length && !achievementPoints) || input.sources.length > 3) fail('Review at least one supported XP source');
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
  if (retentionProvided) definition.retainUntil = new Date(retainUntil).toISOString();
  if (achievementsProvided) definition.achievementPoints = achievementPoints;
  const json = JSON.stringify(definition);
  return { definition, digest: createHash('sha256').update(json).digest('hex') };
}

// Host/operator and player boundaries authorize current identities themselves.
function createSeasonTrackStore(db, { now = Date.now, initialize = true, writable = () => {} } = {}) {
  if (initialize) db.exec(`
    CREATE TABLE IF NOT EXISTS progression_season_retention (
      season_id TEXT PRIMARY KEY,digest TEXT NOT NULL,retain_until INTEGER NOT NULL,cleaned_at INTEGER);
    CREATE INDEX IF NOT EXISTS progression_season_retention_due ON progression_season_retention(cleaned_at,retain_until);
    CREATE TABLE IF NOT EXISTS progression_season_maintenance (id INTEGER PRIMARY KEY CHECK(id=1),source_cursor INTEGER NOT NULL);
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
    CREATE TABLE IF NOT EXISTS progression_season_achievement_cursors (
      season_id TEXT NOT NULL,steam_id TEXT NOT NULL,source_floor INTEGER NOT NULL,PRIMARY KEY(season_id,steam_id));
    CREATE TABLE IF NOT EXISTS progression_season_achievement_evidence (
      season_id TEXT NOT NULL,steam_id TEXT NOT NULL,achievement_id TEXT NOT NULL,xp INTEGER NOT NULL,
      source_position INTEGER NOT NULL,source_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,basis TEXT NOT NULL,
      award_digest TEXT NOT NULL,evidence_digest TEXT NOT NULL,PRIMARY KEY(season_id,steam_id,achievement_id));
    CREATE TABLE IF NOT EXISTS progression_season_choices (
      season_id TEXT NOT NULL,steam_id TEXT NOT NULL,revision INTEGER NOT NULL,
      selected INTEGER NOT NULL,changed_at INTEGER NOT NULL,PRIMARY KEY(season_id,steam_id));
    CREATE TABLE IF NOT EXISTS progression_season_requests (
      steam_id TEXT NOT NULL,request_key TEXT NOT NULL,season_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,result_json TEXT NOT NULL,at INTEGER NOT NULL,
      PRIMARY KEY(steam_id,request_key));
    CREATE INDEX IF NOT EXISTS progression_season_request_rate ON progression_season_requests(steam_id,at);
    CREATE INDEX IF NOT EXISTS progression_season_request_retention ON progression_season_requests(season_id);
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
  function achievementStore() {
    if (!['progression_achievements','progression_achievement_sources'].every(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))) fail('Achievement source evidence is unavailable', 503);
    return createAchievementSourceTimeStore(db, { initialize: false, now });
  }
  function checked(id) {
    const row = find(id);
    if (!row) fail('Season not found', 404);
    const reviewed = describe(JSON.parse(row.definition_json));
    const audit = db.prepare('SELECT * FROM progression_season_audit WHERE season_id=? AND revision=?').get(id, row.revision);
    if (reviewed.definition.id !== id || reviewed.digest !== row.digest ||
        !audit || audit.digest !== row.digest || audit.action !== row.state ||
        !['staged', 'published', 'closed'].includes(row.state)) fail('Season review evidence is unavailable', 503);
    const retention = db.prepare('SELECT * FROM progression_season_retention WHERE season_id=?').get(id);
    if (reviewed.definition.retainUntil ? (!retention || retention.digest !== row.digest || retention.retain_until !== Date.parse(reviewed.definition.retainUntil)) : Boolean(retention)) fail('Season retention review is unavailable', 503);
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
      if (!value.definition.retainUntil) fail('Review an explicit season retention date before staging');
      if (value.definition.achievementPoints) achievementStore();
      if (Date.parse(value.definition.startsAt) <= now()) fail('Stage a future season; retroactive seasons are not supported');
      db.prepare('INSERT INTO progression_seasons VALUES(?,?,?,?,?,?,?)')
        .run(value.definition.id, JSON.stringify(value.definition), digest, reviewer, now(), 'staged', 1);
      audit(value.definition.id, 1, 'staged', reviewer, digest);
      db.prepare('INSERT INTO progression_season_retention(season_id,digest,retain_until) VALUES(?,?,?)').run(value.definition.id, digest, Date.parse(value.definition.retainUntil));
      return { ...read(value.definition.id), duplicate: false };
    });
  }
  function stateChangePlan(id, { digest, expectedRevision, action, reviewer } = {}) {
    steam(reviewer);
    if (!['publish', 'close'].includes(action) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('Review a supported season transition');
    const row = checked(id);
    if (row.digest !== digest || row.revision !== expectedRevision) fail('Season changed; inspect the current review');
    if (action === 'publish') {
      if (row.definition.achievementPoints) achievementStore();
      if (!row.definition.retainUntil) fail('Review retention in a new season definition before publishing');
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
  function enrollRaw(id, steamId) {
      writable(); const row = checked(id), at = now();
      if (row.state !== 'published' || at < Date.parse(row.definition.startsAt) || at >= Date.parse(row.definition.endsAt)) fail('Season enrollment is not open');
      // Bind consent to the source ledger position too: same-millisecond delete /
      // rejoin and small future clock skew cannot resurrect pre-consent grants.
      const cursor = db.prepare('SELECT coalesce(max(position),0) n FROM progression_season_source_positions WHERE steam_id=?').get(steamId).n;
      const created = db.prepare('INSERT OR IGNORE INTO progression_season_enrollments(season_id,steam_id,enrolled_at,cursor) VALUES(?,?,?,?)').run(id, steamId, at, cursor).changes;
      if (row.definition.achievementPoints) {
        achievementStore();
        if (created) {
          const floor = db.prepare('SELECT coalesce(max(position),0) n FROM progression_achievement_sources WHERE steam_id=?').get(steamId).n;
          db.prepare('INSERT INTO progression_season_achievement_cursors VALUES(?,?,?)').run(id, steamId, floor);
        } else if (!db.prepare('SELECT 1 FROM progression_season_achievement_cursors WHERE season_id=? AND steam_id=?').get(id, steamId)) fail('Season achievement consent evidence is unavailable', 503);
      }
      return enrollment(id, steamId);
  }
  function enroll(id, steamId) { steam(steamId); return atomic(() => enrollRaw(id, steamId)); }
  const enrollment = (id, steamId) => db.prepare('SELECT enrolled_at AS enrolledAt,cursor FROM progression_season_enrollments WHERE season_id=? AND steam_id=?').get(id, steamId) || null;
  function eraseRaw(id, steamId) {
      writable();
      db.prepare('DELETE FROM progression_season_evidence WHERE season_id=? AND steam_id=?').run(id, steamId);
      db.prepare('DELETE FROM progression_season_achievement_evidence WHERE season_id=? AND steam_id=?').run(id, steamId);
      db.prepare('DELETE FROM progression_season_achievement_cursors WHERE season_id=? AND steam_id=?').run(id, steamId);
      return { erased: Boolean(db.prepare('DELETE FROM progression_season_enrollments WHERE season_id=? AND steam_id=?').run(id, steamId).changes) };
  }
  function erase(id, steamId) {
    steam(steamId); identity(id);
    // Recovery/privacy action stays available even if catalog evidence is corrupt.
    return atomic(() => eraseRaw(id, steamId));
  }
  const choice = (id, steamId) => ({ revision: db.prepare('SELECT revision FROM progression_season_choices WHERE season_id=? AND steam_id=?').get(id, steamId)?.revision || 0,
    participating: Boolean(enrollment(id, steamId)) });
  const expired = row => Boolean(row?.definition.retainUntil && now() >= Date.parse(row.definition.retainUntil));
  function eraseExpired(id, steamId) {
    eraseRaw(id, steamId);
    db.prepare('DELETE FROM progression_season_choices WHERE season_id=? AND steam_id=?').run(id, steamId);
    db.prepare('DELETE FROM progression_season_requests WHERE season_id=? AND steam_id=?').run(id, steamId);
  }
  function changeParticipation(id, steamId, { selected, expectedRevision, requestKey, seasonDigest } = {}) {
    steam(steamId); identity(id);
    if (typeof selected !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER ||
        typeof requestKey !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(requestKey) || typeof seasonDigest !== 'string' || !/^[a-f0-9]{64}$/.test(seasonDigest)) fail('Review a complete season participation choice');
    const payload = JSON.stringify({ id, selected, expectedRevision, seasonDigest });
    return atomic(() => {
      writable();
      let row;
      try { row = checked(id); } catch (error) { if (selected || !find(id)) throw error; }
      if (expired(row)) {
        if (selected) fail('Season retention has ended', 410);
        eraseExpired(id, steamId);
        return { saved: { revision: 0, participating: false }, current: { revision: 0, participating: false }, expired: true, duplicate: false };
      }
      const receipt = db.prepare('SELECT * FROM progression_season_requests WHERE steam_id=? AND request_key=?').get(steamId, requestKey);
      if (receipt) {
        if (receipt.payload_json !== payload) fail('Saved request conflicts with this choice', 409);
        return { saved: JSON.parse(receipt.result_json), current: choice(id, steamId), duplicate: true };
      }
      if (!find(id)) fail('Season not found', 404);
      const current = choice(id, steamId);
      if (current.revision !== expectedRevision || current.participating === selected) fail('Participation changed; review the current choice', 409);
      if (selected) {
        if (checked(id).digest !== seasonDigest) fail('Season rules changed; review them again', 409);
        if (db.prepare('SELECT count(*) n FROM progression_season_requests WHERE steam_id=? AND at>?').get(steamId, now() - 60000).n >= 20 ||
            db.prepare('SELECT count(*) n FROM progression_season_requests WHERE steam_id=? AND season_id=?').get(steamId, id).n >= 1000) fail('Too many participation choices; try again later', 429);
        enrollRaw(id, steamId);
      } else eraseRaw(id, steamId);
      const saved = { revision: current.revision + 1, participating: selected };
      db.prepare('INSERT INTO progression_season_choices VALUES(?,?,?,?,?) ON CONFLICT(season_id,steam_id) DO UPDATE SET revision=excluded.revision,selected=excluded.selected,changed_at=excluded.changed_at')
        .run(id, steamId, saved.revision, Number(selected), now());
      db.prepare('INSERT INTO progression_season_requests VALUES(?,?,?,?,?,?)').run(steamId, requestKey, id, payload, JSON.stringify(saved), now());
      return { saved, current: saved, duplicate: false };
    });
  }
  function reconcile(id, steamId, { limit = 500, expectedRevision, seasonDigest } = {}) {
    steam(steamId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('Invalid season evidence batch size');
    return atomic(() => {
      writable(); const row = checked(id), participant = enrollment(id, steamId), at = now();
      if (expired(row)) fail('Season retention has ended', 410);
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== choice(id, steamId).revision || seasonDigest !== row.digest)) fail('Participation or season rules changed; refresh before updating progress', 409);
      if (!participant) fail('Enroll before collecting seasonal progress');
      if (!['published', 'closed'].includes(row.state)) fail('Season has not been published');
      const rows = !row.definition.sources.length ? [] : db.prepare(`SELECT p.position,l.*,t.source_at,t.basis FROM progression_season_source_positions p
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
      const result = { accepted, scanned: batch.length, more: rows.length > limit };
      if (row.definition.achievementPoints) {
        result.achievementAccepted = 0;
        for (const award of row.definition.achievementPoints.awards) {
          const source = eligibleAchievement(row, participant, steamId, award.id);
          if (!source) continue;
          result.achievementAccepted += db.prepare('INSERT OR IGNORE INTO progression_season_achievement_evidence VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(id, steamId, award.id, award.xp, source.position, source.sourceAt, source.recordedAt, source.basis, source.awardDigest, source.evidenceDigest).changes;
        }
      }
      return result;
    });
  }
  function eligibleAchievement(row, participant, steamId, achievementId) {
    const floor = db.prepare('SELECT source_floor FROM progression_season_achievement_cursors WHERE season_id=? AND steam_id=?').get(row.id, steamId);
    if (!floor) fail('Season achievement consent evidence is unavailable', 503);
    const source = achievementStore().read(steamId, achievementId);
    if (!source?.available || source.position <= floor.source_floor || source.sourceAt < Math.max(participant.enrolledAt, Date.parse(row.definition.startsAt)) ||
        source.sourceAt >= Date.parse(row.definition.endsAt) || source.recordedAt < participant.enrolledAt || source.recordedAt >= Date.parse(row.definition.settlesAt)) return null;
    return source;
  }
  function progress(id, steamId) {
    steam(steamId); const row = checked(id), participant = enrollment(id, steamId), at = now();
    if (!participant || expired(row)) return { season: read(id), enrolled: false, xp: 0, tier: 0, nextTier: row.definition.tiers[0], pending: false, retentionExpired: expired(row) };
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
    let pending = Boolean(row.definition.sources.length && db.prepare('SELECT 1 FROM progression_season_source_positions WHERE steam_id=? AND position>? LIMIT 1').get(steamId, participant.cursor));
    let achievementXp = 0, achievementInvalid = false;
    if (row.definition.achievementPoints) {
      for (const award of row.definition.achievementPoints.awards) {
        const saved = db.prepare('SELECT * FROM progression_season_achievement_evidence WHERE season_id=? AND steam_id=? AND achievement_id=?').get(id, steamId, award.id);
        const source = eligibleAchievement(row, participant, steamId, award.id);
        if (!saved) { pending ||= Boolean(source); continue; }
        if (!source || saved.xp !== award.xp || saved.source_position !== source.position || saved.source_at !== source.sourceAt || saved.recorded_at !== source.recordedAt ||
            saved.basis !== source.basis || saved.award_digest !== source.awardDigest || saved.evidence_digest !== source.evidenceDigest) { achievementInvalid = true; continue; }
        achievementXp += award.xp;
      }
    }
    totals.xp += achievementXp;
    if (!Number.isSafeInteger(totals.xp)) fail('Season progress exceeds supported range');
    const tier = row.definition.tiers.filter(t => t.xp <= totals.xp).length;
    return { season: read(id), enrolled: true, enrolledAt: participant.enrolledAt, xp: totals.xp, tier,
      nextTier: row.definition.tiers[tier] || null, pending,
      ...(row.definition.achievementPoints ? { achievementXp } : {}),
      evidenceUnavailable: Boolean(totals.invalid) || achievementInvalid, collectionClosed: row.state === 'closed' || at >= Date.parse(row.definition.settlesAt) };
  }
  function catalog({ before = null } = {}) {
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) fail('Invalid season page');
    const rows = db.prepare("SELECT rowid AS position,id FROM progression_seasons WHERE state IN ('published','closed') AND (? IS NULL OR rowid<?) ORDER BY rowid DESC LIMIT 26").all(before, before);
    return { items: rows.slice(0,25).map(row => read(row.id)), next: rows.length > 25 ? rows[24].position : null };
  }
  function status(id, steamId) {
    steam(steamId);
    if (!['published','closed'].includes(checked(id).state)) fail('Published season not found', 404);
    const value = progress(id, steamId);
    return { ...(value.retentionExpired ? { revision: 0, participating: false } : choice(id, steamId)), progress: value, serverTime: now() };
  }
  function maintain({ limit = 500 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('Invalid retention batch size');
    return atomic(() => {
      writable(); let remaining = limit, removed = 0, completed = 0, unavailable = 0;
      const candidates = db.prepare('SELECT season_id FROM progression_season_retention WHERE cleaned_at IS NULL AND retain_until<=? ORDER BY retain_until,season_id LIMIT 25').all(now());
      for (const candidate of candidates) {
        let row;
        try { row = checked(candidate.season_id); } catch { unavailable++; continue; }
        if (!expired(row)) { unavailable++; continue; }
        let hasRows = false;
        for (const table of ['progression_season_evidence','progression_season_achievement_evidence','progression_season_achievement_cursors','progression_season_enrollments','progression_season_requests','progression_season_choices']) {
          if (remaining) {
            const count = db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE season_id=? LIMIT ?)`).run(row.id, remaining).changes;
            removed += count; remaining -= count;
          }
          hasRows ||= Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE season_id=? LIMIT 1`).get(row.id));
        }
        if (!hasRows) { db.prepare('UPDATE progression_season_retention SET cleaned_at=? WHERE season_id=?').run(now(), row.id); completed++; }
        if (!remaining) break;
      }
      // Position IDs follow the permanent ledger. Remove obsolete identity copies
      // after their original permanent source has been removed, never live XP.
      if (remaining) {
        const cursor = db.prepare('SELECT source_cursor FROM progression_season_maintenance WHERE id=1').get()?.source_cursor || 0;
        const positions = db.prepare(`SELECT p.position,l.id FROM progression_season_source_positions p
          LEFT JOIN progression_xp_ledger l ON l.id=p.ledger_id WHERE p.position>? ORDER BY p.position LIMIT ?`).all(cursor, remaining);
        for (const position of positions) if (position.id === null) removed += db.prepare('DELETE FROM progression_season_source_positions WHERE position=?').run(position.position).changes;
        db.prepare('INSERT INTO progression_season_maintenance VALUES(1,?) ON CONFLICT(id) DO UPDATE SET source_cursor=excluded.source_cursor')
          .run(positions.length === remaining ? positions.at(-1).position : 0);
      }
      return { removed, completed, unavailable };
    });
  }
  return { stage, read, reviewStateChange, changeState, enroll, erase, reconcile, progress, catalog, status, changeParticipation, maintain };
}
module.exports = { describe, createSeasonTrackStore, SOURCES };
