function createGroupHeadquarters(db, groups) {
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_profiles (
    group_id INTEGER PRIMARY KEY, description TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hv_group_profile_edits (
    group_id INTEGER NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL,
    description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(group_id,revision));`);
  for (const table of ['hv_group_profiles', 'hv_group_profile_edits']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'emblem')) db.exec(`ALTER TABLE ${table} ADD COLUMN emblem TEXT NOT NULL DEFAULT 'leaf'`);
  }
  const emblems = ['leaf', 'claw', 'mountain', 'sun'];

  function membership(steamId) {
    const group = groups.getState(steamId).current;
    if (!group) throw Object.assign(new Error('An active group membership is required'), { status: 404 });
    return group;
  }
  function get(steamId) {
    const group = membership(steamId);
    const profile = db.prepare('SELECT description,revision,emblem FROM hv_group_profiles WHERE group_id=?').get(group.id);
    return {
      groupId: group.id, name: group.name, canEdit: group.ownerSteamId === steamId,
      description: profile?.description || '', revision: profile?.revision || 0,
      emblem: profile?.emblem || 'leaf',
      edits: db.prepare(`SELECT revision,description,emblem,created_at AS createdAt FROM hv_group_profile_edits
        WHERE group_id=? ORDER BY revision DESC LIMIT 20`).all(group.id)
    };
  }
  function update(steamId, { description, expectedRevision, emblem } = {}) {
    if (emblem !== undefined && !emblems.includes(emblem)) throw Object.assign(new Error('Choose an available group emblem'), { status: 400 });
    if (typeof description !== 'string' || description.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(description) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Object.assign(new Error('A description up to 2,000 characters and a valid revision are required'), { status: 400 });
    db.exec('BEGIN IMMEDIATE');
    try {
      const group = membership(steamId);
      if (group.ownerSteamId !== steamId) throw Object.assign(new Error('Only the group owner can edit Headquarters'), { status: 403 });
      const profile = db.prepare('SELECT revision,emblem FROM hv_group_profiles WHERE group_id=?').get(group.id);
      if ((profile?.revision || 0) !== expectedRevision) throw Object.assign(new Error('Headquarters changed; refresh before saving'), { status: 409 });
      const revision = expectedRevision + 1;
      const chosenEmblem = emblem ?? profile?.emblem ?? 'leaf';
      db.prepare(`INSERT INTO hv_group_profiles(group_id,description,revision,emblem) VALUES (?,?,?,?) ON CONFLICT(group_id)
        DO UPDATE SET description=excluded.description,revision=excluded.revision,emblem=excluded.emblem`).run(group.id, description.trim(), revision, chosenEmblem);
      db.prepare('INSERT INTO hv_group_profile_edits(group_id,revision,actor,description,emblem) VALUES (?,?,?,?,?)').run(group.id, revision, steamId, description.trim(), chosenEmblem);
      const result = get(steamId);
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { get, update };
}
module.exports = { createGroupHeadquarters };
