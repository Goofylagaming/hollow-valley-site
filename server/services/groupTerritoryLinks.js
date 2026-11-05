function createGroupTerritoryLinks(db, groups, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_territory_links (
    group_id INTEGER PRIMARY KEY,territory_group_id INTEGER UNIQUE,revision INTEGER NOT NULL,effective_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hv_group_territory_link_edits (
    group_id INTEGER NOT NULL,revision INTEGER NOT NULL,territory_group_id INTEGER,actor TEXT NOT NULL,
    effective_at INTEGER NOT NULL,PRIMARY KEY(group_id,revision));`);
  function membership(steamId) {
    const group=groups.getState(steamId).current;
    if(!group)throw Object.assign(new Error('Active group membership required'),{status:404});
    return group;
  }
  function available() { return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='territory_groups'").get()); }
  function validLink(groupId, territoryGroupId) {
    return available() && Boolean(db.prepare(`SELECT g.id FROM hv_groups g
      JOIN users u ON u.steam_id=g.owner_steam_id
      JOIN territory_groups t ON t.leader_user_id=u.id
      WHERE g.id=? AND g.status='active' AND t.id=?`).get(groupId,territoryGroupId));
  }
  function get(steamId) {
    const group=membership(steamId);
    const link=db.prepare('SELECT territory_group_id AS territoryGroupId,revision,effective_at AS effectiveAt FROM hv_group_territory_links WHERE group_id=?').get(group.id);
    const choices=available()&&group.ownerSteamId===steamId?db.prepare(`SELECT t.id,t.name FROM territory_groups t JOIN users u ON u.id=t.leader_user_id
      WHERE u.steam_id=? ORDER BY t.id LIMIT 50`).all(steamId):[];
    return {groupId:group.id,canEdit:group.ownerSteamId===steamId,territoryGroupId:link?.territoryGroupId??null,active:link?.territoryGroupId?validLink(group.id,link.territoryGroupId):false,revision:link?.revision||0,effectiveAt:link?.effectiveAt??null,choices};
  }
  function save(groupId,target,revision,actor,previousAt=0) {
    const effectiveAt=Math.max(now(),previousAt+1);
    db.prepare(`INSERT INTO hv_group_territory_links VALUES (?,?,?,?) ON CONFLICT(group_id)
      DO UPDATE SET territory_group_id=excluded.territory_group_id,revision=excluded.revision,effective_at=excluded.effective_at`).run(groupId,target,revision,effectiveAt);
    db.prepare('INSERT INTO hv_group_territory_link_edits VALUES (?,?,?,?,?)').run(groupId,revision,target,actor,effectiveAt);
  }
  function set(steamId,{territoryGroupId,expectedRevision,expectedGroupId}={}) {
    if((territoryGroupId!==null&&(!Number.isSafeInteger(territoryGroupId)||territoryGroupId<1))||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!Number.isSafeInteger(expectedGroupId)||expectedGroupId<1)throw Object.assign(new Error('Valid website group, Territory group and revision required'),{status:400});
    db.exec('BEGIN IMMEDIATE');
    try {
      const group=membership(steamId);
      if(group.id!==expectedGroupId)throw Object.assign(new Error('Group membership changed; refresh before saving'),{status:409});
      if(group.ownerSteamId!==steamId)throw Object.assign(new Error('Only the website group owner can manage its Territory link'),{status:403});
      const old=db.prepare('SELECT revision,effective_at FROM hv_group_territory_links WHERE group_id=?').get(group.id);
      if((old?.revision||0)!==expectedRevision)throw Object.assign(new Error('Territory link changed; refresh before saving'),{status:409});
      if(territoryGroupId!==null){
        const target=available()&&db.prepare('SELECT t.id FROM territory_groups t JOIN users u ON u.id=t.leader_user_id WHERE t.id=? AND u.steam_id=?').get(territoryGroupId,steamId);
        if(!target)throw Object.assign(new Error('Lead the selected Territory group before linking it'),{status:403});
        const conflict=db.prepare('SELECT group_id,revision,effective_at FROM hv_group_territory_links WHERE territory_group_id=? AND group_id<>?').get(territoryGroupId,group.id);
        if(conflict){
          if(validLink(conflict.group_id,territoryGroupId))throw Object.assign(new Error('Territory group already linked'),{status:409});
          // A closed group or a change of leadership cannot reserve a Territory
          // identity forever. Retain the revoked association in its audit trail.
          save(conflict.group_id,null,conflict.revision+1,steamId,conflict.effective_at);
        }
      }
      save(group.id,territoryGroupId,expectedRevision+1,steamId,old?.effective_at||0);
      const result=get(steamId);db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {get,set};
}
module.exports={createGroupTerritoryLinks};
