const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createGroupTerritoryLinks}=require('../server/services/groupTerritoryLinks');
const {createGroupBattleHistory}=require('../server/services/groupBattleHistory');
const {createBattleProvenance}=require('../server/services/territoryBattleProvenance');
const A='76561198000000001',B='76561198000000002',C='76561198000000003';

test('group scores require verified sample clocks and never upgrade unstamped or missing-clock history',t=>{
 const {db,links,territory}=fixture(t);territory();
 links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});
 links.set(C,{expectedGroupId:2,territoryGroupId:11,expectedRevision:0});
 const battle=createBattleProvenance(db),history=createGroupBattleHistory(db);
 const begin=id=>battle.begin(id,7,id*100,{attackerGroupId:10,defenderGroupId:11});
 const stamped=id=>battle.observe(id,{usable:true,sampledAt:id*100+10},id*100+10);
 const unstamped=id=>battle.observe(id,{usable:true},id*100+11);
 const finish=id=>battle.finish(id,id*100+20,'capture');
 begin(1);stamped(1);finish(1);
 begin(2);unstamped(2);stamped(2);finish(2); // Later stamps cannot repair earlier unknown clocks.
 begin(3);stamped(3);unstamped(3);finish(3);
 begin(4);stamped(4);finish(4);db.exec('DELETE FROM territory_battle_sample_clock WHERE attack_id=4');
 begin(5);battle.observe(5,{usable:true,sampledAt:510+30001},510);finish(5); // Future sample, no live evidence.
 assert.deepEqual([2,3].map(id=>db.prepare('SELECT verified FROM territory_battle_sample_clock WHERE attack_id=?').get(id).verified),[0,0]);
 const before=db.prepare('SELECT total_changes() n').get().n;db.exec('PRAGMA query_only=ON');
 assert.deepEqual(history.list(1).map(row=>row.attackId),[1]);
 assert.deepEqual(history.versus(1,2).totals,{battles:1,wins:1,losses:0});
 assert.deepEqual(history.versus(2,1).totals,{battles:1,wins:0,losses:1});
 assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
 db.exec('PRAGMA query_only=OFF;DROP TABLE territory_battle_sample_clock');
 assert.deepEqual(history.list(1),[]);
 assert.deepEqual(history.versus(1,2),{available:false,totals:null,battles:[]});
});
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT);
    CREATE TABLE hv_groups(id INTEGER PRIMARY KEY,name TEXT,owner_steam_id TEXT,status TEXT);
    CREATE TABLE hv_group_members(group_id INTEGER,steam_id TEXT);
    INSERT INTO users VALUES(1,'${A}'),(2,'${B}'),(3,'${C}');
    INSERT INTO hv_groups VALUES(1,'Same name','${A}','active'),(2,'Other website group','${C}','active');
    INSERT INTO hv_group_members VALUES(1,'${A}'),(1,'${B}'),(2,'${C}');`);
  const groups={getState:steam=>({current:db.prepare(`SELECT g.id,g.owner_steam_id AS ownerSteamId FROM hv_groups g
    JOIN hv_group_members m ON m.group_id=g.id WHERE m.steam_id=? AND g.status='active'`).get(steam)})};
  const links=createGroupTerritoryLinks(db,groups,{now:()=>100});
  const territory=()=>db.exec(`CREATE TABLE territory_groups(id INTEGER PRIMARY KEY,name TEXT,leader_user_id INTEGER);
    INSERT INTO territory_groups VALUES(10,'Different name',1),(11,'Same name',3);`);
  const fails=(fn,status)=>assert.throws(fn,error=>error.status===status);
  return {db,links,territory,fails};
}
test('head-to-head totals use both frozen identities, all eligible history and no fighter/live-location data',t=>{
 const {db,links,territory}=fixture(t);territory();links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});links.set(C,{expectedGroupId:2,territoryGroupId:11,expectedRevision:0});
 const battle=createBattleProvenance(db),history=createGroupBattleHistory(db);
 const begin=(id,options={})=>battle.begin(id,7,id*100,{attackerGroupId:10,defenderGroupId:11,...options});
 const finish=(id,outcome='capture',options={})=>{battle.observe(id,{usable:true,sampledAt:id*100+10},id*100+10);battle.finish(id,id*100+20,outcome,options);};
 for(let index=1;index<=55;index++){begin(index);finish(index,index%2?'capture':'defence');}
 begin(56);battle.finish(56,5620,'capture');begin(57,{testing:true});finish(57);begin(58);finish(58,'capture',{manual:true});begin(59);battle.observe(59,{usable:true,simulated:true},5910);battle.finish(59,5920,'capture');
 links.set(A,{expectedGroupId:1,territoryGroupId:null,expectedRevision:1});begin(60);finish(60);links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:2});begin(61);battle.observe(61,{usable:true},6110);
 const result=history.versus(1,2);assert.deepEqual(result.totals,{battles:55,wins:28,losses:27});assert.equal(result.battles.length,50);assert.deepEqual(history.versus(2,1).totals,{battles:55,wins:27,losses:28});
 assert.equal(JSON.stringify(result).includes(A),false);assert.equal(JSON.stringify(result).includes('location'),false);assert.throws(()=>history.versus(1,1),error=>error.status===400);
});
test('Territory links require both current authorities; names cannot establish identity',t=>{
  const {links,territory,fails}=fixture(t);
  assert.deepEqual(links.get(A).choices,[]);
  fails(()=>links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0}),403);
  territory();
  assert.equal(links.get(A).territoryGroupId,null);
  assert.equal(links.get(A).choices[0].id,10);
  assert.deepEqual(links.get(B).choices,[]);
  fails(()=>links.set(A,{expectedGroupId:2,territoryGroupId:10,expectedRevision:0}),409);
  fails(()=>links.set(B,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0}),403);
  fails(()=>links.set(A,{expectedGroupId:1,territoryGroupId:11,expectedRevision:0}),403);
  fails(()=>links.set('76561198000000999',{expectedGroupId:1,territoryGroupId:10,expectedRevision:0}),404);
  fails(()=>links.set(A,{expectedGroupId:1,territoryGroupId:'10',expectedRevision:0}),400);
  assert.equal(links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0}).active,true);
  assert.equal(links.get(B).territoryGroupId,10);
  fails(()=>links.set(A,{expectedGroupId:1,territoryGroupId:null,expectedRevision:0}),409);
});
test('unlinking is revisioned, monotonic and rolls back when audit storage fails',t=>{
  const {db,links,territory}=fixture(t);territory();
  links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});
  db.exec("CREATE TRIGGER fail_link_audit BEFORE INSERT ON hv_group_territory_link_edits BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
  assert.throws(()=>links.set(A,{expectedGroupId:1,territoryGroupId:null,expectedRevision:1}),/fixture/);
  assert.equal(links.get(A).revision,1);assert.equal(links.get(A).territoryGroupId,10);
  db.exec('DROP TRIGGER fail_link_audit');
  const removed=links.set(A,{expectedGroupId:1,territoryGroupId:null,expectedRevision:1});
  assert.equal(removed.revision,2);assert.equal(removed.effectiveAt,101);assert.equal(removed.active,false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_territory_link_edits').get().n,2);
});
test('new dual owner can reclaim a stale association with retained atomic revocation history',t=>{
  const {db,links,territory}=fixture(t);territory();
  links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});
  db.exec('UPDATE territory_groups SET leader_user_id=3 WHERE id=10');
  assert.equal(links.get(A).active,false);
  db.exec("CREATE TRIGGER fail_new_link BEFORE INSERT ON hv_group_territory_link_edits WHEN NEW.group_id=2 BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
  assert.throws(()=>links.set(C,{expectedGroupId:2,territoryGroupId:10,expectedRevision:0}),/fixture/);
  assert.equal(links.get(A).territoryGroupId,10);assert.equal(links.get(A).revision,1);
  db.exec('DROP TRIGGER fail_new_link');
  assert.equal(links.set(C,{expectedGroupId:2,territoryGroupId:10,expectedRevision:0}).active,true);
  assert.equal(links.get(A).territoryGroupId,null);assert.equal(links.get(A).revision,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_territory_link_edits').get().n,3);
});
test('battle history freezes declaration identity and excludes unverified or retrospectively linked results',t=>{
  const {db,links,territory}=fixture(t);territory();
  const battle=createBattleProvenance(db),history=createGroupBattleHistory(db);
  const begin=(id,options={})=>battle.begin(id,7,id*100,{attackerGroupId:10,defenderGroupId:11,...options});
  const finish=(id,outcome='capture',options={})=>{battle.observe(id,{usable:true,sampledAt:id*100+10},id*100+10);battle.finish(id,id*100+20,outcome,options);};
  begin(1);finish(1); // no link at declaration
  links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});
  links.set(C,{expectedGroupId:2,territoryGroupId:11,expectedRevision:0});
  assert.deepEqual(history.list(1),[]);
  battle.begin(1,7,100,{attackerGroupId:10}); // retry must not backfill identity
  assert.deepEqual(history.list(1),[]);
  begin(2);finish(2);
  assert.equal(history.list(1)[0].result,'win');assert.equal(history.list(2)[0].result,'loss');
  begin(3);finish(3,'defence');
  assert.equal(history.list(1)[0].result,'loss');assert.equal(history.list(2)[0].result,'win');
  links.set(A,{expectedGroupId:1,territoryGroupId:null,expectedRevision:1});
  assert.equal(history.list(1).length,2,'unlink cannot erase frozen history');
  links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:2});
  begin(4,{testing:true});finish(4);
  begin(5);finish(5,'capture',{manual:true});
  begin(6);battle.observe(6,{usable:true,simulated:true},610);battle.finish(6,620,'capture');
  begin(7);battle.finish(7,720,'capture'); // no live observation
  assert.equal(history.list(1).length,2);
  db.exec('UPDATE territory_groups SET leader_user_id=2 WHERE id=10');
  begin(8);finish(8);
  assert.equal(history.list(1).length,2,'leadership mismatch suspends new attribution');
  assert.equal(history.list(1)[1].linkRevision,1);
  assert.equal(Object.hasOwn(history.list(1)[0],'winners'),false);
});
test('identity and provenance share declaration atomicity, including outer rollbacks',t=>{
  const {db,territory}=fixture(t);territory();const battle=createBattleProvenance(db);
  db.exec("CREATE TRIGGER fail_frozen_side BEFORE INSERT ON hv_group_battle_identity WHEN NEW.side='defender' BEGIN SELECT RAISE(ABORT,'fixture freeze failure'); END");
  assert.throws(()=>battle.begin(1,1,100,{attackerGroupId:10,defenderGroupId:11}),/fixture/);
  assert.equal(battle.read(1),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_battle_identity').get().n,0);
  db.exec('DROP TRIGGER fail_frozen_side; BEGIN');
  battle.begin(1,1,100,{attackerGroupId:10,defenderGroupId:11});db.exec('ROLLBACK');
  assert.equal(battle.read(1),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_battle_identity').get().n,0);
});
test('closed website groups release their Territory identity when the leader links a new group',t=>{
  const {db,links,territory}=fixture(t);territory();
  links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});
  db.exec(`UPDATE hv_groups SET status='closed' WHERE id=1;
    DELETE FROM hv_group_members WHERE steam_id='${A}';
    INSERT INTO hv_groups VALUES(3,'Replacement','${A}','active');
    INSERT INTO hv_group_members VALUES(3,'${A}');`);
  assert.equal(links.set(A,{expectedGroupId:3,territoryGroupId:10,expectedRevision:0}).active,true);
  assert.equal(db.prepare('SELECT territory_group_id FROM hv_group_territory_links WHERE group_id=1').get().territory_group_id,null);
});
test('battle history is bounded, ordered and retained across service restarts',t=>{
  const {db,links,territory}=fixture(t);territory();
  links.set(A,{expectedGroupId:1,territoryGroupId:10,expectedRevision:0});
  const battle=createBattleProvenance(db);
  for(let id=1;id<=55;id++){
    battle.begin(id,1,id*100,{attackerGroupId:10});battle.observe(id,{usable:true,sampledAt:id*100+1},id*100+1);battle.finish(id,id*100+2,'capture');
  }
  const rows=createGroupBattleHistory(db).list(1);
  assert.equal(rows.length,50);assert.equal(rows[0].attackId,55);assert.equal(rows[49].attackId,6);
  assert.deepEqual(createGroupBattleHistory(db).list(2),[]);
});

