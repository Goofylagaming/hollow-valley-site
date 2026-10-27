"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const express=require("express");
const {randomUUID}=require("node:crypto");
const workdir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-support-test-"));
process.env.DB_PATH=path.join(workdir,"support.sqlite");
process.env.HV_SUPPORT_TICKETS_ENABLED="true";
delete process.env.PUBLIC_SITE_URL;
const {db}=require("../server/db");
const support=require("../server/services/supportTickets");
const router=require("../server/routes/supportTickets");
const users=[
  {id:1,steam_id:"76561198000000001",username:"Reporter",is_admin:0},
  {id:2,steam_id:"76561198000000002",username:"Other Player",is_admin:0},
  {id:3,steam_id:"76561198000000003",username:"Website Admin",is_admin:1},
];
for(const u of users)db.prepare("INSERT INTO users (id,steam_id,username,is_admin) VALUES (?,?,?,?)")
  .run(u.id,u.steam_id,u.username,u.is_admin);
test.after(()=>{
  db.close();fs.rmSync(workdir,{recursive:true,force:true});
});
function example(){
  return {
    category:"dinostorage",subject:"My dinosaur will not redeem",
    body:"When I pressed Redeem, the dinosaur did not appear. I need a moderator to check the request outcome before trying again.",
    evidenceUrls:["https://cdn.discordapp.com/attachments/123/456/a.png"],
    clientNonce:randomUUID(),
    reporterSteamId:users[1].steam_id,
  };
}
function app(){
  const server=express();server.use(express.json());
  server.use((req,_res,next)=>{
    const role=req.get("X-Test-Role");
    req.user=role==="admin"?users[2]:role==="player"?users[0]:role==="other"?users[1]:null;
    next();
  });server.use("/api/support-tickets",router);return server;
}
async function withServer(task) {
  const server=app().listen(0,"127.0.0.1");
  await new Promise(done=>server.once("listening",done));
  const base="http://127.0.0.1:"+server.address().port;
  try{return await task(base);}
  finally{await new Promise(done=>server.close(done));}
}
function post(base,route,body,{role="player",origin=base,method="POST"}={}) {
  return fetch(base+route,{
    method,headers:{"Content-Type":"application/json",...(role?{"X-Test-Role":role}:{}),
      ...(origin?{Origin:origin}:{})},
    body:JSON.stringify(body),
  });
}
test("ticket validation rejects unsafe links, invalid metadata and spoofing attempts",()=>{
  assert.throws(()=>support.validateNew({...example(),subject:"short"}),{code:"INVALID_TICKET"});
  assert.throws(()=>support.validateNew({...example(),body:"short"}),{code:"INVALID_TICKET"});
  assert.throws(()=>support.validateNew({...example(),category:"wallet-hack"}),{code:"INVALID_TICKET"});
  assert.throws(()=>support.validateNew({...example(),evidenceUrls:["http://evil.example/"]}),{code:"INVALID_EVIDENCE"});
  assert.throws(()=>support.parseEvidence(["https://cdn.discordapp.com.evil.example/a"]),{code:"INVALID_EVIDENCE"});
  assert.throws(()=>support.parseEvidence(["https://user:secret@cdn.discordapp.com/a"]),{code:"INVALID_EVIDENCE"});
  assert.throws(()=>support.parseEvidence(Array(4).fill("https://youtu.be/abc")),{code:"INVALID_EVIDENCE"});
  assert.throws(()=>support.parseEvidence(["https://youtu.be/abc","https://youtu.be/abc"]),{code:"INVALID_EVIDENCE"});
  assert.equal(support.parseEvidence(["https://youtu.be/abc"]).length,1);
});

