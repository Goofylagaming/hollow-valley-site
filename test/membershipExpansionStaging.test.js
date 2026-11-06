"use strict";

// Run with synthetic accounts and disposable databases. Both the website
// router and the authenticated wallet router use their normal HTTP entry points.
process.env.DB_PATH=":memory:";
process.env.AUTOMATION_DB_PATH=":memory:";
process.env.HOLLOW_VALLEY_API_TOKEN=require("node:crypto").randomUUID();
for(const flag of ["MEMBERSHIP_COLLECTION_ENABLED","MEMBERSHIP_REWARDS_ENABLED","MEMBERSHIP_RECOGNITION_ENABLED",
  "MEMBERSHIP_GROWTH_ENABLED","SUBSCRIBER_COMMUNITY_ENABLED","COMMUNITY_PARTICIPATION_ENABLED","DAILY_LOGIN_REWARDS_ENABLED","VALLEY_ARCADE_ENABLED"]) process.env[flag]="1";
const test=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const {db}=require("../server/db");
const accounts=[
  {id:501,username:"Staging Player",steam_id:"76561198000000501",is_admin:0},
  {id:502,username:"Staging Moderator",steam_id:"76561198000000502",is_admin:1}
];

async function serve(app,t) {
  const server=await new Promise(resolve=>{const instance=app.listen(0,"127.0.0.1",()=>resolve(instance));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return "http://127.0.0.1:"+server.address().port;
}

test("isolated signed-in membership, moderation, growth and Arcade flows",async t=>{
  for(const u of accounts) db.prepare("INSERT INTO users(id,username,steam_id,is_admin) VALUES (?,?,?,?)").run(u.id,u.username,u.steam_id,u.is_admin);
  const wallet=express();wallet.use(express.json());
  wallet.use("/api/website/admin-wallet",require("../automation-platform/src/routes/websiteAdminWalletRoutes"));
  wallet.use("/api/website/title-evidence",require("../automation-platform/src/routes/websiteTitleEvidenceRoutes"));
  process.env.AUTOMATION_SERVICE_URL=await serve(wallet,t);
  const site=express();site.use(express.json());
  site.use((req,_res,next)=>{req.user=accounts.find(u=>u.username===req.get("fixture-account"));next();});
  site.use("/member",require("../server/routes/membershipRewards"));
  site.use("/recognition",require("../server/routes/membershipRecognition"));
  site.use("/growth",require("../server/routes/membershipGrowth"));
  site.use("/community",require("../server/routes/subscriberCommunity"));
  site.use("/arcade",require("../server/routes/valleyArcade"));
  const url=await serve(site,t);
  async function call(path,body,admin=false){
    return fetch(url+path,{method:body?"POST":"GET",headers:{"Content-Type":"application/json",origin:url,
      "fixture-account":accounts[admin?1:0].username},...(body?{body:JSON.stringify(body)}:{})});
  }
  const book=await (await call("/member/rewards/collection")).json();
  assert.equal(book.passport.lifetime,0);
  const milestone={months:18,slug:"fixture-accent",name:"Fixture accent",kind:"accent",colour:"#336655"};
  assert.equal((await call("/member/rewards/admin/milestones",milestone,true)).status,200);
  assert.equal((await call("/member/rewards/collection/preferences",{accent:milestone.slug,wall_opt_in:false,beta_opt_in:false})).status,403);
  assert.deepEqual(book.achievementIds,[]);
  const preferences={wall_opt_in:true,beta_opt_in:false,display_alias:"Marsh"};
  assert.equal((await call("/member/rewards/collection/preferences",{...preferences,featured_skin:"unearned"})).status,403);
  assert.equal((await call("/member/rewards/collection/preferences",preferences)).status,200);
  const daily=await (await call("/member/rewards/daily")).json();
  assert.equal(daily.amount,500);
  const claimed=await (await call("/member/rewards/daily",{day:daily.day})).json();
  assert.equal(claimed.eligible,false);
  const diagnostics=await(await call("/member/rewards/daily/admin/501",null,true)).json();
  assert.equal(diagnostics.claims.length,1);
  assert.equal((await call("/member/rewards/daily/admin/501")).status,403);
  const card={alias:"Marsh",dinosaur:"Triceratops",optIn:true,screenshot:"https://i.imgur.com/abc123.png"};
  assert.equal((await call("/recognition/showcase",card)).status,200);
  assert.deepEqual((await(await call("/recognition/wall")).json()).entries,[]);
  const [review]=await(await call("/recognition/review",null,true)).json();
  assert.equal((await call("/recognition/review",{...review,userId:review.user_id},true)).status,200);
  const wall=await(await call("/recognition/wall")).json();
  assert.deepEqual(Object.keys(wall.entries[0]).sort(),["alias","dinosaur","screenshot","skin"]);
  assert.equal((await call("/recognition/showcase",{optIn:false})).status,200);
  assert.equal((await(await call("/recognition/wall")).json()).entries.length,0);
  const grant={grantKey:"staging-pass",userId:501,tier:"supporter",startsAt:Date.now()-1000,expiresAt:Date.now()+600000};
  assert.equal((await call("/growth/admin/passes",grant,true)).status,200);
  assert.equal((await(await call("/growth/pass")).json()).pass.tier,"supporter");
  assert.equal((await call("/growth/digest/preferences",{enabled:true})).status,200);
  const digest=await(await call("/growth/digest/deliver",{})).json();
  assert.equal(digest.paidMonths,0);
  assert.deepEqual(await(await call("/growth/digest/deliver",{})).json(),digest);
  const community=require("../server/services/subscriberCommunity");
  const ballots=require("../server/services/membershipSkinVote");
  community.schema();ballots.ensureSchema();
  const suggestion=db.prepare("INSERT INTO subscriber_suggestions(user_id,text,created_at) VALUES (501,'Marsh weekend',?)").run(Date.now()).lastInsertRowid;
  const ballot=db.prepare("INSERT INTO membership_skin_vote_ballots(title,status,opens_at,closes_at,kind) VALUES ('Weekend','open',0,?,'public-weekend-theme')").run(Date.now()+86400000).lastInsertRowid;
  const option=Number(db.prepare("INSERT INTO membership_skin_vote_options(ballot_id,label,sort_order) VALUES (?,'Marsh',0)").run(ballot).lastInsertRowid);
  const route="/community/admin/suggestions/"+suggestion+"/review";
  assert.equal((await call(route,{stage:"shortlisted"},true)).status,200);
  assert.equal((await call(route,{stage:"voting",optionId:option},true)).status,200);
  db.prepare("INSERT INTO membership_skin_votes(ballot_id,user_id,option_id) VALUES (?,501,?)").run(ballot,option);
  db.prepare("UPDATE membership_skin_vote_ballots SET status='closed' WHERE id=?").run(ballot);
  for(const stage of ["selected","planned","released"]) assert.equal((await call(route,{stage,theme:"marsh-exploration",skinId:"marsh-skin"},true)).status,200);
  assert.equal((await(await call("/member/rewards/collection")).json()).collectibles.some(i=>i.slug==="community-choice" && i.earned_at),true);
  assert.deepEqual((await(await call("/community/public")).json()).skins,[]);
  assert.equal((await call("/community/suggestions/"+suggestion+"/credit",{optIn:true})).status,200);
  assert.equal((await(await call("/community/public")).json()).skins[0].credit,"Designed with the Community");
  assert.equal((await call("/arcade/settings")).status,403);
  assert.equal((await call("/arcade/settings",{enabled:true,emergency:false,cap:250000},true)).status,200);
  const round=await(await call("/arcade/start",{game:"trivia"})).json();
  assert.ok(round.id);assert.equal(round.solution,undefined);
  const answer=await(await call("/arcade/answer",{id:round.id,choice:round.choices[0]})).json();
  assert.ok([0,500].includes(answer.payout));
  assert.equal((await(await call("/arcade/answer",{id:round.id,choice:round.choices[0]})).json()).duplicate,true);
  assert.equal((await call("/arcade/settings",{enabled:true,emergency:true,cap:250000},true)).status,200);
  assert.equal((await call("/arcade/start",{game:"trivia"})).status,409);
});

test('Arcade launch staging crosses the real authenticated HTTP boundary and unlocks custom skins',async t=>{
  process.env.VALLEY_ARCADE_REWARDS_ENABLED='1';t.after(()=>delete process.env.VALLEY_ARCADE_REWARDS_ENABLED);
  const store=require('../automation-platform/src/services/economyStore');
  const rewards=require('../automation-platform/src/services/arcadeRewards');
  const skins=require('../automation-platform/src/services/skinPresetService');
  const launch=require('../scripts/configure-arcade-launch.cjs');
  launch.applyLaunchConfig();
  require('../automation-platform/src/services/valleyArcade').configure('staging',{enabled:true,emergency:false,cap:250000});
  const wallet=express();wallet.use(express.json());wallet.use('/api/website/admin-wallet',require('../automation-platform/src/routes/websiteAdminWalletRoutes'));
  process.env.AUTOMATION_SERVICE_URL=await serve(wallet,t);
  const site=express();site.use(express.json());site.use((req,res,next)=>{req.user=accounts[req.get('fixture-admin')==='1'?1:0];next();});
  site.use('/api/arcade',require('../server/routes/arcadeRewards'));
  const url=await serve(site,t);
  async function call(path,body,admin=false){const response=await fetch(url+'/api/arcade'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:url,'fixture-admin':admin?'1':'0'},body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()};}
  assert.equal((await call('/admin')).status,403);
  assert.equal((await call('/daily',{})).status,200);assert.equal((await call('/daily',{})).value.duplicate,true);
  const all=Object.values(launch.desired.crates).flat();
  const selected=[...new Map(all.filter(r=>r.type!=='coins').map(r=>[r.presetId||r.id,r])).values()];
  for(const reward of selected){
    // Deterministic fixture tables exercise each fulfillment path, never production RNG.
    const c=rewards.config();c.crates.event=[{...reward,weight:1}];
    assert.equal((await call('/admin/configure',{config:c,expectedVersion:c.version},true)).status,200);
    const grant=await call('/admin/grant',{steamId:accounts[0].steam_id,requestKey:'launch-'+reward.id,kind:'crate',family:'event',amount:2,source:'event'},true);
    assert.equal(grant.status,200);
    for(const crateId of grant.value.crateIds){
      const request={crateId,requestKey:'opening-'+crateId};
      assert.equal((await call('/open',request)).status,200);assert.equal((await call('/open',request)).value.duplicate,true);
    }
    if(reward.type==='skin')assert.ok(skins.listAvailablePresets(accounts[0].steam_id).some(s=>s.id===reward.presetId));
  }
  assert.equal(skins.listStore().some(s=>s.id.startsWith('arcade-')),false);
  const state=(await call('')).value;assert.ok(state.entitlements.length>=8);
  assert.ok(state.history.some(h=>h.reward.convertedFrom));
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM economy_wallet_ledger WHERE kind='arcade_crate' AND amount<0").get().n,0);
  const c=rewards.config();rewards.configure('staging-restore',launch.desired,c.version);
  require('../automation-platform/src/services/valleyArcade').configure('staging',{enabled:true,emergency:true,cap:250000});
  assert.equal((await call('/daily',{})).value.duplicate,true); // committed receipt is readable during pause
  assert.equal((await call('/craft',{family:'valley',requestKey:'paused-craft'})).status,409);
});

test('automatic Arcade DinoStorage delivery passes in an isolated disposable database', async()=>{
  const {execFile}=require('node:child_process');
  const run=require('node:util').promisify(execFile);
  await run(process.execPath,['--test',require('node:path').resolve(__dirname,'../automation-platform/test/arcadeDinoDelivery.test.js')],{timeout:25000});
});
