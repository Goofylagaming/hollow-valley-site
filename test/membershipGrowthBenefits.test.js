"use strict";

process.env.DB_PATH = ":memory:";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {db}=require("../server/db");
const rewards=require("../server/services/membershipRewards");
const {migrateGrowth}=require("../server/services/membershipGrowth");
const benefits=require("../server/services/membershipGrowthBenefits");
const user={id:301,username:"synthetic-player",steam_id:"76561198000000301"};
const admin={id:302,username:"synthetic-admin",steam_id:"76561198000000302"};
const env={MEMBERSHIP_REWARDS_ENABLED:"1",MEMBERSHIP_GROWTH_ENABLED:"1"};
rewards.ensureSchema();
migrateGrowth(db);
for(const u of [user,admin]) db.prepare("INSERT INTO users(id,username,steam_id) VALUES (?,?,?)").run(u.id,u.username,u.steam_id);

test("a temporary pass expires independently and never increases paid history",()=>{
  db.prepare("INSERT INTO membership_passes VALUES ('fixture-pass',?,'guardian',100,200,?)").run(user.id,admin.id);
  assert.equal(benefits.activePass(user.id,100).tier,"guardian");
  assert.equal(benefits.activePass(user.id,200),null);
  assert.equal(rewards.paidMonths(user.id),0);
});

test("cosmetic token is reserved across ambiguous retries, released on refusal and redeemed once",async()=>{
  db.prepare("INSERT INTO membership_bonus_claim_tokens(grant_key,user_id,granted_by,reason,granted_at) VALUES ('fixture-token',?,?,'fixture',1)").run(user.id,admin.id);
  const balance=()=>db.prepare("SELECT redeemed_at FROM membership_bonus_claim_tokens WHERE grant_key='fixture-token'").get().redeemed_at;
  const client={listCatalog:async()=>({enabled:true,skins:[{id:"skin"}]}),fulfillClaim:async()=>{throw Error("unknown outcome");}};
  await assert.rejects(rewards.claimSkin(user,"skin",{client,env}),{code:"SKIN_CHOICE_PENDING"});
  assert.ok(balance());
  client.fulfillClaim=async()=>{throw Object.assign(Error("rejected"),{status:403});};
  await assert.rejects(rewards.claimSkin(user,"skin",{client,env}),{code:"SKIN_NOT_AVAILABLE"});
  assert.equal(balance(),null);
  client.fulfillClaim=async request=>({...request,presetId:"fixture-preset",alreadyOwned:false});
  await rewards.claimSkin(user,"skin",{client,env});
  assert.ok(balance());
  assert.equal((await rewards.claimSkin(user,"skin",{client,env})).duplicate,true);
});

test("referrals reject self attribution and wait for a completed paid period",()=>{
  assert.equal(benefits.recordReferral(user.id,user.id,100),false);
  assert.equal(benefits.recordReferral(user.id,admin.id,100),true);
  assert.equal(benefits.qualifyReferral(user.id,admin.id,200),false);
});