test("guest/other users cannot open tickets, view queue or bypass same-origin CSRF",async()=>{
  await withServer(async base=>{
    assert.equal((await post(base,"/api/support-tickets",example(),{role:null})).status,401);
    assert.equal((await post(base,"/api/support-tickets",example(),{role:"player",origin:"https://attacker.example"})).status,403);
    assert.equal((await post(base,"/api/support-tickets",example(),{role:"player",origin:null})).status,403);
    assert.equal((await fetch(base+"/api/support-tickets/admin")).status,401);
    assert.equal((await fetch(base+"/api/support-tickets/admin",{headers:{"X-Test-Role":"player"}})).status,403);
    assert.equal((await fetch(base+"/api/support-tickets/mine")).status,401);
    const capabilities=await fetch(base+"/api/support-tickets/capabilities");
    assert.equal(capabilities.status,200);
    assert.equal((await capabilities.json()).enabled,true);
  });
});

let ticketId;
test("ticket submission uses session identity, private owner scope, nonce idempotency and daily limits",async()=>{
  await withServer(async base=>{
    const input=example();
    const created=await post(base,"/api/support-tickets",input);
    assert.equal(created.status,201);
    assert.match(created.headers.get("cache-control"),/no-store/);
    const out=await created.json();
    ticketId=out.ticket.id;
    assert.equal(out.ticket.status,"open");
    assert.equal(out.ticket.reporterSteamId,undefined);
    assert.equal(db.prepare("SELECT reporter_steam_id FROM hv_support_tickets WHERE id=?").get(ticketId).reporter_steam_id,users[0].steam_id);
    assert.equal((await post(base,"/api/support-tickets",input)).status,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hv_support_tickets").get().n,1);
    const differentNonce=await post(base,"/api/support-tickets",example());
    assert.equal(differentNonce.status,429);
    assert.equal((await differentNonce.json()).code,"TICKET_LIMIT");
    const mine=await fetch(base+"/api/support-tickets/mine",{headers:{"X-Test-Role":"player"}});
    assert.equal((await mine.json()).tickets.length,1);
    const other=await fetch(base+"/api/support-tickets/mine",{headers:{"X-Test-Role":"other"}});
    assert.deepEqual((await other.json()).tickets,[]);
    assert.equal((await fetch(base+"/api/support-tickets/mine/"+ticketId,{headers:{"X-Test-Role":"other"}})).status,404);
  });
});

test("player responses, admin response and private staff notes have strictly separated visibility",async()=>{
  await withServer(async base=>{
    const route="/api/support-tickets/mine/"+ticketId;
    const unauthorizedNote=await post(base,route+"/replies",{body:"I am pretending to be staff",internal:true});
    assert.equal(unauthorizedNote.status,403);
    const playerReply=await post(base,route+"/replies",{body:"I retried but the pending status is unchanged."});
    assert.equal(playerReply.status,200);
    const data=await playerReply.json();
    assert.equal(data.ticket.status,"awaiting-staff");
    assert.equal(data.messages.length,2);
    assert.equal(JSON.stringify(data).includes("76561198000000003"),false);
    assert.equal((await post(base,route+"/replies",{body:"Unauthorized"}, {role:"other"})).status,404);
    const staffRoute="/api/support-tickets/admin/"+ticketId;
    const reply=await post(base,staffRoute+"/replies",{body:"Please confirm whether your dinosaur is parked."},{role:"admin"});
    assert.equal(reply.status,200);
    assert.equal((await reply.json()).ticket.status,"awaiting-player");
    const internal=await post(base,staffRoute+"/replies",{body:"Moderator note: investigate the restore snapshot first.",internal:true},{role:"admin"});
    assert.equal(internal.status,200);
    const admin=(await (await fetch(base+staffRoute,{headers:{"X-Test-Role":"admin"}})).json());
    assert.equal(admin.messages.length,4);
    assert.equal(admin.messages[3].internal,true);
    assert.equal(admin.audit.some(e=>e.action==="staff_internal_note"),true);
    const mine=(await (await fetch(base+route,{headers:{"X-Test-Role":"player"}})).json());
    assert.equal(mine.messages.length,3);
    assert.equal(mine.audit,undefined);
    assert.doesNotMatch(JSON.stringify(mine),/restore snapshot|actorSteamId|authorSteamId|lastStaffSteamId/i);
    assert.equal((await fetch(base+staffRoute,{headers:{"X-Test-Role":"other"}})).status,403);
  });
});

test("admin status changes are audit logged and idempotent; closed tickets reject replies",async()=>{
  await withServer(async base=>{
    const endpoint="/api/support-tickets/admin/"+ticketId;
    const response=await post(base,endpoint+"/status",{status:"resolved"},{role:"admin"});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.changed,true);
    assert.equal(result.ticket.status,"resolved");
    assert.equal((await post(base,endpoint+"/status",{status:"resolved"},{role:"admin"})).status,200);
    const prior=db.prepare("SELECT COUNT(*) AS n FROM hv_support_audit WHERE ticket_id=? AND action='status_changed'").get(ticketId).n;
    assert.equal(prior,1);
    assert.equal((await post(base,endpoint+"/status",{status:"closed"},{role:"admin"})).status,200);
    assert.equal((await post(base,"/api/support-tickets/mine/"+ticketId+"/replies",{body:"A further reply"})).status,409);
    assert.equal((await post(base,endpoint+"/replies",{body:"Moderator reply"},{role:"admin"})).status,409);
    const queue=await fetch(base+"/api/support-tickets/admin?q="+users[0].steam_id,
      {headers:{"X-Test-Role":"admin"}});
    const list=(await queue.json()).tickets;
    assert.equal(list.length,1);
    assert.equal(list[0].reporterSteamId,users[0].steam_id);
    const filtered=await fetch(base+"/api/support-tickets/admin?status=open",
      {headers:{"X-Test-Role":"admin"}});
    assert.deepEqual((await filtered.json()).tickets,[]);
  });
});

