"use strict";
// Opt-in public group recruitment, built on existing website-only Groups.
// Interest requests NEVER join a group or trigger a game / territory command.
const {db}=require("../db");
const groups=require("../groupsStore");
const STYLES=Object.freeze(["casual","survival","nesting","events","exploration"]);
const FOCUS=Object.freeze(["any","herbivores","carnivores","omnivores","mixed"]);
const CAPACITY=groups.CAPACITY;

db.exec([
  "CREATE TABLE IF NOT EXISTS hv_group_recruitment (",
  " group_id INTEGER PRIMARY KEY REFERENCES hv_groups(id),",
  " active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),",
  " style TEXT NOT NULL DEFAULT 'casual',",
  " focus TEXT NOT NULL DEFAULT 'any',",
  " description TEXT NOT NULL DEFAULT '',",
  " updated_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS hv_group_interest (",
  " id INTEGER PRIMARY KEY AUTOINCREMENT,",
  " group_id INTEGER NOT NULL REFERENCES hv_groups(id),",
  " applicant_steam_id TEXT NOT NULL,",
  " message TEXT NOT NULL,",
  " status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','declined','cancelled')),",
  " created_at TEXT NOT NULL,",
  " updated_at TEXT NOT NULL",
  ");",
  "CREATE UNIQUE INDEX IF NOT EXISTS hv_group_interest_pending_unique ON hv_group_interest(group_id,applicant_steam_id) WHERE status='pending';",
  "CREATE INDEX IF NOT EXISTS hv_group_interest_sender_idx ON hv_group_interest(applicant_steam_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS hv_group_interest_group_idx ON hv_group_interest(group_id, status, created_at DESC);",
].join("\n"));

