"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createAchievementSourceTimeStore}=require('../src/services/achievementSourceTime');
const {createLevelSourceStore,derivePlaytimeSource}=require('../src/services/achievementProgressionSource');
const {createSeasonTrackStore,describe}=require('../src/services/seasonTrackStore');
const A='76561198000000401';
function fixture(t){
 const previous=process.env.AUTOMATION_DB_PATH;process.env.AUTOMATION_DB_PATH=':memory:';
 const economyPath=require.resolve('../src/services/economyStore'),progressionPath=require.resolve('../src/services/progressionService');delete require.cache[economyPath];delete require.cache[progressionPath];
 const economy=require(economyPath),progression=require(progressionPath),sources=createAchievementSourceTimeStore(economy.db);
 t.after(()=>{economy.db.close();delete require.cache[economyPath];delete require.cache[progressionPath];if(previous===undefined)delete process.env.AUTOMATION_DB_PATH;else process.env.AUTOMATION_DB_PATH=previous;});
 let sequence=0;
 const grant=(amount,at)=>{const key='synthetic-level-'+(++sequence);return progression.awardXp({steamId:A,amount,source:'quest',referenceType:'quest',referenceId:key,idempotencyKey:key,reason:'Existing XP fixture',sourceTime:{at,basis:'quest-achievement'}});};
 return {economy,db:economy.db,progression,sources,grant};
}
test('new level and first-hour awards use the triggering activity/numbered interval and add season points without new permanent payments',t=>{
 const f=fixture(t),end=Date.now()-60000,start=end-7200000;let clock=start-1000;
 const seasons=createSeasonTrackStore(f.db,{now:()=>clock}),def={id:'synthetic-progression-season',title:'Synthetic progression milestones',startsAt:new Date(start).toISOString(),endsAt:new Date(end+86400000).toISOString(),settlesAt:new Date(end+2*86400000).toISOString(),retainUntil:new Date(end+30*86400000).toISOString(),free:true,sources:[],tiers:[{xp:50,title:'Synthetic milestone'}],achievementPoints:{policy:'qualifying-source-time',awards:[{id:'first-level',xp:40},{id:'playtime-1h',xp:30}]}},digest=describe(def).digest;
 seasons.stage(def,{reviewer:A,digest});seasons.changeState(def.id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=start;seasons.enroll(def.id,A);
 const crossedAt=end-5400000;const level=f.grant(250,crossedAt);assert.equal(level.vcAwarded,100);assert.equal(f.sources.read(A,'first-level').sourceAt,crossedAt);
 for(let minute=0;minute<=60;minute++)f.progression.trackOnlinePlayers([{steamId:A}],{nowMs:end-3600000+minute*60000});
 assert.equal(f.sources.read(A,'playtime-1h').sourceAt,end);assert.equal(f.sources.read(A,'playtime-1h').basis,'playtime-interval-threshold');
 const balance=f.economy.getWallet(A).balance,ledger=f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n;clock=Date.now()+1000;
 seasons.reconcile(def.id,A);assert.equal(seasons.progress(def.id,A).xp,70);assert.equal(f.economy.getWallet(A).balance,balance);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n,ledger);
 assert.equal(f.progression.getProfile(A,{sync:false}).xp,370);assert.equal(balance,100);
});
test('level prefix bindings survive later grants/VACUUM but reject changed or missing earlier XP without rewriting the receipt',t=>{
 const f=fixture(t),at=Date.now()-3600000;f.grant(100,at);f.grant(150,at+1000);
 const first=f.db.prepare('SELECT * FROM progression_xp_ledger ORDER BY rowid LIMIT 1').get(),source=f.sources.read(A,'first-level');assert.equal(source.sourceAt,at+1000);
 f.grant(20,at+2000);f.db.exec('VACUUM');assert.equal(f.sources.read(A,'first-level').sourceAt,source.sourceAt);
 f.db.prepare('DELETE FROM progression_xp_source_times WHERE ledger_id=?').run(first.id);f.db.prepare('DELETE FROM progression_xp_ledger WHERE id=?').run(first.id);assert.equal(f.sources.read(A,'first-level').available,false);
 const keys=Object.keys(first);f.db.prepare(`INSERT INTO progression_xp_ledger(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(first));
 assert.equal(f.sources.read(A,'first-level').sourceAt,source.sourceAt);
 f.db.prepare('UPDATE progression_xp_ledger SET amount=101 WHERE id=?').run(first.id);assert.equal(f.sources.read(A,'first-level').available,false);
});
test('failed level evidence rolls back XP, ordinal, player update and the existing level payment together',t=>{
 const f=fixture(t),at=Date.now()-60000;
 f.db.exec("CREATE TRIGGER refuse_level_source BEFORE INSERT ON progression_level_sources BEGIN SELECT RAISE(ABORT,'level evidence unavailable'); END");
 const request={steamId:A,amount:250,source:'quest',referenceType:'quest',referenceId:'synthetic-atomic-level',idempotencyKey:'synthetic-atomic-level',reason:'Existing XP fixture',sourceTime:{at,basis:'quest-achievement'}};
 assert.throws(()=>f.progression.awardXp(request),/level evidence unavailable/);
 for(const table of ['progression_xp_ledger','progression_xp_order','progression_level_sources'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
 assert.equal(f.economy.getWallet(A).balance,0);assert.equal(f.db.prepare('SELECT xp FROM progression_players WHERE steam_id=?').get(A).xp,0);
 f.db.exec('DROP TRIGGER refuse_level_source');assert.equal(f.progression.awardXp(request).vcAwarded,100);assert.equal(f.progression.awardXp(request).duplicate,true);assert.equal(f.economy.getWallet(A).balance,100);
});
test('playtime gaps, altered sequence metadata and unknown threshold clocks cannot preserve source timing',t=>{
 const f=fixture(t),end=Date.now()-60000;
 for(let minute=0;minute<=60;minute++)f.progression.trackOnlinePlayers([{steamId:A}],{nowMs:end-3600000+minute*60000});
 const source=f.sources.read(A,'playtime-1h');assert.equal(source.available,true);
 const target=f.db.prepare("SELECT id FROM progression_xp_ledger WHERE source='playtime' AND reference_id='12'").get().id;
 f.db.prepare("UPDATE progression_xp_ledger SET metadata_json='{}' WHERE id=?").run(target);assert.equal(f.sources.read(A,'playtime-1h').available,false);
 f.db.prepare('UPDATE progression_xp_ledger SET metadata_json=? WHERE id=?').run(JSON.stringify({intervalMinutes:5,sequence:12}),target);
 f.db.prepare('DELETE FROM progression_xp_source_times WHERE ledger_id=?').run(target);assert.equal(f.sources.read(A,'playtime-1h').available,false);
});
test('initializing a legacy ledger assigns stable identities without inventing clocks, level transitions or historical receipts',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,reference_id TEXT,metadata_json TEXT,created_at TEXT);
 INSERT INTO progression_xp_ledger VALUES('legacy','${A}',250,'quest','quest','old','{}','2025-01-01 00:00:00');`);
 createLevelSourceStore(db);createLevelSourceStore(db);
 assert.equal(db.prepare('SELECT count(*) n FROM progression_xp_order').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM progression_level_sources').get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='progression_xp_source_times'").get().n,0);
});
test('500-hour timing uses exactly 6000 complete ordinal intervals and remains stable when later playtime arrives',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,reference_id TEXT,metadata_json TEXT,created_at TEXT);
 CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);CREATE TABLE progression_players(steam_id TEXT,playtime_intervals INTEGER);`);
 const end=Date.now()-60000,insert=db.prepare('INSERT INTO progression_xp_ledger VALUES(?,?,?,?,?,?,?,?)');
 db.exec('BEGIN IMMEDIATE');for(let n=1;n<=6000;n++)insert.run('interval-'+n,A,10,'playtime','playtime_interval',String(n),JSON.stringify({intervalMinutes:5,sequence:n}),new Date(end).toISOString());
 db.prepare('INSERT INTO progression_xp_source_times VALUES(?,?,?)').run('interval-6000',end,'playtime-observation');db.prepare('INSERT INTO progression_players VALUES(?,?)').run(A,6001);db.exec('COMMIT');
 assert.equal(derivePlaytimeSource(db,A,30000).sourceAt,end);
 insert.run('interval-6001',A,10,'playtime','playtime_interval','6001',JSON.stringify({intervalMinutes:5,sequence:6001}),new Date(end+1000).toISOString());assert.equal(derivePlaytimeSource(db,A,30000).sourceAt,end);
 db.exec("DELETE FROM progression_xp_ledger WHERE id='interval-5'");assert.equal(derivePlaytimeSource(db,A,30000),null);
});
test('a multi-level grant binds every supported crossed level to the same original activity without repaying rewards',t=>{
 const f=fixture(t),at=Date.now()-60000;const result=f.grant(f.progression.xpToReachLevel(100),at);
 assert.equal(result.newLevel,100);assert.equal(result.vcAwarded,9900);
 for(const id of ['first-level','level-10','level-25','level-50','level-100'])assert.equal(f.sources.read(A,id).sourceAt,at,id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM progression_level_sources').get().n,1);
 assert.equal(f.economy.getWallet(A).balance,9900);
});
test('undated triggering grants and undocumented legacy XP balances keep award timing unknown on reconciliation retries',t=>{
 const undated=fixture(t);undated.grant(250,undefined);assert.equal(undated.sources.read(A,'first-level'),null);undated.progression.unlockEligibleAchievements(A);assert.equal(undated.sources.read(A,'first-level'),null);
 const legacy=fixture(t);legacy.progression.getProfile(A,{sync:false});const old=legacy.progression.xpToReachLevel(9);
 legacy.db.prepare('UPDATE progression_players SET xp=?,level=9 WHERE steam_id=?').run(old,A);legacy.grant(1000,Date.now()-60000);
 assert.equal(legacy.sources.read(A,'level-10'),null);assert.equal(legacy.db.prepare('SELECT count(*) n FROM progression_level_sources').get().n,0);
});