test("disabling submissions preserves read-only history and admin moderation",async()=>{
  const prev=process.env.HV_SUPPORT_TICKETS_ENABLED;
  process.env.HV_SUPPORT_TICKETS_ENABLED="false";
  try{
    await withServer(async base=>{
      assert.equal((await (await fetch(base+"/api/support-tickets/capabilities")).json()).enabled,false);
      assert.equal((await post(base,"/api/support-tickets",example(),{role:"other"})).status,503);
      const mine=await fetch(base+"/api/support-tickets/mine",{headers:{"X-Test-Role":"player"}});
      assert.equal((await mine.json()).tickets.length,1);
      const admin=await fetch(base+"/api/support-tickets/admin",{headers:{"X-Test-Role":"admin"}});
      assert.equal((await admin.json()).tickets.length,1);
    });
  }finally{process.env.HV_SUPPORT_TICKETS_ENABLED=prev;}
});

test("Support Hub pages, admin guard, navigation and data hooks are present and parse",()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
  const app=read("server/index.js");
  const nav=read("public/partials/nav.html");
  assert.match(app,/app\.use\("\/api\/support-tickets", supportTicketsRouter\)/);
  assert.match(app,/"updates", "support"/);
  assert.match(app,/adminsupport: "adminsupport\.html"/);
  assert.match(nav,/href="\/support"/);
  assert.match(nav,/href="\/adminsupport"/);
  assert.match(nav,/id="admin-nav-group" hidden/);
  const player=read("public/support.html");
  const staff=read("public/adminsupport.html");
  assert.match(player,/hv-support-create/);
  assert.match(player,/hv-support-thread/);
  assert.match(staff,/noindex, nofollow/);
  assert.match(staff,/hv-admin-support-guard/);
  for(const file of ["public/assets/support-hub.js","public/assets/admin-support-hub.js"]){
    const code=read(file);
    assert.doesNotThrow(()=>new Function(code));
    assert.match(code,/textContent/);
    assert.doesNotMatch(code,/\.innerHTML\s*=/);
  }
  const svc=read("server/services/supportTickets.js");
  assert.doesNotMatch(svc,/RCON_PASSWORD|CommandBridge|wallet_transactions|UPDATE wallets|stripe/);
  assert.match(read(".env.example"),/HV_SUPPORT_TICKETS_ENABLED=false/);
});
