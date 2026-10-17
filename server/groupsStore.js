// Website-only Groups v1. Steam-linked identities; no game commands or Territory Wars.
const { db } = require("./db");
const groupProgress = require("./groupProgress");
db.exec(`
 CREATE TABLE IF NOT EXISTS hv_groups (
   id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE,
   owner_steam_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
   status TEXT NOT NULL DEFAULT 'active', closed_at TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS hv_active_group_name ON hv_groups(name) WHERE status='active';
 CREATE TABLE IF NOT EXISTS hv_group_members (
   group_id INTEGER NOT NULL, steam_id TEXT NOT NULL UNIQUE,
   role TEXT NOT NULL CHECK(role IN ('owner','member')),
   joined_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(group_id,steam_id));
 CREATE INDEX IF NOT EXISTS hv_group_member_group ON hv_group_members(group_id);
 CREATE TABLE IF NOT EXISTS hv_group_invites (
   id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL,
   inviter_steam_id TEXT NOT NULL, invitee_steam_id TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'pending',
   created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS hv_pending_invite ON hv_group_invites(group_id,invitee_steam_id) WHERE status='pending';
 CREATE INDEX IF NOT EXISTS hv_invites_incoming ON hv_group_invites(invitee_steam_id,status);
 CREATE TABLE IF NOT EXISTS hv_group_history (
   id INTEGER PRIMARY KEY AUTOINCREMENT, steam_id TEXT NOT NULL,
   group_id INTEGER NOT NULL, group_name TEXT NOT NULL,
   role TEXT NOT NULL, joined_at TEXT NOT NULL,
   left_at TEXT NOT NULL DEFAULT (datetime('now')),
   outcome TEXT NOT NULL CHECK(outcome IN ('left','removed','disbanded')),
   members_snapshot TEXT NOT NULL DEFAULT '[]');
 CREATE INDEX IF NOT EXISTS hv_group_history_member ON hv_group_history(steam_id,id DESC);
`);
const CAPACITY=12;
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function steamId(value){const id=String(value??"").trim();if(!/^\d{17}$/.test(id))fail("A linked 17-digit Steam account is required.");return id;}
function positiveId(value){const id=Number(value);if(!Number.isSafeInteger(id)||id<1)fail("Invalid group or invitation ID.");return id;}
function atomic(fn){
  db.exec("BEGIN IMMEDIATE");
  try{const value=fn();db.exec("COMMIT");return value;}
  catch(error){db.exec("ROLLBACK");throw error;}
}
function account(s){return db.prepare("SELECT steam_id,username,avatar FROM users WHERE steam_id=?").get(s);}
function current(s){return db.prepare(`
 SELECT g.id,g.name,g.owner_steam_id AS ownerSteamId,g.created_at AS createdAt,
 m.role,m.joined_at AS joinedAt FROM hv_group_members m
 JOIN hv_groups g ON g.id=m.group_id WHERE m.steam_id=? AND g.status='active'`).get(s);}
function membersOf(gid){return db.prepare(`
 SELECT m.steam_id AS steamId,COALESCE(u.username,'Steam player') AS username,u.avatar,
 m.role,m.joined_at AS joinedAt FROM hv_group_members m
 LEFT JOIN users u ON u.steam_id=m.steam_id WHERE m.group_id=?
 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.joined_at,m.steam_id`).all(gid);}
function ownerGroup(s){const g=current(s);if(!g||g.ownerSteamId!==s)fail("Only the group owner can manage members.",403);return g;}
function expireInvites(gid){db.prepare("UPDATE hv_group_invites SET status='expired',resolved_at=datetime('now') WHERE group_id=? AND status='pending'").run(gid);}
function recordExit(member,g,outcome,snapshot){db.prepare(`
 INSERT INTO hv_group_history(steam_id,group_id,group_name,role,joined_at,outcome,members_snapshot)
 VALUES(?,?,?,?,?,?,?)`).run(member.steamId,g.id,g.name,member.role,member.joinedAt,outcome,JSON.stringify(snapshot.map(m=>m.username)));}
