const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
const express = require("express");
const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const rewards = require("../server/services/membershipRewards");
const premium = require("../server/services/premiumSkinClient");
const automation = require("../server/services/automationWebsiteClient");
const { TIERS } = require("../server/services/supporterTiers");
const user = { id: 62, username: "route-member", steam_id: "76561198000000620" };
const other = { id: 63, username: "other-member", steam_id: "76561198000000630" };
const actualFetch = global.fetch;

function configure(t, override = {}) {
  const values = {
    MEMBERSHIP_REWARDS_ENABLED: "1", STRIPE_PRICE_SUPPORTER: "price_route_supporter",
    STRIPE_PRICE_GUARDIAN: "price_route_guardian", STRIPE_PRICE_LEGEND: "price_route_legend",
    STRIPE_SECRET_KEY: "", STRIPE_LIVE_ENABLED: "0", SKIN_STUDIO_READ_ONLY: "0",
    PUBLIC_SITE_URL: "https://hollowvalleyisle.com", RENDER_EXTERNAL_URL: "https://hollow-valley-site.onrender.com",
    RENDER_SERVICE_ID: "srv-dajsk9nqj5pc73euebdg", STEAM_REALM: "https://hollowvalleyisle.com",
    STEAM_RETURN_URL: "https://hollowvalleyisle.com/auth/steam/return", NODE_ENV: "test", ...override,
  };
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(values)) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });
}

function reset() {
  rewards.ensureSchema();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'membership_%'").all();
  for (const row of tables) db.exec(`DELETE FROM "${row.name.replaceAll('"', '""')}"`);
  db.exec("DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;");
  for (const item of [user, other]) db.prepare("INSERT INTO users(id,username,steam_id) VALUES (?,?,?)").run(item.id,item.username,item.steam_id);
  const end = new Date(Date.now() + 20 * 86400000).toISOString();
  db.prepare("INSERT INTO supporter_subscriptions (user_id,tier,stripe_subscription_id,stripe_status,auto_renew,renews_at) VALUES (?,'supporter','sub_route_member','active',1,?)").run(user.id,end);
  db.prepare("INSERT INTO supporter_subscriptions (user_id,tier,stripe_subscription_id,stripe_status,auto_renew,renews_at) VALUES (?,'legend','sub_route_other','active',1,?)").run(other.id,end);
  const start = Math.floor((Date.now() - 10 * 86400000) / 1000);
  rewards.recordPaidInvoice({
    id:"in_route_base",livemode:false,status:"paid",amount_paid:700,subscription:"sub_route_member",billing_reason:"subscription_cycle",
    created:start,lines:{data:[{amount:700,subscription:"sub_route_member",proration:false,
      price:{id:"price_route_supporter",recurring:{interval:"month",interval_count:1}},
      period:{start,end:start + 30 * 86400}}]},
  });
}

function mockRemote(t, { fail = false } = {}) {
  const original = { list: premium.listCatalog, fulfill: premium.fulfillClaim, storage: automation.getMembershipStorage };
  const calls = { catalogue:[], fulfillment:[], storage:[] };
  premium.listCatalog = async (steamId) => {
    calls.catalogue.push(steamId);
    if (fail) throw new Error("private upstream details");
    return { enabled:true,skins:[{id:"route-ashfall",owned:false}] };
  };
  premium.fulfillClaim = async (input) => {
    calls.fulfillment.push(input);
    return {...input,presetId:"route-preset",alreadyOwned:false,duplicate:false};
  };
  automation.getMembershipStorage = async (steamId) => {
    calls.storage.push(steamId);
    if (fail) throw new Error("private upstream details");
    return {enabled:true,configured:true,baseSlots:5,bonusSlots:1,limit:6,used:2,withdrawOnly:false};
  };
  t.after(() => { premium.listCatalog=original.list;premium.fulfillClaim=original.fulfill;automation.getMembershipStorage=original.storage; });
  return calls;
}

async function serve(t, fullApp = false) {
  let app;
  if (fullApp) app = require("../server/index").createApp();
  else {
    app = express();app.use(express.json());
    app.use((req,_res,next) => { if (req.get("x-test-auth") === "yes") req.user = user; next(); });
    app.use("/api/supporter",require("../server/routes/membershipRewards"));
    app.use("/api/supporter",require("../server/routes/supporter"));
  }
  const server = await new Promise((resolve,reject) => {
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));listener.once("error",reject);
  });
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base,request:(endpoint,{method="GET",authenticated=true,body,origin}={})=>actualFetch(base+endpoint,{
    method,headers:{"Content-Type":"application/json",...(authenticated?{"x-test-auth":"yes"}:{}),...(origin?{Origin:origin}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  })};
}

test("full app keeps public membership tiers accessible with rewards both disabled and enabled", async (t) => {
  configure(t);reset();
  const { request } = await serve(t,true);
  for (const enabled of ["0","1"]) {
    process.env.MEMBERSHIP_REWARDS_ENABLED=enabled;
    const response=await request("/api/supporter/tiers",{authenticated:false});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).tiers,TIERS);
  }
  const privateResponse=await request("/api/supporter/rewards",{authenticated:false});
  assert.equal(privateResponse.status,401);
});

