"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {DatabaseSync}=require('node:sqlite'),{randomBytes,randomUUID}=require('node:crypto');
const STAFF='76561198000000801',OTHER='76561198000000802',PLAYER='76561198000000803',GUILD='10000000000001',EVENT='10000000000002';
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`}));});
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Delayed API did not reach its test gate');}
test('staff attendance requires fresh authority, saved review and the separate admin credential',async()=>{
  const keys=['DYNAMIC_CHALLENGES_ENABLED','DYNAMIC_CHALLENGES_EVENTS_ENABLED','DYNAMIC_CHALLENGES_READ_ONLY','DYNAMIC_CHALLENGES_EVENT_GUILD_ID','VALLEY_LEGACY_ENABLED','HOLLOW_VALLEY_API_TOKEN','AUTOMATION_ADMIN_TOKEN','AUTOMATION_SERVICE_URL','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  Object.assign(process.env,{DYNAMIC_CHALLENGES_ENABLED:'1',DYNAMIC_CHALLENGES_EVENTS_ENABLED:'1',DYNAMIC_CHALLENGES_EVENT_GUILD_ID:GUILD,VALLEY_LEGACY_ENABLED:'1',HOLLOW_VALLEY_API_TOKEN:randomBytes(32).toString('hex'),AUTOMATION_ADMIN_TOKEN:randomBytes(32).toString('hex')});
  const db=new DatabaseSync(':memory:'),web=new DatabaseSync(':memory:');let clock=Date.parse('2026-11-05T08:00:00+10:00');
  const store=require('../automation-platform/src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
  store.challenges.change(PLAYER,{selected:true,expectedRevision:0,requestKey:randomUUID()});clock+=2*3600000;
  const event={id:EVENT,guildId:GUILD,title:'Reviewed completed event',status:'completed',startTime:'2026-11-04T22:30:00.000Z',endTime:'2026-11-04T23:30:00.000Z'};
  db.exec('CREATE TABLE automation_state(key TEXT PRIMARY KEY,value_json TEXT)');
  const feed=()=>db.prepare("INSERT INTO automation_state VALUES ('discord:scheduled-events',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify({guildId:GUILD,syncedAt:new Date(clock).toISOString(),events:[event]}));feed();
  web.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER)');
  for(const [id,steam,admin]of [[1,STAFF,1],[2,OTHER,1],[3,PLAYER,0]])web.prepare('INSERT INTO users VALUES (?,?,?)').run(id,steam,admin);
  const legacy=require('../automation-platform/src/services/valleyLegacyService'),get=legacy.get;legacy.get=()=>store;
  let internal,website,hold=null,release=null;
  try {
    const backend=express();backend.use(express.json());backend.use('/api/admin/challenge-attendance',require('../automation-platform/src/routes/challengeAttendanceAdminRoutes'));internal=await listen(backend);process.env.AUTOMATION_SERVICE_URL=internal.url;
    const realClient=require('../server/services/automationWebsiteClient').challengeAttendanceRequest;
    const client=async(action,body)=>{const result=await realClient(action,body);if(hold===action){hold=null;await new Promise(resolve=>release=()=>{release=null;resolve();});}return result;};
    const app=express();app.use(express.json());app.use((req,_res,next)=>{const cached=web.prepare('SELECT * FROM users WHERE steam_id=?').get(req.get('x-user')||'');if(cached)req.user={...cached,is_admin:1};next();});
    app.use('/staff',require('../server/routes/challengeAttendance').createRouter({db:web,client,now:()=>clock}));website=await listen(app);
    const request=(path,{body,user=STAFF,origin=website.url,headers={}}={})=>fetch(website.url+'/staff'+path,{method:body===undefined?'GET':'POST',headers:{'x-user':user,Origin:origin,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const proposal={eventId:EVENT,steamId:PLAYER,actorSteamId:OTHER,action:'confirm',occurredAt:Date.parse('2026-11-04T23:00:00.000Z'),evidenceUrl:`https://discord.com/channels/${GUILD}/10000000000003/10000000000004`,reason:'Verified staff attendance evidence'};
    const direct=(path,token=process.env.HOLLOW_VALLEY_API_TOKEN)=>fetch(internal.url+'/api/admin/challenge-attendance/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(proposal)});
    assert.equal((await request('/capabilities',{user:''})).status,401);assert.equal((await request('/capabilities',{user:PLAYER})).status,403);
    assert.equal((await direct('review')).status,401);assert.equal((await direct('change')).status,401);
    const capabilities=await request('/capabilities');assert.equal(capabilities.headers.get('cache-control'),'private, no-store');assert.equal((await capabilities.json()).rewardsEnabled,false);
    for(const options of [{origin:'https://evil.invalid'},{origin:''},{headers:{'Sec-Fetch-Site':'cross-site'}},{headers:{'Content-Type':'text/plain'}}])assert.equal((await request('/reviews',{body:proposal,...options})).status,403);
    const preview=await request('/reviews',{body:proposal});assert.equal(preview.status,200);const review=await preview.json();
    assert.equal(review.body.actorSteamId,STAFF);assert.equal(review.body.steamId,PLAYER);assert.equal(review.body.expectedRevision,0);
    assert.equal(db.prepare('SELECT count(*) n FROM dc_attendance_evidence').get().n,0);
    assert.equal((await request('/reviews/'+review.id,{user:OTHER})).status,404);
    assert.equal((await request('/reviews/'+review.id+'/confirm',{body:{steamId:OTHER}})).status,400);
    const accepted=await request('/reviews/'+review.id+'/confirm',{body:{}});assert.equal(accepted.status,200);assert.equal((await accepted.json()).state,'confirmed');
    const audit=JSON.parse(db.prepare('SELECT payload FROM dc_attendance_audit').get().payload);assert.equal(audit.actorSteamId,STAFF);assert.equal(audit.steamId,PLAYER);
    assert.equal((await (await request('/reviews/'+review.id+'/confirm',{body:{}})).json()).duplicate,true);
    assert.equal(store.challenges.status(PLAYER).challenges.find(c=>c.id==='event-confirmed').progress,1);
    const revoke=await (await request('/reviews',{body:{...proposal,action:'revoke',occurredAt:1}})).json();assert.equal(revoke.body.occurredAt,proposal.occurredAt);
    web.prepare('UPDATE users SET is_admin=0 WHERE steam_id=?').run(STAFF);
    assert.equal((await request('/reviews/'+revoke.id+'/confirm',{body:{}})).status,403);assert.equal((await request('/reviews/'+review.id)).status,403);
    web.prepare('UPDATE users SET is_admin=1 WHERE steam_id=?').run(STAFF);
    assert.equal((await request('/reviews/'+revoke.id+'/confirm',{body:{}})).status,200);
    assert.equal((await (await request('/reviews/'+review.id+'/confirm',{body:{}})).json()).state,'revoked');
    assert.equal(db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n,2);
    const count=web.prepare('SELECT count(*) n FROM hv_challenge_attendance_reviews').get().n;
    hold='review';const delayed=request('/reviews',{body:proposal});await until(()=>release);
    web.prepare('UPDATE users SET is_admin=0 WHERE steam_id=?').run(STAFF);release();assert.equal((await delayed).status,403);
    assert.equal(web.prepare('SELECT count(*) n FROM hv_challenge_attendance_reviews').get().n,count);
    web.prepare('UPDATE users SET is_admin=1 WHERE steam_id=?').run(STAFF);
    const next=await (await request('/reviews',{body:proposal})).json();
    // Dispatch was authorized, but demotion before the response must still
    // prevent disclosing that delayed private response. The committed record
    // remains recoverable through the same saved request after reauthorization.
    hold='change';const dispatched=request('/reviews/'+next.id+'/confirm',{body:{}});await until(()=>release);
    web.prepare('UPDATE users SET is_admin=0 WHERE steam_id=?').run(STAFF);release();assert.equal((await dispatched).status,403);
    web.prepare('UPDATE users SET is_admin=1 WHERE steam_id=?').run(STAFF);
    assert.equal((await (await request('/reviews/'+next.id+'/confirm',{body:{}})).json()).duplicate,true);
    process.env.DYNAMIC_CHALLENGES_READ_ONLY='1';assert.equal((await request('/reviews',{body:proposal})).status,403);
    assert.equal((await direct('review',process.env.AUTOMATION_ADMIN_TOKEN)).status,403);assert.equal((await request('/record?eventId='+EVENT+'&steamId='+PLAYER)).status,200);
    delete process.env.DYNAMIC_CHALLENGES_READ_ONLY;process.env.RENDER_SERVICE_ID='preview-service';assert.equal((await request('/reviews',{body:proposal})).status,403);delete process.env.RENDER_SERVICE_ID;
    process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='0';assert.equal((await request('/reviews',{body:proposal})).status,503);assert.equal((await direct('current',process.env.AUTOMATION_ADMIN_TOKEN)).status,503);
    assert.equal((await (await request('/capabilities')).json()).enabled,false);
  }finally{
    if(release)release();for(const s of [website,internal])if(s)await new Promise(resolve=>s.server.close(resolve));legacy.get=get;db.close();web.close();for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
