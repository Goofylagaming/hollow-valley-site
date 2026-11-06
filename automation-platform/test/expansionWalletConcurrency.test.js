"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {Worker}=require("node:worker_threads");

test("independent wallet connections serialize duplicate daily claims and capped Arcade settlements",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-wallet-race-"));
  process.env.AUTOMATION_DB_PATH=path.join(dir,"wallet.sqlite");
  process.env.VALLEY_ARCADE_ENABLED="1";
  const arcade=require("../src/services/valleyArcade");
  const store=require("../src/services/economyStore");
  t.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const steamId="76561198000000555";
  const now=Date.parse("2026-11-06T02:00:00Z");
  arcade.configure("test",{enabled:true,emergency:false,cap:1000});
  for(const round of ["r1","r2"]) store.db.prepare("INSERT INTO arcade_rounds(id,steam_id,game,opened_at) VALUES (?,?,'trivia',?)").run(round,steamId,now);
  const dailyPath=require.resolve("../src/services/dailyLoginWallet");
  const arcadePath=require.resolve("../src/services/valleyArcade");
  const code=`
    const {parentPort,workerData:d}=require("node:worker_threads");
    const daily=require(d.dailyPath),arcade=require(d.arcadePath);
    parentPort.once("message",()=>{
      daily.claimDaily(d.steamId,"legend","2026-11-06",d.now);
      arcade.settle(d.steamId,d.round,1,800,d.now);
      parentPort.postMessage("settled");
    });
    parentPort.postMessage("ready");`;
  const workers=["r1","r2","r1","r2"].map(round=>new Worker(code,{eval:true,workerData:{round,steamId,now,dailyPath,arcadePath}}));
  const message=w=>new Promise((resolve,reject)=>{w.once("message",resolve);w.once("error",reject);});
  await Promise.all(workers.map(message));
  const settled=workers.map(message);
  workers.forEach(w=>w.postMessage("start"));
  await Promise.all(settled);
  await Promise.all(workers.map(w=>w.terminate()));
  assert.equal(store.getWallet(steamId).balance,1650);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM economy_wallet_ledger WHERE kind='daily_login_reward'").get().n,1);
  assert.equal(store.db.prepare("SELECT sum(payout) AS total FROM arcade_rounds").get().total,1000);
});
