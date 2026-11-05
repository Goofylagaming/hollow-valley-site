const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-title-evidence-'));
process.env.AUTOMATION_DB_PATH=path.join(dir,'test.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN='title-fixture-token';
const store=require('../src/services/economyStore');
const progression=require('../src/services/progressionService');
const a='76561198000000131',b='76561198000000132';
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('bounded authenticated evidence reads exclude reviewed awards and perform no writes',async()=>{
  for(const id of ['quest-100','level-10','playtime-100h'])store.db.prepare('INSERT INTO progression_achievements(steam_id,achievement_id,metadata_json) VALUES (?,?,?)').run(a,id,'{}');
  store.db.prepare('INSERT INTO progression_achievement_review_state VALUES (?,?,?,?)').run(a,'level-10',1,'withdrawn');
  store.db.prepare('INSERT INTO progression_achievement_evidence_reviews VALUES (?,?,?,?,?,?)').run(a,'playtime-100h','test','evidence',1,'pending');
  const before=store.db.prepare('SELECT total_changes() AS n').get().n;
  const app=express();app.use(express.json());app.use('/evidence',require('../src/routes/websiteTitleEvidenceRoutes'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/evidence`;
  const post=(steamIds,token='title-fixture-token')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({steamIds})});
  try {
    assert.equal((await post([a],'wrong')).status,401);
    for(const input of [null,['invalid'],Array(801).fill(a)])assert.equal((await post(input)).status,400);
    const response=await post([a,b,a]);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual((await response.json()).players,[{steamId:a,achievementIds:['quest-100']},{steamId:b,achievementIds:[]}]);
    assert.equal(store.db.prepare('SELECT total_changes() AS n').get().n,before);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