function getState(rawSteam){
 const s=steamId(rawSteam),g=current(s);
 const own=g?{...g,members:membersOf(g.id),capacity:CAPACITY,
  sentInvites:db.prepare(`
   SELECT i.id,i.invitee_steam_id AS steamId,COALESCE(u.username,'Steam player') AS username,
   i.created_at AS createdAt FROM hv_group_invites i LEFT JOIN users u ON u.steam_id=i.invitee_steam_id
   WHERE i.group_id=? AND i.status='pending' ORDER BY i.id DESC`).all(g.id)}:null;
 return {current:own,
 incoming:db.prepare(`
   SELECT i.id,i.group_id AS groupId,g.name AS groupName,i.created_at AS createdAt,
   COALESCE(u.username,'Steam player') AS invitedBy
   FROM hv_group_invites i JOIN hv_groups g ON g.id=i.group_id
   LEFT JOIN users u ON u.steam_id=i.inviter_steam_id
   WHERE i.invitee_steam_id=? AND i.status='pending' AND g.status='active'
   ORDER BY i.id DESC LIMIT 30`).all(s),
 previous:db.prepare(`
   SELECT group_id AS groupId,group_name AS groupName,role,joined_at AS joinedAt,
   left_at AS leftAt,outcome,members_snapshot AS membersSnapshot
   FROM hv_group_history WHERE steam_id=? ORDER BY id DESC LIMIT 30`).all(s)
 .map(entry=>{let members=[];try{members=JSON.parse(entry.membersSnapshot);}catch{}
   const {membersSnapshot,...rest}=entry;return {...rest,members};})};
}
function createGroup(rawSteam,rawName){
 const s=steamId(rawSteam),name=String(rawName??"").trim().replace(/\s+/g," ");
 if(name.length<3||name.length>40||/[\x00-\x1f\x7f]/.test(name))fail("Group name must be 3–40 characters.");
 return atomic(()=>{
   if(!account(s))fail("Your Steam account must be linked to your website profile.",403);
   if(current(s))fail("Leave your current group before creating another.",409);
   if(db.prepare("SELECT id FROM hv_groups WHERE status='active' AND name=? COLLATE NOCASE").get(name))fail("An active group already uses that name.",409);
   const gid=db.prepare("INSERT INTO hv_groups(name,owner_steam_id) VALUES(?,?)").run(name,s).lastInsertRowid;
   db.prepare("INSERT INTO hv_group_members(group_id,steam_id,role) VALUES(?,?,'owner')").run(gid,s);
   groupProgress.observeGroup(Number(gid));
   return getState(s);
 });
}
function invite(rawSteam,rawInvitee){
 const s=steamId(rawSteam),target=steamId(rawInvitee);
 if(s===target)fail("You cannot invite yourself.");
 return atomic(()=>{
   const g=ownerGroup(s);
   if(!account(target))fail("That player must first sign in with Steam on this website.",404);
   if(current(target))fail("That player is already in a group.",409);
   if(membersOf(g.id).length>=CAPACITY)fail("Your group is full.",409);
   if(db.prepare("SELECT id FROM hv_group_invites WHERE group_id=? AND invitee_steam_id=? AND status='pending'").get(g.id,target))fail("An invitation is already pending.",409);
   db.prepare("INSERT INTO hv_group_invites(group_id,inviter_steam_id,invitee_steam_id) VALUES(?,?,?)").run(g.id,s,target);
   return getState(s);
 });
}
function actOnInvite(rawSteam,rawId,action){
 const s=steamId(rawSteam),id=positiveId(rawId);
 if(!["accept","decline"].includes(action))fail("Unknown invitation action.");
 return atomic(()=>{
   const invitation=db.prepare("SELECT * FROM hv_group_invites WHERE id=? AND status='pending'").get(id);
   if(!invitation||invitation.invitee_steam_id!==s)fail("Invitation not found.",404);
   if(action==="accept"){
     if(!db.prepare("SELECT id FROM hv_groups WHERE id=? AND status='active'").get(invitation.group_id))fail("Group no longer exists.",404);
     if(current(s))fail("Leave your current group before accepting.",409);
     if(membersOf(invitation.group_id).length>=CAPACITY)fail("This group is full.",409);
     db.prepare("INSERT INTO hv_group_members(group_id,steam_id,role) VALUES(?,?,'member')").run(invitation.group_id,s);
     groupProgress.observeGroup(invitation.group_id);
     db.prepare("UPDATE hv_group_invites SET status='expired',resolved_at=datetime('now') WHERE invitee_steam_id=? AND status='pending' AND id!=?").run(s,id);
   }
   db.prepare("UPDATE hv_group_invites SET status=?,resolved_at=datetime('now') WHERE id=?").run(action==="accept"?"accepted":"declined",id);
   return getState(s);
 });
}
function cancelInvite(rawSteam,rawId){
 const s=steamId(rawSteam),id=positiveId(rawId);
 return atomic(()=>{
   const g=ownerGroup(s);
   const result=db.prepare("UPDATE hv_group_invites SET status='cancelled',resolved_at=datetime('now') WHERE id=? AND group_id=? AND status='pending'").run(id,g.id);
   if(!result.changes)fail("Invitation not found.",404);
   return getState(s);
 });
}
function exitGroup(rawSteam,rawTarget){
 const s=steamId(rawSteam);
 return atomic(()=>{
   const g=current(s);
   if(!g)fail("You do not belong to a group.",404);
   const target=rawTarget==null?s:steamId(rawTarget);
   if(target!==s&&g.ownerSteamId!==s)fail("Only the owner can remove other members.",403);
   const snapshot=membersOf(g.id),member=snapshot.find(m=>m.steamId===target);
   if(!member)fail("Player does not belong to your group.",404);
   groupProgress.observeGroup(g.id);
   recordExit(member,g,target===s?"left":"removed",snapshot);
   db.prepare("DELETE FROM hv_group_members WHERE group_id=? AND steam_id=?").run(g.id,target);
   const remaining=membersOf(g.id);
   if(!remaining.length){
     db.prepare("UPDATE hv_groups SET status='closed',closed_at=datetime('now') WHERE id=?").run(g.id);
     expireInvites(g.id);
   }else if(member.role==="owner"){
     const next=remaining[0];
     db.prepare("UPDATE hv_group_members SET role='owner' WHERE group_id=? AND steam_id=?").run(g.id,next.steamId);
     db.prepare("UPDATE hv_groups SET owner_steam_id=? WHERE id=?").run(next.steamId,g.id);
   }
   return getState(s);
 });
}
function disband(rawSteam){
 const s=steamId(rawSteam);
 return atomic(()=>{
   const g=ownerGroup(s),snapshot=membersOf(g.id);
   groupProgress.observeGroup(g.id);
   for(const m of snapshot)recordExit(m,g,"disbanded",snapshot);
   db.prepare("DELETE FROM hv_group_members WHERE group_id=?").run(g.id);
   db.prepare("UPDATE hv_groups SET status='closed',closed_at=datetime('now') WHERE id=?").run(g.id);
   expireInvites(g.id);
   return getState(s);
 });
}
module.exports={CAPACITY,getState,createGroup,invite,actOnInvite,cancelInvite,exitGroup,disband};