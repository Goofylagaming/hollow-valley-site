import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {importSnapshotIntoNewSqlite,readPostgresSnapshot} from "../sqlite-migration.mjs";
import {openSqlitePool} from "../sqlite-pg-compat.mjs";

const stamp="2026-10-20T00:00:00.000Z";
function fixture(){
 const uid="00000000-0000-4000-8000-000000000099";
 return {users:[{id:uid,username:"RexPlayer",username_lower:"rexplayer",password_hash:"scrypt$SAMPLE",failed_attempts:0,locked_until:null,created_at:stamp}],
  sessions:[{token_hash:"f".repeat(64),user_id:uid,expires_at:"2026-12-01T00:00:00.000Z",created_at:stamp}],
  saves:[{user_id:uid,revision:3,save_data:{version:7,stage:355,bones:78000,dinos:[{id:"rex",level:75}]},updated_at:stamp}],
  history:[{user_id:uid,revision:1,save_data:{version:7,stage:170,bones:20000},saved_at:stamp},
           {user_id:uid,revision:2,save_data:{version:7,stage:299,bones:42000},saved_at:stamp}]};
}
function directory(t){
 const p=fs.mkdtempSync(path.join(os.tmpdir(),"pb-import-"));
 t.after(()=>fs.rmSync(p,{recursive:true,force:true}));
 return p;
}
test("imports PostgreSQL users, sessions, data and history to new independent SQLite file",async t=>{
 const dir=directory(t),target=path.join(dir,"primalbound-cloud","primalbound.sqlite");
 let checked=false;
 const outcome=await importSnapshotIntoNewSqlite(fixture(),target,{
  beforePublish:async pool=>{checked=true;assert.equal(pool.integrityCheck(),true);assert.equal(pool.countUsers(),1);return {verified:true};}
 });
 assert.equal(checked,true);
 assert.deepEqual({users:outcome.users,sessions:outcome.sessions,saves:outcome.saves,history:outcome.history},
  {users:1,sessions:1,saves:1,history:2});
 const pool=openSqlitePool(target,{create:false});
 const row=await pool.query("SELECT save_data,revision,updated_at FROM pb_saves WHERE user_id=$1",[fixture().users[0].id]);
 assert.equal(row.rows[0].revision,3);
 assert.equal(row.rows[0].save_data.stage,355);
 assert.equal(row.rows[0].save_data.dinos[0].level,75);
 const history=await pool.query("SELECT revision,saved_at,save_data->>'stage' AS stage,save_data->>'bones' AS bones,save_data->>'wins' AS wins FROM pb_save_history WHERE user_id=$1 ORDER BY revision DESC LIMIT 10",[fixture().users[0].id]);
 assert.deepEqual(history.rows.map(r=>r.revision),[2,1]);
 const auth=await pool.query("SELECT u.id,u.username FROM pb_sessions s JOIN pb_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",["f".repeat(64)]);
 assert.equal(auth.rows[0].username,"RexPlayer");
 await pool.end();
});
test("aborts before creating target if external backup read-back fails",async t=>{
 const dir=directory(t),target=path.join(dir,"primalbound-cloud","primalbound.sqlite");
 await assert.rejects(importSnapshotIntoNewSqlite(fixture(),target,{beforePublish:async()=>{throw Error("offsite rejected")}}),/offsite rejected/);
 assert.equal(fs.existsSync(target),false);
 assert.deepEqual(fs.readdirSync(path.dirname(target)),[]);
});
test("never overwrites existing Hollow Valley or Primalbound data",async t=>{
 const dir=directory(t),target=path.join(dir,"shared.sqlite");
 const legacy=new DatabaseSync(target);legacy.exec("CREATE TABLE territory_wars(id INTEGER PRIMARY KEY);INSERT INTO territory_wars VALUES(7)");legacy.close();
 await assert.rejects(importSnapshotIntoNewSqlite(fixture(),target),/already exists/);
 const saved=new DatabaseSync(target,{readOnly:true});assert.equal(saved.prepare("SELECT id FROM territory_wars").get().id,7);saved.close();
});
test("rejects incomplete or inconsistent Postgres snapshots atomically",async t=>{
 const dir=directory(t),target=path.join(dir,"primalbound.sqlite");
 await assert.rejects(importSnapshotIntoNewSqlite({...fixture(),users:[]},target),/FOREIGN KEY|constraint/i);
 assert.equal(fs.existsSync(target),false);
 await assert.rejects(importSnapshotIntoNewSqlite({...fixture(),history:null},target),/Missing PostgreSQL snapshot/);
 assert.equal(fs.existsSync(target),false);
});
test("Postgres source snapshot reads transactionally and commits without mutations",async()=>{
 const events=[];
 const f=fixture();
 const client={
  async query(sql){events.push(sql);
   if(sql.startsWith("BEGIN")||sql==="COMMIT")return {rows:[]};
   if(sql.includes("FROM pb_users"))return {rows:f.users};
   if(sql.includes("FROM pb_sessions"))return {rows:f.sessions};
   if(sql.includes("FROM pb_saves"))return {rows:f.saves};
   if(sql.includes("FROM pb_save_history"))return {rows:f.history};
   throw Error("Unexpected source query");
  }
 };
 const rows=await readPostgresSnapshot(client);
 assert.equal(rows.users.length,1);assert.equal(rows.history.length,2);
 assert.match(events[0],/READ ONLY/);
 assert.equal(events.at(-1),"COMMIT");
 assert.equal(events.filter(x=>/UPDATE|DELETE|INSERT/.test(x)).length,0);
});
