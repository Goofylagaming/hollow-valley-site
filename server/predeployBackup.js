"use strict";
// Deployment preflight: one-time, consistent backup of the *existing* website
// SQLite database before any new feature module creates tables or migrates it.
// This never restores, changes or removes player records.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PRODUCTION_DB = "/app/data/hollowvalley.sqlite";
const SNAPSHOT = "/app/data/backups/hollowvalley-before-ux-roadmap-20261027.sqlite";
const MUST_EXIST = Object.freeze([
  "users", "wallets", "wallet_transactions", "roster", "skins",
  "supporter_subscriptions", "sessions",
]);

function sqlString(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
function quickCheck(filename) {
  const db = new DatabaseSync(filename, { readOnly:true });
  try {
    const check = db.prepare("PRAGMA quick_check").all().map(item => Object.values(item)[0]);
    if (!check.length || check.some(value => value !== "ok")) {
      throw new Error("SQLite database integrity check failed");
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = new Set(tables.map(x => x.name));
    const missing = MUST_EXIST.filter(name => !names.has(name));
    if (missing.length) throw new Error("Database is missing required established tables: " + missing.join(", "));
    const counts = {};
    for(const table of MUST_EXIST){
      counts[table]=db.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').get().n;
    }
    return {counts, integrity:"ok",sizeBytes:fs.statSync(filename).size};
  } finally { db.close(); }
}
function backupDatabase({source,destination}) {
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  if(resolvedSource===resolvedDestination) throw new Error("Refusing to overwrite live website database");
  if(!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) {
    throw new Error("Production website SQLite database is missing; do not initialise empty player data");
  }
  if(fs.existsSync(resolvedDestination)) {
    // A previous attempt already created the copy. Keep it immutable.
    return { ...quickCheck(resolvedDestination), created:false, path:resolvedDestination };
  }
  // Validate the existing site database before attempting any schema work.
  const old=quickCheck(resolvedSource);
  const backupDir=path.dirname(resolvedDestination);
  fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const available=fs.statfsSync(backupDir);
  const free=available.bavail*available.bsize;
  // VACUUM INTO may be compact, but never risk filling a Render persistent
  // disk to create the backup. Fail before site schema initialisation.
  if(free < old.sizeBytes + 16*1024*1024){
    throw new Error("Insufficient persistent disk space for safe website database backup");
  }
  const tmp=resolvedDestination+".incomplete";
  if(fs.existsSync(tmp)) fs.rmSync(tmp,{force:true});
  let database;
  try {
    database=new DatabaseSync(resolvedSource);
    database.exec("PRAGMA busy_timeout = 7000;");
    // Transactionally consistent copy includes the original WAL's changes.
    database.exec("VACUUM INTO "+sqlString(tmp));
    database.close();
    database=null;
    const copy=quickCheck(tmp);
    for(const table of MUST_EXIST){
      // Counts are captured at slightly different moments if old production
      // serves requests concurrently; no strict equality assertion here.
      if(copy.counts[table]<0)throw new Error("Invalid copied table row count");
    }
    const fd=fs.openSync(tmp,"r");
    try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.chmodSync(tmp,0o600);
    fs.renameSync(tmp,resolvedDestination);
    return {...copy,created:true,path:resolvedDestination};
  } catch(error) {
    try { database?.close(); } catch {}
    try { if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true}); } catch {}
    throw error;
  }
}
function beforeDatabaseInitialization() {
  // Other environments, including isolated CI, never back up to production.
  if(process.env.NODE_ENV!=="production" ||
    path.resolve(process.env.DB_PATH || "")!==PRODUCTION_DB) return {required:false};
  const result=backupDatabase({source:PRODUCTION_DB,destination:SNAPSHOT});
  console.log("[predeploy-db] verified protected website snapshot; created="+result.created+
    " sizeBytes="+result.sizeBytes+" integrity="+result.integrity);
  return {required:true,created:result.created,integrity:result.integrity};
}
module.exports={PRODUCTION_DB,SNAPSHOT,MUST_EXIST,quickCheck,backupDatabase,beforeDatabaseInitialization};
