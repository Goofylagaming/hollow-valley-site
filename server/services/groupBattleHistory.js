// Freeze website identity at declaration. Later links never claim older battles.
function createGroupBattleHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_battle_identity (
    attack_id INTEGER NOT NULL,side TEXT NOT NULL,territory_group_id INTEGER,
    group_id INTEGER,link_revision INTEGER,PRIMARY KEY(attack_id,side));
    CREATE INDEX IF NOT EXISTS hv_group_battle_identity_group ON hv_group_battle_identity(group_id,attack_id);`);
  const exists=name=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
  function freeze(attackId,{attackerGroupId=null,defenderGroupId=null}={}) {
    for(const [side,territoryId] of [['attacker',attackerGroupId],['defender',defenderGroupId]]) {
      if(territoryId!==null&&(!Number.isSafeInteger(territoryId)||territoryId<1))throw new Error('Invalid Territory group identity');
      let link=null;
      if(territoryId!==null && ['hv_group_territory_links','hv_groups','territory_groups','users'].every(exists)) {
        link=db.prepare(`SELECT l.group_id,l.revision FROM hv_group_territory_links l
          JOIN hv_groups g ON g.id=l.group_id AND g.status='active'
          JOIN territory_groups t ON t.id=l.territory_group_id
          JOIN users u ON u.id=t.leader_user_id AND u.steam_id=g.owner_steam_id
          WHERE l.territory_group_id=?`).get(territoryId);
      }
      db.prepare('INSERT INTO hv_group_battle_identity VALUES (?,?,?,?,?)').run(attackId,side,territoryId,link?.group_id??null,link?.revision??null);
    }
  }
  function list(groupId) {
    if(!exists('territory_battle_provenance'))return [];
    return db.prepare(`SELECT b.attack_id AS attackId,b.event_id AS eventId,
      b.started_at AS startedAt,b.closed_at AS resolvedAt,b.outcome,i.side,
      i.territory_group_id AS territoryGroupId,i.link_revision AS linkRevision
      FROM hv_group_battle_identity i JOIN territory_battle_provenance b ON b.attack_id=i.attack_id
      WHERE i.group_id=? AND b.closed_at IS NOT NULL AND b.live_observed=1
        AND b.disqualified_reason IS NULL AND b.outcome IN ('capture','defence')
      ORDER BY b.closed_at DESC,b.attack_id DESC LIMIT 50`).all(groupId)
      .map(row=>({...row,result:(row.outcome==='capture')===(row.side==='attacker')?'win':'loss'}));
  }
  function versus(groupId,otherId){
    if(![groupId,otherId].every(id=>Number.isSafeInteger(id)&&id>0)||groupId===otherId)throw Object.assign(new Error('Two different website groups are required'),{status:400});
    if(!exists('territory_battle_provenance'))return {available:false,totals:null,battles:[]};
    const from=`FROM hv_group_battle_identity own JOIN hv_group_battle_identity peer ON peer.attack_id=own.attack_id
      AND peer.side<>own.side AND peer.side IN('attacker','defender')
      JOIN territory_battle_provenance b ON b.attack_id=own.attack_id
      WHERE own.group_id=? AND peer.group_id=? AND own.side IN('attacker','defender')
      AND b.closed_at IS NOT NULL AND b.live_observed=1 AND b.disqualified_reason IS NULL AND b.outcome IN('capture','defence')`;
    const won="((b.outcome='capture' AND own.side='attacker') OR (b.outcome='defence' AND own.side='defender'))";
    const totals=db.prepare(`SELECT COUNT(*) AS battles,COALESCE(SUM(CASE WHEN ${won} THEN 1 ELSE 0 END),0) AS wins ${from}`).get(groupId,otherId);
    const rows=db.prepare(`SELECT b.attack_id AS attackId,b.event_id AS eventId,b.started_at AS startedAt,b.closed_at AS resolvedAt,
      own.side,CASE WHEN ${won} THEN 'win' ELSE 'loss' END AS result ${from} ORDER BY b.closed_at DESC,b.attack_id DESC LIMIT 50`).all(groupId,otherId);
    return {available:true,totals:{...totals,losses:totals.battles-totals.wins},battles:rows};
  }
  return {freeze,list,versus};
}
module.exports={createGroupBattleHistory};
