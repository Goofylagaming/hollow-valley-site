"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {execFileSync}=require('node:child_process');
const {createSeasonTrackStore,describe}=require('../automation-platform/src/services/seasonTrackStore');
const {createAchievementSourceTimeStore}=require('../automation-platform/src/services/achievementSourceTime');
const {inspectSeasonTrack}=require('../automation-platform/src/services/seasonTrackInspection'),{main}=require('../scripts/review-season-track.cjs');
const A='76561198000000401',B='76561198000000402',START=Date.now()-60000,iso=x=>new Date(x).toISOString();
function fixture(t,{achievement=false,file=false}={}) {
 const directory=file?fs.mkdtempSync(path.join(os.tmpdir(),'hv-season-health-')):null,database=file?path.join(directory,'synthetic.sqlite'):':memory:',db=new DatabaseSync(database);
 t.after(()=>{db.close();if(directory)fs.rmSync(directory,{recursive:true,force:true});});
 db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE economy_wallets(steam_id TEXT,balance INTEGER);
 CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
 CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
 CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));
 CREATE TABLE economy_quest_achievements(steam_id TEXT,quest_id TEXT,period_key TEXT,achieved_at TEXT);`);
 let clock=START-1000;const store=createSeasonTrackStore(db,{now:()=>clock}),sources=createAchievementSourceTimeStore(db,{now:()=>clock});
 const def={id:'synthetic-health-season',title:'Private fixture title',startsAt:iso(START),endsAt:iso(START+86400000),settlesAt:iso(START+2*86400000),retainUntil:iso(START+30*86400000),free:true,sources:[{source:'quest',policy:'achievement-time'}],tiers:[{xp:10,title:'Private fixture milestone'}],...(achievement?{achievementPoints:{policy:'qualifying-source-time',awards:[{id:'quest-1',xp:25}]}}:{})},digest=describe(def).digest;
 store.stage(def,{reviewer:A,digest});store.changeState(def.id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=START;store.enroll(def.id,A);store.enroll(def.id,B);
 const grant=(id,who=A,{known=true,received=clock}={})=>{db.prepare("INSERT INTO progression_xp_ledger VALUES(?,?,10,'quest','quest',?)").run(id,who,iso(received));if(known)db.prepare("INSERT INTO progression_xp_source_times VALUES(?,?,'quest-achievement')").run(id,clock);};
 const health=options=>inspectSeasonTrack(db,def.id,{now:clock,...options});
 return {db,store,sources,def,database,digest,grant,health,clock:value=>{clock=value;}};
}
test('health reports bounded backlog pages and no player identities or private labels; reads do not collect or repair',t=>{
 const f=fixture(t);for(let i=0;i<105;i++)f.grant('private-ledger-'+i,A,{known:i!==1});f.grant('private-b',B,{received:START+3600000});
 const before=f.db.prepare('SELECT total_changes() n').get().n,report=f.health({limit:1});
 assert.equal(report.checks.coreSchema,true);assert.equal(report.checks.reviewVerified,true);assert.equal(report.checks.sourceIndex,true);assert.equal(report.checks.collectionQueue,true);
 assert.equal(report.sample.participantsProbed,1);assert.equal(report.sample.pendingProgressParticipants,1);assert.equal(report.sample.unprocessedXpCandidates,100);assert.equal(report.sample.unknownXpClockCandidates,1);assert.equal(report.sample.moreXpCandidatesParticipants,1);assert.equal(report.sample.moreParticipants,true);
 assert.equal(report.sample.oldestSampledPendingReceiptAt,START);assert.ok(report.sample.nextPosition>0);
 const second=f.health({limit:1,after:report.sample.nextPosition});assert.equal(second.sample.participantsProbed,1);assert.equal(second.sample.futureReceivedCandidates,1);assert.equal(second.sample.nextPosition,null);
 assert.doesNotMatch(JSON.stringify(report),/76561198|private-ledger|Private fixture|steam_id|skin_json/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.db.isTransaction,false);
 assert.equal(f.store.progress(f.def.id,A).xp,0);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n,0);
});
test('changed copied sources are visible as invalid while unknown legacy badge clocks stay undated',t=>{
 const f=fixture(t,{achievement:true});f.grant('copied');f.store.collect();f.db.exec("UPDATE progression_xp_ledger SET amount=20 WHERE id='copied'");
 f.db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(A,'quest-1',JSON.stringify({type:'quests',threshold:1,value:1}),iso(START));
 const report=f.health();assert.equal(report.sample.invalidCopiedParticipants,1);assert.equal(report.sample.undatedSelectedBadges,1);assert.equal(report.checks.achievementSources[0].schemaReady,true);
 assert.equal(f.sources.read(A,'quest-1'),null);assert.equal(f.store.progress(f.def.id,A).xp,0);
 f.db.exec('DROP TABLE economy_quest_achievements');assert.equal(f.health().checks.achievementSources[0].schemaReady,false);
});
test('corrupt rules stop private probing and replaced hooks/queue inconsistencies are reported without silent repair',t=>{
 const f=fixture(t);f.grant('pending');f.db.exec(`DELETE FROM progression_season_collection_queue WHERE steam_id='${A}';INSERT INTO progression_season_collection_queue(season_id,steam_id) VALUES('${f.def.id}','76561198000000409');UPDATE progression_season_collection_cursor SET after_position=-1;`);
 // The checkpoint is absent before the first collector run, so insert the bad value explicitly.
 f.db.exec('INSERT OR REPLACE INTO progression_season_collection_cursor VALUES(1,-1)');
 const report=f.health();assert.equal(report.checks.queueConsistency.enrollmentsWithoutJobs,1);assert.equal(report.checks.queueConsistency.jobsWithoutEnrollment,1);assert.equal(report.checks.queueConsistency.cursorValid,false);
 f.db.exec('DROP TRIGGER progression_season_source_insert;CREATE TRIGGER progression_season_source_insert AFTER INSERT ON progression_xp_ledger BEGIN SELECT 1;END');assert.equal(f.health().checks.sourceIndex,false);
 f.db.exec('DROP TRIGGER progression_season_collection_leave');assert.equal(f.health().checks.collectionQueue,false);assert.throws(()=>f.health({after:1}),/Prepare.*queue/);assert.equal(f.db.isTransaction,false);
 f.db.exec("UPDATE progression_seasons SET digest='altered'");const changed=f.health();assert.equal(changed.checks.reviewVerified,false);assert.equal(changed.sample,null);assert.equal(changed.season,null);
});
test('unavailable participant projections are counted without leaking errors or starving other sampled accounts',t=>{
 const f=fixture(t,{achievement:true});f.grant('a');f.grant('b',B);f.db.prepare('DELETE FROM progression_season_achievement_cursors WHERE steam_id=?').run(A);
 const report=f.health();assert.equal(report.sample.unavailableParticipants,1);assert.equal(report.sample.pendingProgressParticipants,1);assert.equal(report.sample.unprocessedXpCandidates,1);assert.doesNotMatch(JSON.stringify(report),/76561198|consent evidence/);
});
test('expired seasons report cleanup work without probing private progress; unsupported pages do not write',t=>{
 const f=fixture(t);f.grant('old');f.clock(Date.parse(f.def.retainUntil));const report=f.health({limit:1});assert.equal(report.season.retentionExpired,true);assert.equal(report.sample.participantsProbed,0);assert.equal(report.sample.expiredEnrollments,1);assert.equal(report.sample.moreExpiredEnrollments,true);
 for(const options of [{limit:0},{limit:11},{limit:1.5},{after:-1},{after:NaN}])assert.throws(()=>f.health(options),/bounded/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_enrollments').get().n,2);
});
test('CLI health opens only an explicit existing database read-only and preserves exact bytes; unprepared schemas remain unprepared',t=>{
 const f=fixture(t,{file:true});f.grant('existing');f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');const before=fs.readFileSync(f.database),args=['health','--database',f.database,'--id',f.def.id];
 const report=main([...args,'--limit','1','--after','0']);assert.equal(report.written,false);assert.equal(report.mode,'read-only');assert.equal(report.sample.participantsProbed,1);assert.deepEqual(fs.readFileSync(f.database),before);
 const unused=path.join(path.dirname(f.database),'must-not-create.sqlite');
 const actual=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/review-season-track.cjs'),...args,'--limit','1'],{encoding:'utf8',env:{...process.env,AUTOMATION_DB_PATH:unused}}));
 assert.equal(actual.mode,'read-only');assert.equal(actual.written,false);assert.equal(actual.sample.participantsProbed,1);assert.equal(fs.existsSync(unused),false);assert.deepEqual(fs.readFileSync(f.database),before);
 for(const extra of [['--write'],['--limit','0'],['--limit','1.5'],['--limit','1','--limit','2'],['--after','-1'],['--after','9007199254740992'],['--repair','true']])assert.throws(()=>main([...args,...extra]));assert.deepEqual(fs.readFileSync(f.database),before);
 const absent=path.join(path.dirname(f.database),'absent.sqlite');assert.throws(()=>main(['health','--database',absent,'--id',f.def.id]));assert.equal(fs.existsSync(absent),false);
 const other=path.join(path.dirname(f.database),'unprepared.sqlite'),empty=new DatabaseSync(other);empty.close();const old=fs.readFileSync(other);const missing=main(['health','--database',other,'--id',f.def.id]);assert.equal(missing.checks.coreSchema,false);assert.equal(missing.sample,null);assert.deepEqual(fs.readFileSync(other),old);
 assert.equal(require.cache[require.resolve('../automation-platform/src/services/economyStore')],undefined);
});
test('health holds a consistent read snapshot while another connection changes source evidence',t=>{
 const f=fixture(t,{file:true});f.grant('snapshot-source');f.store.collect();const writer=new DatabaseSync(f.database);let changed=false;
 const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{const statement=prepare(sql);if(!changed && sql.startsWith('SELECT q.position')){const all=statement.all.bind(statement);statement.all=(...args)=>{changed=true;writer.exec("UPDATE progression_xp_ledger SET amount=20 WHERE id='snapshot-source'");return all(...args);};}return statement;};
 try{const report=f.health();assert.equal(changed,true);assert.equal(report.sample.invalidCopiedParticipants,0,'the projection uses the same old snapshot as the rule and queue reads');assert.equal(f.db.prepare("SELECT amount FROM progression_xp_ledger WHERE id='snapshot-source'").get().amount,20);assert.equal(f.health().sample.invalidCopiedParticipants,1);}finally{writer.close();}
});
