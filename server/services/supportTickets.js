"use strict";
// Private Hollow Valley website support tickets. Never performs gameplay,
// RCON, wallet, restoration or membership writes.
const { randomUUID } = require("node:crypto");
const { db } = require("../db");

const CATEGORIES=Object.freeze([
  "technical","dinostorage","valley-coins","membership","account","rules","other",
]);
const STATUSES=Object.freeze([
  "open","awaiting-staff","awaiting-player","resolved","closed",
]);
const EVIDENCE_HOSTS=new Set([
  "cdn.discordapp.com","media.discordapp.net","discord.com",
  "steamcommunity.com","youtube.com","www.youtube.com","youtu.be",
  "medal.tv","www.medal.tv","streamable.com","www.streamable.com",
  "clips.twitch.tv","twitch.tv","www.twitch.tv",
  "drive.google.com","i.imgur.com","imgur.com","www.imgur.com",
]);
const PUBLIC_STATES=new Set(["open","awaiting-staff","awaiting-player","resolved","closed"]);

db.exec([
  "CREATE TABLE IF NOT EXISTS hv_support_tickets (",
  " id TEXT PRIMARY KEY,",
  " reporter_id INTEGER NOT NULL REFERENCES users(id),",
  " reporter_steam_id TEXT NOT NULL,",
  " category TEXT NOT NULL,",
  " subject TEXT NOT NULL,",
  " status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','awaiting-staff','awaiting-player','resolved','closed')),",
  " client_nonce TEXT UNIQUE,",
  " created_at TEXT NOT NULL,",
  " updated_at TEXT NOT NULL,",
  " last_staff_steam_id TEXT",
  ");",
  "CREATE INDEX IF NOT EXISTS hv_support_reporter_idx ON hv_support_tickets (reporter_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS hv_support_status_idx ON hv_support_tickets (status, updated_at DESC);",
  "CREATE TABLE IF NOT EXISTS hv_support_messages (",
  " id TEXT PRIMARY KEY,",
  " ticket_id TEXT NOT NULL REFERENCES hv_support_tickets(id),",
  " author_role TEXT NOT NULL CHECK(author_role IN ('player','staff')),",
  " author_steam_id TEXT NOT NULL,",
  " body TEXT NOT NULL,",
  " evidence_json TEXT NOT NULL DEFAULT '[]',",
  " internal INTEGER NOT NULL DEFAULT 0 CHECK(internal IN (0,1)),",
  " created_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS hv_support_messages_ticket_idx ON hv_support_messages (ticket_id, created_at, id);",
  "CREATE TABLE IF NOT EXISTS hv_support_audit (",
  " id INTEGER PRIMARY KEY AUTOINCREMENT,",
  " ticket_id TEXT NOT NULL REFERENCES hv_support_tickets(id),",
  " action TEXT NOT NULL,",
  " actor_steam_id TEXT NOT NULL,",
  " details_json TEXT NOT NULL DEFAULT '{}',",
  " created_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS hv_support_audit_ticket_idx ON hv_support_audit (ticket_id, id);",
].join("\n"));

