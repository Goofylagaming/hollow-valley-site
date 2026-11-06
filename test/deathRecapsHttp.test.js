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
  db.exec("CREATE TABLE combat_events(id TEXT,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT,source TEXT DEFAULT 'hollow-valley-game');CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT)");
  const steam='76561198000000801', other='76561198000000802';
  db.prepare('INSERT INTO users VALUES(1,?)').run(steam);
  const insert=db.prepare('INSERT INTO combat_events(id,occurred_at,killer_name,killer_steam_id,victim_steam_id) VALUES (?,?,?,?,?)');
  insert.run('owned',new Date(Date.now()-600000).toISOString(),'Recorded attacker',other,steam);
  insert.run('foreign',new Date(Date.now()-600000).toISOString(),'Other attacker',steam,other);
  insert.run('recent',new Date().toISOString(),'Recent attacker',other,steam);
  const legacy=require('../automation-platform/src/services/valleyLegacyService'), original=legacy.get;
  let sourceReads=0;legacy.get=()=>{sourceReads++;return {db};};
  let backend,website;
  try {
    const internal=express();internal.use(express.json());internal.use('/api/website/legacy/death-recaps',require('../automation-platform/src/routes/deathRecapRoutes'));backend=await listen(internal);
    process.env.AUTOMATION_SERVICE_URL=backend.url;
    const app=express();app.use((req,_res,next)=>{if(req.get('x-user'))req.user={id:1,steam_id:req.get('x-user')};next();});app.use('/recaps',require('../server/routes/deathRecaps').createDeathRecapsRouter({db}));website=await listen(app);
    assert.equal((await fetch(website.url+'/recaps')).status,401);
    assert.equal((await fetch(website.url+'/recaps',{headers:{'x-user':'bad'}})).status,403);
    assert.equal((await fetch(backend.url+'/api/website/legacy/death-recaps/list',{method:'POST'})).status,401);
    const internalHeaders={'Authorization':'Bearer '+process.env.HOLLOW_VALLEY_API_TOKEN,'Content-Type':'application/json'};
    assert.equal((await fetch(backend.url+'/api/website/legacy/death-recaps/list',{method:'POST',headers:internalHeaders,body:JSON.stringify({steamId:steam,source:'manual'})})).status,400);
    const headers={'x-user':steam,'X-Death-Recap-Actor':'1:'+steam};
    assert.equal((await fetch(website.url+'/recaps?steamId='+other,{headers})).status,400);
    assert.equal((await fetch(website.url+'/recaps',{headers:{'x-user':steam}})).status,403);
    assert.equal((await fetch(website.url+'/recaps',{headers:{...headers,'X-Death-Recap-Actor':'2:'+other}})).status,403);
    const response=await fetch(website.url+'/recaps',{headers});
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    const payload=await response.json();assert.deepEqual(payload.recaps.map(row=>row.id),['owned']);
    assert.equal(payload.actorBinding,'1:'+steam);
    assert.equal(JSON.stringify(payload).includes(other),false);
    process.env.DEATH_RECAP_ENABLED='0';assert.equal((await fetch(website.url+'/recaps',{headers:{'x-user':steam}})).status,503);
    const readsBefore=sourceReads;
    assert.equal((await fetch(backend.url+'/api/website/legacy/death-recaps/list',{method:'POST',headers:internalHeaders,body:JSON.stringify({steamId:steam})})).status,503);
    assert.equal(sourceReads,readsBefore,'disabled source reads must not initialize Legacy storage');
  } finally {
    for(const surface of [website,backend])if(surface)await new Promise(resolve=>surface.server.close(resolve));
    legacy.get=original;db.close();for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});

test('recap responses recheck saved account identity and rollout after a delayed source read', async () => {
  const db=new DatabaseSync(':memory:'),steam='76561198000000801',other='76561198000000802';
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT)');db.prepare('INSERT INTO users VALUES(1,?)').run(steam);
  let enabled=true,release,entered;
  const client={legacyRequest:async(_path,options)=>{assert.deepEqual(options.body,{steamId:steam});entered();await new Promise(resolve=>{release=resolve;});return {recaps:[{id:'private-evidence'}]};}};
  const app=express();app.use((req,_res,next)=>{req.user={id:1,steam_id:steam};next();});app.use('/recaps',require('../server/routes/deathRecaps').createDeathRecapsRouter({db,client,enabled:()=>enabled}));const surface=await listen(app);
  try {
    for(const change of ['relink','delete','pause']){
      db.prepare('INSERT OR REPLACE INTO users VALUES(1,?)').run(steam);enabled=true;
      let ready;const pending=new Promise(resolve=>{ready=resolve;});entered=ready;
      const request=fetch(surface.url+'/recaps',{headers:{'X-Death-Recap-Actor':'1:'+steam}});await pending;
      if(change==='relink')db.prepare('UPDATE users SET steam_id=? WHERE id=1').run(other);
      if(change==='delete')db.exec('DELETE FROM users');
      if(change==='pause')enabled=false;
      release();const response=await request;assert.equal(response.status,change==='pause'?503:403);assert.equal((await response.text()).includes('private-evidence'),false);
    }
  } finally { await new Promise(resolve=>surface.server.close(resolve));db.close(); }
});