function error(code,message){const e=new Error(message);e.code=code;return e;}
function steamId(value) {
  if(typeof value!=="string" || !/^\d{17}$/.test(value))throw error("STEAM_REQUIRED","Sign in with your linked Steam account first.");
  return value;
}
function actor(user){return steamId(user?.steam_id);}
function clean(value,max) {
  if(typeof value!=="string")return "";
  return value.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max+1);
}
function ownGroup(steam) {
  const current=groups.getState(steam).current;
  if(!current || current.ownerSteamId!==steam || current.role!=="owner") {
    throw error("GROUP_OWNER_REQUIRED","Only the owner of an active Hollow Valley group can manage recruitment.");
  }
  return current;
}
function groupExists(id) {
  const gid=Number(id);
  if(!Number.isSafeInteger(gid)||gid<1)throw error("INVALID_GROUP","Choose a valid active group.");
  return db.prepare("SELECT id,name,status,owner_steam_id FROM hv_groups WHERE id=?").get(gid);
}
function memberCount(groupId){
  return db.prepare("SELECT COUNT(*) AS total FROM hv_group_members WHERE group_id=?").get(groupId).total;
}
function validateListing(input) {
  if(!input||typeof input!=="object"||Array.isArray(input))throw error("INVALID_LISTING","Invalid recruitment listing.");
  const active=input.active===true;
  const style=String(input.style||"casual"),focus=String(input.focus||"any");
  const description=clean(input.description||"",500);
  if(!STYLES.includes(style)||!FOCUS.includes(focus)||description.length>500||
      active && (description.length<20 || description.length>500)) {
    throw error("INVALID_LISTING","Select a playstyle, species focus and write a 20–500 character description before advertising.");
  }
  return {active,style,focus,description};
}
function sanitizedPublic(row){
  return {
    groupId:row.groupId,groupName:row.groupName,
    members:row.members,capacity:CAPACITY,full:row.members>=CAPACITY,
    style:row.style,focus:row.focus,description:row.description,
    updatedAt:row.updatedAt,
  };
}
function browse({style="",focus="",q="",limit=50}={}) {
  const styleFilter=STYLES.includes(style)?style:"";
  const focusFilter=FOCUS.includes(focus)?focus:"";
  const query=clean(q,100).toLowerCase();
  const limitNum=Number(limit),cap=Number.isSafeInteger(limitNum)?Math.max(1,Math.min(100,limitNum)):50;
  const clauses=["r.active=1","g.status='active'"];
  const values=[];
  if(styleFilter){clauses.push("r.style=?");values.push(styleFilter);}
  if(focusFilter){clauses.push("r.focus=?");values.push(focusFilter);}
  if(query){clauses.push("instr(lower(g.name || ' ' || r.description),?)>0");values.push(query);}
  return db.prepare(
    "SELECT r.group_id AS groupId,g.name AS groupName,r.style,r.focus,r.description,r.updated_at AS updatedAt, "+
    "(SELECT COUNT(*) FROM hv_group_members m WHERE m.group_id=g.id) AS members "+
    "FROM hv_group_recruitment r JOIN hv_groups g ON g.id=r.group_id "+
    "WHERE "+clauses.join(" AND ")+" ORDER BY r.updated_at DESC,g.id DESC LIMIT ?"
  ).all(...values,cap).map(sanitizedPublic);
}
function myInfo(user) {
  const s=actor(user);
  const group=groups.getState(s).current;
  const listing=group ? db.prepare("SELECT active,style,focus,description,updated_at AS updatedAt FROM hv_group_recruitment WHERE group_id=?")
    .get(group.id):null;
  const incoming=group && group.ownerSteamId===s
    ? db.prepare(
      "SELECT i.id,i.group_id AS groupId,i.message,i.status,i.created_at AS createdAt,i.applicant_steam_id AS applicantSteamId, "+
      "coalesce(u.username,'Steam player') AS applicantName FROM hv_group_interest i "+
      "LEFT JOIN users u ON u.steam_id=i.applicant_steam_id "+
      "WHERE i.group_id=? AND i.status='pending' ORDER BY i.created_at DESC LIMIT 75"
    ).all(group.id):[];
  const sent=db.prepare(
    "SELECT i.id,i.group_id AS groupId,g.name AS groupName,i.status,i.created_at AS createdAt "+
    "FROM hv_group_interest i JOIN hv_groups g ON g.id=i.group_id "+
    "WHERE i.applicant_steam_id=? ORDER BY i.created_at DESC LIMIT 50"
  ).all(s);
  return {
    group:group?{id:group.id,name:group.name,role:group.role,owner:group.ownerSteamId===s,
      memberCount:group.members.length,capacity:CAPACITY}:null,
    listing,incoming,sent,
  };
}
function upsertListing(user,input) {
  const s=actor(user),group=ownGroup(s);
  const data=validateListing(input),at=new Date().toISOString();
  db.prepare(
    "INSERT INTO hv_group_recruitment(group_id,active,style,focus,description,updated_at) VALUES(?,?,?,?,?,?) "+
    "ON CONFLICT(group_id) DO UPDATE SET active=excluded.active,style=excluded.style,focus=excluded.focus,"+
    "description=excluded.description,updated_at=excluded.updated_at"
  ).run(group.id,data.active?1:0,data.style,data.focus,data.description,at);
  return myInfo(user);
}
function apply(user,groupId,rawMessage) {
  const s=actor(user),g=groupExists(groupId);
  if(!g||g.status!=="active")throw error("NOT_FOUND","Recruiting group not found.");
  if(groups.getState(s).current)throw error("ALREADY_GROUPED","Leave your current website group before requesting to join another.");
  const listing=db.prepare("SELECT * FROM hv_group_recruitment WHERE group_id=? AND active=1").get(g.id);
  if(!listing)throw error("NOT_RECRUITING","This group is not accepting recruitment requests.");
  if(memberCount(g.id)>=CAPACITY)throw error("GROUP_FULL","This group is at capacity.");
  if(s===g.owner_steam_id)throw error("ALREADY_GROUPED","You already own this group.");
  const message=clean(rawMessage,400);
  if(message.length<15 || message.length>400)throw error("INVALID_MESSAGE","Tell the group about yourself in 15–400 characters.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const current=db.prepare("SELECT id FROM hv_group_interest WHERE group_id=? AND applicant_steam_id=? AND status='pending'").get(g.id,s);
    if(current)throw error("ALREADY_APPLIED","You have already sent an interest request to this group.");
    const recent=db.prepare(
      "SELECT COUNT(*) AS n FROM hv_group_interest WHERE applicant_steam_id=? AND created_at>=?"
    ).get(s,new Date(Date.now()-86400000).toISOString()).n;
    if(recent>=4)throw error("INTEREST_LIMIT","You can submit up to four group enquiries per day.");
    const now=new Date().toISOString();
    db.prepare("INSERT INTO hv_group_interest(group_id,applicant_steam_id,message,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)")
      .run(g.id,s,message,now,now);
    db.exec("COMMIT");
    return {ok:true,pending:true};
  }catch(e){db.exec("ROLLBACK");throw e;}
}
function application(id) {
  const n=Number(id);
  if(!Number.isSafeInteger(n)||n<1)throw error("NOT_FOUND","Request not found.");
  return db.prepare("SELECT * FROM hv_group_interest WHERE id=?").get(n);
}
function decide(user,id,decision) {
  const s=actor(user),a=application(id);
  if(!a)throw error("NOT_FOUND","Interest request not found.");
  const g=ownGroup(s);
  if(g.id!==a.group_id)throw error("NOT_FOUND","Interest request not found.");
  if(!["acknowledged","declined"].includes(decision))throw error("INVALID_DECISION","Choose acknowledged or declined.");
  const update=db.prepare("UPDATE hv_group_interest SET status=?,updated_at=? WHERE id=? AND status='pending'")
    .run(decision,new Date().toISOString(),a.id);
  if(update.changes!==1)throw error("ALREADY_REVIEWED","This interest request has already been reviewed.");
  // "Acknowledged" is deliberately not an invitation. Use the existing
  // group owner invitation flow to invite a player after review.
  return myInfo(user);
}
function cancel(user,id){
  const s=actor(user),a=application(id);
  if(!a||a.applicant_steam_id!==s)throw error("NOT_FOUND","Request not found.");
  const update=db.prepare("UPDATE hv_group_interest SET status='cancelled',updated_at=? WHERE id=? AND status='pending'")
    .run(new Date().toISOString(),a.id);
  if(update.changes!==1)throw error("ALREADY_REVIEWED","This interest request is no longer pending.");
  return myInfo(user);
}
module.exports={STYLES,FOCUS,browse,myInfo,upsertListing,apply,decide,cancel,validateListing};