function error(code,message) {
  const e=new Error(message); e.code=code; return e;
}
function isSteamId(value) {return typeof value==="string" && /^\d{17}$/.test(value);}
function identity(user,adminRequired=false) {
  if(!user || !Number.isSafeInteger(user.id) || user.id<=0 || !isSteamId(user.steam_id)) {
    throw error("STEAM_REQUIRED","A Steam-linked website account is required.");
  }
  if(adminRequired && !user.is_admin)throw error("ADMIN_REQUIRED","A website administrator is required.");
  return { userId:user.id,steamId:user.steam_id,admin:Boolean(user.is_admin) };
}
function cleanText(value,max,{multiline=false}={}) {
  if(typeof value!=="string")return "";
  const text=value.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g," ").trim();
  return text.slice(0,max+1);
}
function parseEvidence(value) {
  if(value===undefined || value===null)return [];
  if(!Array.isArray(value) || value.length>3)throw error("INVALID_EVIDENCE","Provide no more than three evidence links.");
  const links=value.map(candidate=>{
    const raw=cleanText(candidate,400);
    if(!raw || raw.length>400)throw error("INVALID_EVIDENCE","Evidence links must be 1–400 characters.");
    let parsed;
    try {parsed=new URL(raw);} catch {throw error("INVALID_EVIDENCE","Evidence links must be HTTPS URLs.");}
    if(parsed.protocol!=="https:" || parsed.username || parsed.password || parsed.port ||
       !EVIDENCE_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw error("INVALID_EVIDENCE","Only approved HTTPS media links are permitted.");
    }
    return parsed.toString();
  });
  if(new Set(links).size!==links.length)throw error("INVALID_EVIDENCE","Remove duplicate links.");
  return links;
}
function validNonce(value) {
  if(value===undefined || value===null || value==="")return null;
  const nonce=String(value);
  if(!/^[a-f0-9-]{36}$/i.test(nonce))throw error("INVALID_TICKET","Invalid ticket request key.");
  return nonce.toLowerCase();
}
function validateNew(input) {
  if(!input || typeof input!=="object" || Array.isArray(input))throw error("INVALID_TICKET","Invalid support request.");
  const category=String(input.category||"");
  const subject=cleanText(input.subject,110);
  const body=cleanText(input.body,3500,{multiline:true});
  if(!CATEGORIES.includes(category) || subject.length<8 || subject.length>110 ||
     body.length<30 || body.length>3500) {
    throw error("INVALID_TICKET","Choose a category, subject (8–110 characters) and details (30–3,500 characters).");
  }
  return {category,subject,body,evidence:parseEvidence(input.evidenceUrls),
    clientNonce:validNonce(input.clientNonce)};
}
function validateReply(input) {
  if(!input || typeof input!=="object" || Array.isArray(input))throw error("INVALID_REPLY","Enter your message.");
  const body=cleanText(input.body,3500,{multiline:true});
  if(body.length<2 || body.length>3500)throw error("INVALID_REPLY","Message must be 2–3,500 characters.");
  return {body,evidence:parseEvidence(input.evidenceUrls),internal:input.internal===true};
}
function getTicket(id) {
  if(!/^[0-9a-f-]{36}$/i.test(String(id||"")))return null;
  return db.prepare("SELECT * FROM hv_support_tickets WHERE id=?").get(String(id).toLowerCase())||null;
}
function publicTicket(row,admin=false) {
  const value={
    id:row.id,category:row.category,subject:row.subject,status:row.status,
    createdAt:row.created_at,updatedAt:row.updated_at,
  };
  if(admin) {
    value.reporterSteamId=row.reporter_steam_id;
    value.reporterName=row.reporter_name||"Unknown player";
    value.lastStaffSteamId=row.last_staff_steam_id;
  }
  return value;
}
function publicMessage(row,admin=false) {
  let evidence=[];
  try {const a=JSON.parse(row.evidence_json||"[]");if(Array.isArray(a))evidence=a;}catch {}
  const value={
    id:row.id,authorRole:row.author_role,body:row.body,evidenceUrls:evidence,
    createdAt:row.created_at,
  };
  if(admin){value.internal=row.internal===1;value.authorSteamId=row.author_steam_id;}
  return value;
}
function accessible(ticket,user) {
  const actor=identity(user);
  if(actor.admin || ticket.reporter_id===actor.userId && ticket.reporter_steam_id===actor.steamId) return actor;
  throw error("NOT_FOUND","Support ticket not found.");
}
function view(id,user) {
  const ticket=getTicket(id);
  if(!ticket)throw error("NOT_FOUND","Support ticket not found.");
  const actor=accessible(ticket,user);
  const admin=actor.admin;
  const row=admin ? db.prepare(
    "SELECT t.*,u.username AS reporter_name FROM hv_support_tickets t LEFT JOIN users u ON u.id=t.reporter_id WHERE t.id=?"
  ).get(ticket.id):ticket;
  const messages=db.prepare(
    "SELECT * FROM hv_support_messages WHERE ticket_id=?"+(admin?"":" AND internal=0")+" ORDER BY created_at ASC,id ASC LIMIT 200"
  ).all(ticket.id).map(item=>publicMessage(item,admin));
  const output={ticket:publicTicket(row,admin),messages};
  if(admin) output.audit=db.prepare(
    "SELECT action,actor_steam_id AS actorSteamId,details_json AS details,created_at AS createdAt FROM hv_support_audit WHERE ticket_id=? ORDER BY id DESC LIMIT 50"
  ).all(ticket.id).map(row=>({...row,details:JSON.parse(row.details)}));
  return output;
}
function audit(ticketId,action,actor,details,at) {
  db.prepare("INSERT INTO hv_support_audit (ticket_id,action,actor_steam_id,details_json,created_at) VALUES (?,?,?,?,?)")
    .run(ticketId,action,actor,JSON.stringify(details||{}),at);
}
function create(user,input) {
  const actor=identity(user), data=validateNew(input);
  if(process.env.HV_SUPPORT_TICKETS_ENABLED!=="true") {
    throw error("TICKETS_DISABLED","New website support tickets are not enabled yet. Contact staff on Discord.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if(data.clientNonce) {
      const existing=db.prepare("SELECT * FROM hv_support_tickets WHERE client_nonce=?").get(data.clientNonce);
      if(existing) {
        if(existing.reporter_steam_id!==actor.steamId || existing.reporter_id!==actor.userId) {
          throw error("INVALID_TICKET","Request key has already been used.");
        }
        db.exec("COMMIT");
        return {ticket:publicTicket(existing),duplicate:true};
      }
    }
    const recent=db.prepare("SELECT COUNT(*) AS n FROM hv_support_tickets WHERE reporter_steam_id=? AND created_at >= ?")
      .get(actor.steamId,new Date(Date.now()-86400000).toISOString()).n;
    const last=db.prepare("SELECT created_at FROM hv_support_tickets WHERE reporter_steam_id=? ORDER BY created_at DESC LIMIT 1")
      .get(actor.steamId);
    if(recent>=3 || last && Date.now()-Date.parse(last.created_at)<90000)
      throw error("TICKET_LIMIT","You can open three tickets per day, at least 90 seconds apart.");
    const at=new Date().toISOString(), id=randomUUID();
    db.prepare("INSERT INTO hv_support_tickets (id,reporter_id,reporter_steam_id,category,subject,status,client_nonce,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?,?)")
      .run(id,actor.userId,actor.steamId,data.category,data.subject,data.clientNonce,at,at);
    db.prepare("INSERT INTO hv_support_messages (id,ticket_id,author_role,author_steam_id,body,evidence_json,internal,created_at) VALUES (?,?,'player',?,?,?,0,?)")
      .run(randomUUID(),id,actor.steamId,data.body,JSON.stringify(data.evidence),at);
    audit(id,"ticket_opened",actor.steamId,{category:data.category},at);
    const ticket=getTicket(id);
    db.exec("COMMIT");
    return {ticket:publicTicket(ticket),duplicate:false};
  }catch(e){db.exec("ROLLBACK");throw e;}
}
function mine(user) {
  const actor=identity(user);
  return db.prepare("SELECT * FROM hv_support_tickets WHERE reporter_id=? AND reporter_steam_id=? ORDER BY updated_at DESC,id DESC LIMIT 80")
    .all(actor.userId,actor.steamId).map(item=>publicTicket(item));
}
function adminQueue(user,{status="",q="",limit=80}={}) {
  identity(user,true);
  const safeStatus=STATUSES.includes(status)?status:"";
  const needle=cleanText(q,100).toLowerCase();
  const cap=Number.isSafeInteger(Number(limit))?Math.max(1,Math.min(100,Number(limit))):80;
  const parts=[],args=[];
  if(safeStatus){parts.push("t.status=?");args.push(safeStatus);}
  if(needle){
    parts.push("instr(lower(t.subject || ' ' || t.category || ' ' || t.reporter_steam_id || ' ' || coalesce(u.username,'') || ' ' || t.id),?)>0");
    args.push(needle);
  }
  const where=parts.length?" WHERE "+parts.join(" AND "):"";
  return db.prepare(
    "SELECT t.*,u.username AS reporter_name FROM hv_support_tickets t LEFT JOIN users u ON u.id=t.reporter_id"+where+
    " ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'awaiting-staff' THEN 1 WHEN 'awaiting-player' THEN 2 ELSE 3 END,t.updated_at DESC LIMIT ?"
  ).all(...args,cap).map(item=>publicTicket(item,true));
}
function reply(user,id,input) {
  const ticket=getTicket(id);
  if(!ticket)throw error("NOT_FOUND","Support ticket not found.");
  const actor=accessible(ticket,user);
  const data=validateReply(input);
  if(data.internal && !actor.admin)throw error("ADMIN_REQUIRED","Only staff can leave internal notes.");
  if(ticket.status==="closed")throw error("TICKET_CLOSED","This ticket is closed. Open a new ticket for additional help.");
  if(!actor.admin && process.env.HV_SUPPORT_TICKETS_ENABLED!=="true")
    throw error("TICKETS_DISABLED","Ticket replies are temporarily unavailable. Contact staff on Discord.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const at=new Date().toISOString();
    const fromStaff=actor.admin;
    const nextStatus=data.internal?ticket.status:fromStaff?"awaiting-player":"awaiting-staff";
    db.prepare("INSERT INTO hv_support_messages (id,ticket_id,author_role,author_steam_id,body,evidence_json,internal,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(),ticket.id,fromStaff?"staff":"player",actor.steamId,data.body,JSON.stringify(data.evidence),data.internal?1:0,at);
    db.prepare("UPDATE hv_support_tickets SET status=?,updated_at=?,last_staff_steam_id=COALESCE(?,last_staff_steam_id) WHERE id=?")
      .run(nextStatus,at,fromStaff?actor.steamId:null,ticket.id);
    audit(ticket.id,data.internal?"staff_internal_note":"ticket_reply",actor.steamId,
      {fromStatus:ticket.status,toStatus:nextStatus,internal:data.internal},at);
    db.exec("COMMIT");
    return view(ticket.id,user);
  }catch(e){db.exec("ROLLBACK");throw e;}
}
function setStatus(user,id,status) {
  const actor=identity(user,true);
  if(!STATUSES.includes(status))throw error("INVALID_STATUS","Choose a valid ticket status.");
  const ticket=getTicket(id);
  if(!ticket)throw error("NOT_FOUND","Support ticket not found.");
  if(ticket.status===status)return {changed:false,...view(ticket.id,user)};
  const at=new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE hv_support_tickets SET status=?,updated_at=?,last_staff_steam_id=? WHERE id=?")
      .run(status,at,actor.steamId,ticket.id);
    audit(ticket.id,"status_changed",actor.steamId,{from:ticket.status,to:status},at);
    db.exec("COMMIT");
    return {changed:true,...view(ticket.id,user)};
  }catch(e){db.exec("ROLLBACK");throw e;}
}
module.exports={
  CATEGORIES,STATUSES,parseEvidence,validateNew,publicTicket,create,mine,adminQueue,view,reply,setStatus,
};
