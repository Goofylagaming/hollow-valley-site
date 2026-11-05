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
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_screenshots (
    group_id INTEGER NOT NULL,image_id TEXT NOT NULL,shared_by TEXT NOT NULL,
    shared_at TEXT NOT NULL DEFAULT(datetime('now')),PRIMARY KEY(group_id,image_id));
    CREATE TABLE IF NOT EXISTS hv_group_screenshot_edits (
    id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL,image_id TEXT NOT NULL,actor TEXT NOT NULL,
    action TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
  function screenshots(groupId) {
    if(process.env.HV_GALLERY_ENABLED!=='1'||!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_images'").get())return [];
    return db.prepare(`SELECT i.id,i.title,i.author,s.shared_at AS sharedAt FROM hv_group_screenshots s
      JOIN gallery_images i ON i.id=s.image_id WHERE s.group_id=? AND i.status='approved' AND i.image IS NOT NULL
      ORDER BY s.shared_at DESC,s.image_id LIMIT 50`).all(groupId);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_member_ranks (
    group_id INTEGER NOT NULL, steam_id TEXT NOT NULL, rank TEXT NOT NULL,
    revision INTEGER NOT NULL, exit_id INTEGER NOT NULL, PRIMARY KEY(group_id,steam_id));
    CREATE TABLE IF NOT EXISTS hv_group_rank_edits (
    group_id INTEGER NOT NULL, steam_id TEXT NOT NULL, revision INTEGER NOT NULL,
    actor TEXT NOT NULL, rank TEXT NOT NULL, exit_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(group_id,steam_id,revision));`);
  function lastExit(groupId, steamId) {
    return db.prepare('SELECT MAX(id) id FROM hv_group_history WHERE group_id=? AND steam_id=?').get(groupId,steamId).id || 0;
  }

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
      screenshots: screenshots(group.id),
      rankEdits: db.prepare(`SELECT e.revision,e.rank,e.created_at AS createdAt,
        COALESCE(u.username,'Former member') AS memberName
        FROM hv_group_rank_edits e LEFT JOIN users u ON u.steam_id=e.steam_id
        WHERE e.group_id=? ORDER BY e.rowid DESC LIMIT 20`).all(group.id),
      members: group.members.map(member => {
        const assignment = db.prepare('SELECT rank,revision,exit_id FROM hv_group_member_ranks WHERE group_id=? AND steam_id=?').get(group.id,member.steamId);
        return { steamId:member.steamId, name:member.username, role:member.role,
          rank:member.role==='owner'?'owner':assignment?.exit_id===lastExit(group.id,member.steamId)?assignment.rank:'member',
          rankRevision:assignment?.revision || 0 };
      }),
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
  function setRank(steamId, { memberSteamId, rank, expectedRevision } = {}) {
    if (typeof memberSteamId !== 'string' || !/^\d{17}$/.test(memberSteamId) || !['member','veteran','officer'].includes(rank) || !Number.isSafeInteger(expectedRevision) || expectedRevision<0) throw Object.assign(new Error('Valid member, rank and revision required'),{status:400});
    db.exec('BEGIN IMMEDIATE');
    try {
      const group=membership(steamId);
      if(group.ownerSteamId!==steamId)throw Object.assign(new Error('Only the group owner can assign ranks'),{status:403});
      const member=group.members.find(person=>person.steamId===memberSteamId);
      if(!member)throw Object.assign(new Error('Group member unavailable'),{status:404});
      if(member.role==='owner')throw Object.assign(new Error('Owner rank follows group ownership'),{status:409});
      const old=db.prepare('SELECT revision FROM hv_group_member_ranks WHERE group_id=? AND steam_id=?').get(group.id,memberSteamId);
      if((old?.revision||0)!==expectedRevision)throw Object.assign(new Error('Member rank changed; refresh before saving'),{status:409});
      const revision=expectedRevision+1,exitId=lastExit(group.id,memberSteamId);
      db.prepare(`INSERT INTO hv_group_member_ranks VALUES (?,?,?,?,?) ON CONFLICT(group_id,steam_id)
        DO UPDATE SET rank=excluded.rank,revision=excluded.revision,exit_id=excluded.exit_id`).run(group.id,memberSteamId,rank,revision,exitId);
      db.prepare('INSERT INTO hv_group_rank_edits(group_id,steam_id,revision,actor,rank,exit_id) VALUES (?,?,?,?,?,?)').run(group.id,memberSteamId,revision,steamId,rank,exitId);
      const result=get(steamId);db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function shareScreenshot(steamId, { imageId, remove = false } = {}) {
    if(process.env.HV_GALLERY_ENABLED!=='1')throw Object.assign(new Error('Gallery sharing is not enabled'),{status:503});
    if(typeof imageId!=='string'||!imageId||imageId.length>160||typeof remove!=='boolean')throw Object.assign(new Error('Valid gallery image required'),{status:400});
    db.exec('BEGIN IMMEDIATE');
    try {
      const group=membership(steamId);
      const old=db.prepare('SELECT shared_by FROM hv_group_screenshots WHERE group_id=? AND image_id=?').get(group.id,imageId);
      let changed=false;
      if(remove){
        if(old&&old.shared_by!==steamId&&group.ownerSteamId!==steamId)throw Object.assign(new Error('Only the sharing member or group owner can remove this screenshot'),{status:403});
        changed=db.prepare('DELETE FROM hv_group_screenshots WHERE group_id=? AND image_id=?').run(group.id,imageId).changes>0;
      }else{
        const available=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_images'").get();
        const image=available&&db.prepare("SELECT owner_steam_id FROM gallery_images WHERE id=? AND status='approved' AND image IS NOT NULL").get(imageId);
        if(!image||image.owner_steam_id!==steamId)throw Object.assign(new Error('Choose one of your approved gallery screenshots'),{status:404});
        if(!old&&db.prepare('SELECT COUNT(*) n FROM hv_group_screenshots WHERE group_id=?').get(group.id).n>=50)throw Object.assign(new Error('Group screenshot limit reached'),{status:409});
        changed=db.prepare('INSERT OR IGNORE INTO hv_group_screenshots(group_id,image_id,shared_by) VALUES (?,?,?)').run(group.id,imageId,steamId).changes>0;
      }
      if(changed)db.prepare('INSERT INTO hv_group_screenshot_edits(group_id,image_id,actor,action) VALUES (?,?,?,?)').run(group.id,imageId,steamId,remove?'removed':'shared');
      const result=get(steamId);db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return { get, update, setRank, shareScreenshot };
}
module.exports = { createGroupHeadquarters };