test("membership rewards mutations and summary require authentication before any upstream call", async (t) => {
  configure(t);reset();const calls=mockRemote(t);const {request}=await serve(t);
  for (const [endpoint,method] of [["/rewards","GET"],["/appearance","POST"],["/rewards/skins/route-ashfall/claim","POST"],["/rewards/sync-history","POST"]]) {
    const response=await request("/api/supporter"+endpoint,{method,authenticated:false,body:method==="POST"?{}:undefined});
    assert.equal(response.status,401,endpoint);
  }
  assert.equal(calls.catalogue.length,0);assert.equal(calls.fulfillment.length,0);
});

test("summary uses the authenticated identity and stays available if remote features are down", async (t) => {
  configure(t);reset();const calls=mockRemote(t,{fail:true});const {request}=await serve(t);
  const response=await request("/api/supporter/rewards?userId=63&steamId=76561198000000630");
  assert.equal(response.status,200);
  assert.match(response.headers.get("cache-control"),/no-store/);
  const body=await response.json();
  assert.equal(body.tier,"supporter");assert.equal(body.monthly.allowance,1);
  assert.equal(body.monthly.catalogueUnavailable,true);assert.equal(body.storage.unavailable,true);
  assert.deepEqual(calls.catalogue,[user.steam_id]);assert.deepEqual(calls.storage,[user.steam_id]);
  assert.equal(JSON.stringify(body).includes("private upstream details"),false);
});

test("cross-origin appearance, history and skin claims are rejected without mutation", async (t) => {
  configure(t);reset();const calls=mockRemote(t);const {request}=await serve(t);
  for (const endpoint of ["/appearance","/rewards/skins/route-ashfall/claim","/rewards/sync-history"]) {
    const response=await request("/api/supporter"+endpoint,{method:"POST",origin:"https://another.example",body:{frameId:"supporter-fern",badgeVisible:true}});
    assert.equal(response.status,403);assert.equal((await response.json()).code,"ORIGIN_MISMATCH");
  }
  assert.equal(calls.fulfillment.length,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM membership_appearance").get().n,0);
});

test("appearance saves only for the signed-in account and rejects unearned frames", async (t) => {
  configure(t);reset();mockRemote(t);const {request,base}=await serve(t);
  const saved=await request("/api/supporter/appearance",{method:"POST",origin:base,body:{frameId:"supporter-fern",badgeVisible:false,userId:other.id,steamId:other.steam_id}});
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).appearance.badgeVisible,false);
  assert.equal(db.prepare("SELECT frame_id FROM membership_appearance WHERE user_id=?").get(user.id).frame_id,"supporter-fern");
  assert.equal(db.prepare("SELECT frame_id FROM membership_appearance WHERE user_id=?").get(other.id),undefined);
  const unearned=await request("/api/supporter/appearance",{method:"POST",body:{frameId:"legend-gold",badgeVisible:true}});
  assert.equal(unearned.status,403);
});

test("a skin claim is delivered to the authenticated Steam identity and repeats idempotently", async (t) => {
  configure(t);reset();const calls=mockRemote(t);const {request,base}=await serve(t);
  const body={userId:other.id,steamId:other.steam_id,claimId:"forged",allowance:999};
  const first=await request("/api/supporter/rewards/skins/route-ashfall/claim",{method:"POST",origin:base,body});
  assert.equal(first.status,200);const claimed=await first.json();
  assert.equal(calls.fulfillment[0].steamId,user.steam_id);
  assert.notEqual(claimed.claimId,"forged");
  const again=await request("/api/supporter/rewards/skins/route-ashfall/claim",{method:"POST",body});
  assert.equal(again.status,200);assert.equal((await again.json()).claimId,claimed.claimId);
  assert.equal(calls.fulfillment.length,1);
});

test("read-only staging prevents premium skin claims while website appearance remains editable", async (t) => {
  configure(t,{RENDER_SERVICE_ID:"srv_test_membership",RENDER_EXTERNAL_URL:"https://hollow-valley-site-test.onrender.com"});reset();
  const calls=mockRemote(t);const {request}=await serve(t);
  const blocked=await request("/api/supporter/rewards/skins/route-ashfall/claim",{method:"POST",body:{}});
  assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,"SKIN_STUDIO_READ_ONLY");
  assert.equal(calls.catalogue.length,0);assert.equal(calls.fulfillment.length,0);
  const allowed=await request("/api/supporter/appearance",{method:"POST",body:{frameId:"supporter-fern",badgeVisible:true}});
  assert.equal(allowed.status,200);
});

test("disabled rewards return a preparation state and reject new appearance and skin writes", async (t) => {
  configure(t);reset();const calls=mockRemote(t);const {request}=await serve(t);
  process.env.MEMBERSHIP_REWARDS_ENABLED="0";
  const response=await request("/api/supporter/rewards");
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{enabled:false});
  for (const endpoint of ["/appearance","/rewards/skins/route-ashfall/claim","/rewards/sync-history"]) {
    const result=await request("/api/supporter"+endpoint,{method:"POST",body:{frameId:"none",badgeVisible:true}});
    assert.equal(result.status,503);assert.equal((await result.json()).code,"REWARDS_DISABLED");
  }
  assert.equal(calls.catalogue.length,0);assert.equal(calls.fulfillment.length,0);
});
