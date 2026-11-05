const fail=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
function createGroupDiplomacy(db,groups,{now=Date.now}={}){
  const lifecycle=require('./groupTreasuryLifecycle').createGroupTreasuryLifecycle(db);
  const battles=require('./groupBattleHistory').createGroupBattleHistory(db);
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_relations (
    id INTEGER PRIMARY KEY,group_low INTEGER NOT NULL,group_high INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0),alliance TEXT NOT NULL CHECK(alliance IN('none','pending','active')),
    proposed_by INTEGER,low_rival INTEGER NOT NULL CHECK(low_rival IN(0,1)),high_rival INTEGER NOT NULL CHECK(high_rival IN(0,1)),updated_at INTEGER NOT NULL,
    UNIQUE(group_low,group_high),CHECK(group_low<group_high),
    CHECK((alliance='pending' AND proposed_by IS NOT NULL AND proposed_by IN(group_low,group_high)) OR (alliance<>'pending' AND proposed_by IS NULL)),
    CHECK(alliance='none' OR (low_rival=0 AND high_rival=0)));
    CREATE INDEX IF NOT EXISTS hv_group_relations_low ON hv_group_relations(group_low,id);
    CREATE INDEX IF NOT EXISTS hv_group_relations_high ON hv_group_relations(group_high,id);
    CREATE TABLE IF NOT EXISTS hv_group_relation_edits (
    pair_id INTEGER NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,actor_group_id INTEGER NOT NULL,
    action TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,expected_revision INTEGER NOT NULL,created_at INTEGER NOT NULL,
    PRIMARY KEY(pair_id,revision));
    CREATE INDEX IF NOT EXISTS hv_group_relation_rate ON hv_group_relation_edits(actor_group_id,created_at);`);
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  function id(value){if(!Number.isSafeInteger(value)||value<1)throw fail('INVALID_RELATION','A valid website group is required',400);return value;}
  function member(actor,expected,owner=false){
    if(typeof actor!=='string'||!/^\d{17}$/.test(actor))throw fail('LINKED_STEAM_REQUIRED','A linked Steam account is required',403);
    const group=groups.getState(actor).current;if(!group)throw fail('GROUP_REQUIRED','An active group membership is required',404);
    if(expected!==undefined&&group.id!==expected)throw fail('GROUP_CHANGED','Group membership changed; refresh before continuing');
    if(owner&&group.ownerSteamId!==actor)throw fail('GROUP_OWNER_REQUIRED','Only the current group owner can change relationships',403);return group;
  }
  function peer(ownId,targetId,active=false){id(targetId);if(ownId===targetId)throw fail('SELF_RELATION','Choose another group',400);
    const group=db.prepare('SELECT id,name,status FROM hv_groups WHERE id=?').get(targetId);if(!group)throw fail('GROUP_UNAVAILABLE','The other group is unavailable',404);
    if(active&&group.status!=='active')throw fail('GROUP_UNAVAILABLE','Relationships cannot change with a closed group');return group;
  }
  const pair=(a,b)=>db.prepare('SELECT * FROM hv_group_relations WHERE group_low=? AND group_high=?').get(Math.min(a,b),Math.max(a,b));
  function project(row,ownId,other){
    const low=ownId<other.id;
    return {relationId:row?.id??null,groupId:ownId,otherGroup:{id:other.id,name:other.name,status:other.status},revision:row?.revision??0,
      alliance:row?.alliance??'none',proposalFrom:row?.proposed_by??null,
      outgoingRival:Boolean(row&&(low?row.low_rival:row.high_rival)),incomingRival:Boolean(row&&(low?row.high_rival:row.low_rival)),
      effectiveAlliance:other.status==='active'&&row?.alliance==='active',updatedAt:row?.updated_at??null};
  }
  function detail(actor,targetId){const own=member(actor),other=peer(own.id,targetId),row=pair(own.id,other.id);
    return {...project(row,own.id,other),canManage:own.ownerSteamId===actor,closing:Boolean(lifecycle.status(own.id)),
      history:row?db.prepare('SELECT revision,actor_group_id AS actorGroupId,action,created_at AS at FROM hv_group_relation_edits WHERE pair_id=? ORDER BY revision DESC LIMIT 20').all(row.id):[],
      headToHead:battles.versus(own.id,other.id)};
  }
  function list(actor,{afterRelationId=0}={}){
    const own=member(actor);if(!Number.isSafeInteger(afterRelationId)||afterRelationId<0)throw fail('INVALID_PAGE','A valid relationship cursor is required',400);
    const rows=db.prepare('SELECT * FROM hv_group_relations WHERE (group_low=? OR group_high=?) AND id>? ORDER BY id LIMIT 51').all(own.id,own.id,afterRelationId);
    const relations=rows.slice(0,50).map(row=>project(row,own.id,peer(own.id,row.group_low===own.id?row.group_high:row.group_low)));
    return {group:{id:own.id,name:own.name,closing:Boolean(lifecycle.status(own.id))},canManage:own.ownerSteamId===actor,relations,nextRelationId:rows.length>50?relations.at(-1).relationId:null};
  }
  function search(actor,query){const own=member(actor);if(typeof query!=='string'||query.trim().length<2||query.trim().length>80||/[\x00-\x1f\x7f]/.test(query))throw fail('INVALID_SEARCH','Use 2–80 characters of a group name',400);
    const needle='%'+query.trim().replace(/[\\%_]/g,'\\$&')+'%';
    return {groupId:own.id,groups:db.prepare("SELECT id,name FROM hv_groups WHERE status='active' AND id<>? AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE,id LIMIT 50").all(own.id,needle)};
  }
  function change(actor,{expectedGroupId,targetGroupId,expectedRevision,action,requestId}={}){
    id(expectedGroupId);id(targetGroupId);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId))throw fail('INVALID_RELATION','A saved revision and request ID are required',400);
    if(!['propose_alliance','accept_alliance','decline_alliance','end_alliance','declare_rival','clear_rival'].includes(action))throw fail('INVALID_RELATION','Choose an available relationship action',400);
    return atomic(()=>{
      const own=member(actor,expectedGroupId,true),other=peer(own.id,targetGroupId),old=pair(own.id,targetGroupId);
      const previous=db.prepare('SELECT * FROM hv_group_relation_edits WHERE request_key=?').get(requestId);
      if(previous){
        if(!old||previous.pair_id!==old.id||previous.actor!==actor||previous.actor_group_id!==own.id||previous.action!==action||previous.expected_revision!==expectedRevision)throw fail('RELATION_REQUEST_CONFLICT','This request already has different relationship details');
        return {...detail(actor,targetGroupId),duplicate:true};
      }
      if(other.status!=='active')throw fail('GROUP_UNAVAILABLE','Relationships cannot change with a closed group');
      lifecycle.assertOpen(own.id);lifecycle.assertOpen(other.id);
      if((old?.revision??0)!==expectedRevision)throw fail('RELATION_CHANGED','This relationship changed; refresh before deciding again');
      const at=now();if(!Number.isSafeInteger(at)||at<0)throw new Error('Invalid diplomacy clock');
      if(db.prepare('SELECT COUNT(*) n FROM hv_group_relation_edits WHERE actor_group_id=? AND created_at>?').get(own.id,at-60000).n>=20)throw fail('RELATION_RATE_LIMIT','Too many relationship changes; try again shortly',429);
      const next=old?{...old}:{group_low:Math.min(own.id,other.id),group_high:Math.max(own.id,other.id),revision:0,alliance:'none',proposed_by:null,low_rival:0,high_rival:0};
      const rivalry=own.id===next.group_low?'low_rival':'high_rival';
      if(action==='propose_alliance'){
        if(next.alliance!=='none'||next.low_rival||next.high_rival)throw fail('RELATION_ACTION_UNAVAILABLE','Resolve existing proposals or rivalry declarations before proposing an alliance');next.alliance='pending';next.proposed_by=own.id;
      }else if(action==='accept_alliance'||action==='decline_alliance'){
        if(next.alliance!=='pending'||next.proposed_by===own.id)throw fail('RELATION_ACTION_UNAVAILABLE','Only the other group can respond to this proposal');next.alliance=action==='accept_alliance'?'active':'none';next.proposed_by=null;
      }else if(action==='end_alliance'){
        if(next.alliance==='none'||(next.alliance==='pending'&&next.proposed_by!==own.id))throw fail('RELATION_ACTION_UNAVAILABLE','There is no alliance or outgoing proposal to end');next.alliance='none';next.proposed_by=null;
      }else if(action==='declare_rival'){
        if(next[rivalry])throw fail('RELATION_ACTION_UNAVAILABLE','Your group already declares this rivalry');next[rivalry]=1;next.alliance='none';next.proposed_by=null;
      }else{
        if(!next[rivalry])throw fail('RELATION_ACTION_UNAVAILABLE','Your group has no outgoing rivalry to clear');next[rivalry]=0;
      }
      const engaged=value=>value&&(value.alliance!=='none'||value.low_rival||value.high_rival);
      if(!engaged(old)&&engaged(next))for(const groupId of [own.id,other.id]){
        if(db.prepare(`SELECT COUNT(*) n FROM hv_group_relations r JOIN hv_groups a ON a.id=r.group_low JOIN hv_groups b ON b.id=r.group_high
          WHERE (r.group_low=? OR r.group_high=?) AND a.status='active' AND b.status='active' AND (r.alliance<>'none' OR r.low_rival=1 OR r.high_rival=1)`).get(groupId,groupId).n>=100)throw fail('RELATION_CAPACITY','A group has reached its active relationship limit');
      }
      const revision=expectedRevision+1;
      if(old)db.prepare('UPDATE hv_group_relations SET revision=?,alliance=?,proposed_by=?,low_rival=?,high_rival=?,updated_at=? WHERE id=?').run(revision,next.alliance,next.proposed_by,next.low_rival,next.high_rival,at,old.id);
      else db.prepare('INSERT INTO hv_group_relations(group_low,group_high,revision,alliance,proposed_by,low_rival,high_rival,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(next.group_low,next.group_high,revision,next.alliance,next.proposed_by,next.low_rival,next.high_rival,at);
      const saved=pair(own.id,other.id);
      db.prepare('INSERT INTO hv_group_relation_edits VALUES(?,?,?,?,?,?,?,?)').run(saved.id,revision,actor,own.id,action,requestId,expectedRevision,at);
      return {...detail(actor,targetGroupId),duplicate:false};
    });
  }
  return {list,detail,search,change};
}
module.exports={createGroupDiplomacy};
