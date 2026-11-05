const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes } = require('node:crypto');
const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});
test('death recap HTTP reads bind the victim to the session and require internal authentication', async () => {
  const keys = ['DEATH_RECAP_ENABLED','VALLEY_LEGACY_ENABLED','HOLLOW_VALLEY_API_TOKEN','AUTOMATION_SERVICE_URL'];
  const saved = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  Object.assign(process.env,{DEATH_RECAP_ENABLED:'1',VALLEY_LEGACY_ENABLED:'1',HOLLOW_VALLEY_API_TOKEN:randomBytes(32).toString('hex')});
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE combat_events(id TEXT,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT)');
  const steam='76561198000000801', other='76561198000000802';
  const insert=db.prepare('INSERT INTO combat_events VALUES (?,?,?,?,?)');
  insert.run('owned',new Date(Date.now()-600000).toISOString(),'Recorded attacker',other,steam);
  insert.run('foreign',new Date(Date.now()-600000).toISOString(),'Other attacker',steam,other);
  insert.run('recent',new Date().toISOString(),'Recent attacker',other,steam);
  const legacy=require('../automation-platform/src/services/valleyLegacyService'), original=legacy.get;
  legacy.get=()=>({db});
  let backend,website;
  try {
    const internal=express();internal.use(express.json());internal.use('/api/website/legacy/death-recaps',require('../automation-platform/src/routes/deathRecapRoutes'));backend=await listen(internal);
    process.env.AUTOMATION_SERVICE_URL=backend.url;
    const app=express();app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});app.use('/recaps',require('../server/routes/deathRecaps'));website=await listen(app);
    assert.equal((await fetch(website.url+'/recaps')).status,401);
    assert.equal((await fetch(website.url+'/recaps',{headers:{'x-user':'bad'}})).status,403);
    assert.equal((await fetch(backend.url+'/api/website/legacy/death-recaps/list',{method:'POST'})).status,401);
    const response=await fetch(website.url+'/recaps?steamId='+other,{headers:{'x-user':steam}});
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const payload=await response.json();assert.deepEqual(payload.recaps.map(row=>row.id),['owned']);
    assert.equal(JSON.stringify(payload).includes(other),false);
    process.env.DEATH_RECAP_ENABLED='0';assert.equal((await fetch(website.url+'/recaps',{headers:{'x-user':steam}})).status,503);
  } finally {
    for(const surface of [website,backend])if(surface)await new Promise(resolve=>surface.server.close(resolve));
    legacy.get=original;db.close();for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
