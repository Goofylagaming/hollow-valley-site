const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-victory-runtime-'));
process.env.DB_PATH=path.join(dir,'website.sqlite');
const {db}=require('../server/db');
const status=require('../server/services/serverStatus');
const router=require('../server/routes/territoryWars');
const {territoryGeometry}=require('../server/services/territoryGeometry');
const OriginalDate=Date;
let now=OriginalDate.now();
const a='76561198000000301',b='76561198000000302',outsider='76561198000000303';
const geometry=territoryGeometry({territoryName:'South Plains'});
const location={x:geometry.center.long*1000,y:geometry.center.lat*1000,z:0};
let online=true;
const originalState=status.getState;
let sampleAge=0;
status.getState=()=>({configured:true,online,lastChecked:Number.isFinite(sampleAge)?new OriginalDate(now-sampleAge).toISOString():null,characters:online?[a,b,outsider].map(steamId=>({steamId,location})):[]});
test.after(()=>{status.getState=originalState;global.Date=OriginalDate;db.close();fs.rmSync(dir,{recursive:true,force:true});});

test('real declaration and runtime capture freeze only observed lineup fighters; manual control cannot award',async()=>{
  global.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  for(const [id,steam] of [[1,a],[2,b],[3,outsider]]) db.prepare('INSERT INTO users(id,steam_id,username,is_admin) VALUES (?,?,?,1)').run(id,steam,'Fixture '+id);
  db.exec("INSERT INTO territory_groups(id,name,tag,leader_user_id) VALUES (1,'Attackers','ATK',1); INSERT INTO territory_group_members(group_id,user_id,role) VALUES (1,1,'leader'),(1,2,'member')");
  const groups=require('../server/groupsStore');
  const websiteGroupId=groups.createGroup(a,'Website Attackers').current.id;
  const links=require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db,groups);
  const history=require('../server/services/groupBattleHistory').createGroupBattleHistory(db);
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:1,steam_id:a,is_admin:1};next();});app.use('/tw',router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/tw`;
  const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
  try {
    for(const manual of [false,true]) {
      const link=links.get(a);
      links.set(a,{expectedGroupId:websiteGroupId,territoryGroupId:1,expectedRevision:link.revision});
      const eventId=manual?2:1;
      const iso=ms=>new Date(ms).toISOString();
      db.prepare("INSERT INTO territory_events(id,name,status,owner_name,starts_at,ends_at) VALUES (?,?,'live','Unowned',?,?)").run(eventId,'Fixture battle',iso(now-60000),iso(now+3*3600000));
      db.prepare("INSERT INTO territory_event_registrations(event_id,group_id,registered_by_user_id) VALUES (?,1,1)").run(eventId);
      for(const user of [1,2]) db.prepare('INSERT INTO territory_event_lineups(event_id,group_id,user_id,selected_by_user_id,active_from) VALUES (?,1,?,1,?)').run(eventId,user,iso(now-60000));
      await post('/attack-declare',{eventId});
      const attack=db.prepare('SELECT * FROM territory_attacks WHERE event_id=?').get(eventId);
      assert.ok(db.prepare('SELECT * FROM territory_battle_provenance WHERE attack_id=?').get(attack.id));
      const identity=db.prepare("SELECT * FROM hv_group_battle_identity WHERE attack_id=? AND side='attacker'").get(attack.id);
      assert.equal(identity.group_id,websiteGroupId);assert.equal(identity.territory_group_id,1);
      links.set(a,{expectedGroupId:websiteGroupId,territoryGroupId:null,expectedRevision:links.get(a).revision});
      if(manual) await post('/admin/control',{id:eventId,ownerControl:1});
      // Offline positions cannot advance control or produce evidence.
      online=false;now+=6*60000;router.tickRuntime();
      assert.equal(db.prepare('SELECT live_observed FROM territory_battle_provenance WHERE attack_id=?').get(attack.id).live_observed,0);
      online=true;
      for(const age of [120001,-1,NaN]){
        const score=db.prepare('SELECT control_score FROM territory_events WHERE id=?').get(eventId).control_score;
        sampleAge=age;now+=60000;router.tickRuntime();
        assert.equal(db.prepare('SELECT live_observed FROM territory_battle_provenance WHERE attack_id=?').get(attack.id).live_observed,0,'expired, future and timestamp-less positions cannot produce live evidence');
        const state=await (await fetch(base+'/state')).json();assert.equal(state.presence.stale,true);assert.equal(state.presence.serverOnline,false);assert.equal(state.presence.playerCount,0);
        assert.equal(db.prepare('SELECT control_score FROM territory_events WHERE id=?').get(eventId).control_score,score);
        assert.equal(db.prepare('SELECT attack_id FROM territory_victory_outbox WHERE attack_id=?').get(attack.id),undefined);
      }
      sampleAge=0;
      for(let tick=0;tick<180;tick++) {
        now+=60000;router.tickRuntime();
        if(db.prepare('SELECT status FROM territory_attacks WHERE id=?').get(attack.id).status==='resolved') break;
      }
      assert.equal(db.prepare('SELECT outcome FROM territory_attacks WHERE id=?').get(attack.id).outcome,'capture');
      const queued=db.prepare('SELECT payload_json FROM territory_victory_outbox WHERE attack_id=?').get(attack.id);
      if(manual) assert.equal(queued,undefined);
      else {
        assert.equal(require('../server/services/territoryBattleProvenance').createBattleProvenance(db).hasVerifiedSampleClock(attack.id),true);
        assert.equal(history.list(websiteGroupId)[0].attackId,attack.id);
        assert.equal(history.list(websiteGroupId)[0].result,'win');
        assert.deepEqual(JSON.parse(queued.payload_json).winners,[a,b]);
        db.exec('DELETE FROM territory_group_members WHERE user_id=2');
        assert.deepEqual(JSON.parse(db.prepare('SELECT payload_json FROM territory_victory_outbox WHERE attack_id=?').get(attack.id).payload_json).winners,[a,b]);
        db.exec("INSERT INTO territory_group_members(group_id,user_id,role) VALUES (1,2,'member')");
      }
      assert.equal(history.list(websiteGroupId).length,1,'manual results cannot enter Headquarters battle history');
      db.prepare("UPDATE territory_events SET status='ended' WHERE id=?").run(eventId);
    }
  } finally {global.Date=OriginalDate;await new Promise(resolve=>server.close(resolve));}
});
