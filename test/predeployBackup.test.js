"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const backup=require("../server/predeployBackup");
const workdir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-backup-predeploy-"));
test.after(()=>fs.rmSync(workdir,{recursive:true,force:true}));

function setup(filename,seed){
  const db=new DatabaseSync(filename);
  try{
    db.exec("PRAGMA journal_mode=WAL;");
    for(const name of backup.MUST_EXIST){
      db.exec('CREATE TABLE "'+name+'" (id INTEGER PRIMARY KEY, marker TEXT)');
      db.prepare('INSERT INTO "'+name+'" (marker) VALUES (?)').run(seed);
    }
    db.prepare("INSERT INTO wallets(marker) VALUES(?)").run("balance:" + seed);
    db.exec("PRAGMA wal_autocheckpoint=0;");
    db.prepare("INSERT INTO users(marker) VALUES(?)").run("uncheckpointed:" + seed);
  }finally{db.close();}
}
test("an existing production database receives a consistent, independently readable immutable snapshot",()=>{
  const src=path.join(workdir,"source.sqlite");
  const dst=path.join(workdir,"backups","release.sqlite");
  setup(src,"existing-player-data");
  const pre=backup.quickCheck(src);
  assert.equal(pre.integrity,"ok");
  const saved=backup.backupDatabase({source:src,destination:dst});
  assert.equal(saved.created,true);
  assert.equal(saved.counts.users,2);
  assert.equal(saved.counts.wallets,2);
  assert.equal(saved.counts.roster,1);
  assert.equal(fs.existsSync(dst),true);
  assert.equal(fs.statSync(dst).mode & 0o077,0,"Backup must be owner-only");
  assert.equal(fs.existsSync(dst+".incomplete"),false);
  const db=new DatabaseSync(dst,{readOnly:true});
  try{
    assert.deepEqual(db.prepare("SELECT marker FROM wallets ORDER BY id").all()
      .map(x=>x.marker),["existing-player-data","balance:existing-player-data"]);
    assert.equal(db.prepare("SELECT marker FROM users WHERE marker LIKE 'uncheckpointed:%'").all().length,1);
  }finally{db.close();}
  // Another deploy cannot silently replace the pre-migration backup.
  const live=new DatabaseSync(src);
  try{live.prepare("INSERT INTO wallets(marker) VALUES(?)").run("newer-wallet-change");}
  finally{live.close();}
  const again=backup.backupDatabase({source:src,destination:dst});
  assert.equal(again.created,false);
  assert.equal(again.counts.wallets,2);
  assert.equal(backup.quickCheck(src).counts.wallets,3);
});
test("missing or malformed production database refuses to initialise fresh player records",()=>{
  const absent=path.join(workdir,"missing.sqlite");
  const dest=path.join(workdir,"missing-backup.sqlite");
  assert.throws(()=>backup.backupDatabase({source:absent,destination:dest}),/missing/);
  assert.equal(fs.existsSync(absent),false);
  assert.equal(fs.existsSync(dest),false);
  const corrupted=path.join(workdir,"invalid.sqlite");
  fs.writeFileSync(corrupted,Buffer.from("not a real database"));
  assert.throws(()=>backup.backupDatabase({source:corrupted,destination:dest}));
  assert.equal(fs.existsSync(dest),false);
});
test("backup refuses to overwrite live sqlite file or silently export missing core tables",()=>{
  const src=path.join(workdir,"unsafe.sqlite");
  const db=new DatabaseSync(src);
  try{db.exec("CREATE TABLE unrelated (id INTEGER)");}finally{db.close();}
  assert.throws(()=>backup.backupDatabase({source:src,destination:src}),/Refusing to overwrite/);
  assert.throws(()=>backup.backupDatabase({source:src,destination:path.join(workdir,"backup.sqlite")}),/missing required established tables/);
});
test("backup activation is bound to the exact production attached disk path",()=>{
  const oldDb=process.env.DB_PATH,oldEnv=process.env.NODE_ENV;
  try{
    process.env.NODE_ENV="production";
    process.env.DB_PATH=path.join(workdir,"source.sqlite");
    assert.deepEqual(backup.beforeDatabaseInitialization(),{required:false});
    process.env.DB_PATH="/tmp/anotherwebsite.sqlite";
    assert.deepEqual(backup.beforeDatabaseInitialization(),{required:false});
    assert.equal(backup.PRODUCTION_DB,"/app/data/hollowvalley.sqlite");
    assert.equal(backup.SNAPSHOT.startsWith("/app/data/backups/"),true);
  }finally{
    if(oldDb===undefined)delete process.env.DB_PATH;
    else process.env.DB_PATH=oldDb;
    if(oldEnv===undefined)delete process.env.NODE_ENV;
    else process.env.NODE_ENV=oldEnv;
  }
});
test("production entrypoint requires predeploy database check before importing the database",()=>{
  const src=fs.readFileSync(path.join(__dirname,"..","server","index.js"),"utf8");
  assert.ok(src.indexOf('beforeDatabaseInitialization()')>=0);
  assert.ok(src.indexOf('beforeDatabaseInitialization()')<src.indexOf('require("./db")'));
});
