// Website-only group milestones. Does not modify player wallets, Steam game state or Territory Wars.
// XP here is a non-spendable group score; it is never Valley Coins or individual player XP.
const { db } = require("./db");

db.exec(`
  CREATE TABLE IF NOT EXISTS hv_group_progress_stats (
    group_id INTEGER PRIMARY KEY,
    max_members INTEGER NOT NULL DEFAULT 0,
    last_observed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS hv_group_weekly_peaks (
    group_id INTEGER NOT NULL,
    period_key TEXT NOT NULL,
    max_members INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, period_key)
  );
  CREATE TABLE IF NOT EXISTS hv_group_awards (
    group_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('achievement','quest')),
    award_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    group_xp INTEGER NOT NULL CHECK (group_xp >= 0),
    awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id,kind,award_id,period_key)
  );
  CREATE INDEX IF NOT EXISTS hv_group_awards_group ON hv_group_awards(group_id);
`);

const ACHIEVEMENTS = Object.freeze([
  { id: "founding-pack", title: "Founding Pack", description: "Start a Hollow Valley group.", metric: "members", target: 1, xp: 100 },
  { id: "first-recruit", title: "First Recruit", description: "Welcome your first new member.", metric: "members", target: 2, xp: 150 },
  { id: "three-strong", title: "Three Strong", description: "Grow the group to 3 members.", metric: "members", target: 3, xp: 250 },
  { id: "pack-of-five", title: "Pack of Five", description: "Grow the group to 5 members.", metric: "members", target: 5, xp: 500 },
  { id: "full-roster", title: "Full Roster", description: "Reach the 12-member group limit.", metric: "members", target: 12, xp: 1200 },
  { id: "welcoming-committee", title: "Welcoming Committee", description: "Welcome 5 distinct players over the group's lifetime.", metric: "recruits", target: 5, xp: 400 },
]);

const QUESTS = Object.freeze([
  { id: "welcome-one", title: "A New Face", description: "Welcome 1 new Steam-linked player to your group this week.", metric: "weeklyRecruits", target: 1, xp: 75 },
  { id: "welcome-two", title: "Recruitment Drive", description: "Welcome 2 different players this week.", metric: "weeklyRecruits", target: 2, xp: 150 },
  { id: "trio", title: "Safety in Numbers", description: "Reach 3 active website-group members this week.", metric: "weeklyPeak", target: 3, xp: 100 },
  { id: "five", title: "Stronger Together", description: "Reach 5 active website-group members this week.", metric: "weeklyPeak", target: 5, xp: 250 },
]);

const HOUR=60*60*1000, DAY=24*HOUR, BRISBANE_OFFSET=10*HOUR;
function weekWindow(now=Date.now()){
  const local=new Date(Number(now)+BRISBANE_OFFSET);
  if(!Number.isFinite(local.getTime()))throw new Error("Invalid time");
  const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
  const monday=midnight-((local.getUTCDay()+6)%7)*DAY;
  const utcStart=monday-BRISBANE_OFFSET;
  return {
    period: new Date(monday).toISOString().slice(0,10),
    startSql: new Date(utcStart).toISOString().slice(0,19).replace("T"," "),
    resetAt: new Date(utcStart+7*DAY).toISOString(),
  };
}
function validGroupId(id){
  const value=Number(id);
  if(!Number.isSafeInteger(value)||value<=0)throw new Error("Invalid group ID");
  return value;
}
function countDistinctRecruits(groupId,since){
  return Number(db.prepare(`
    SELECT COUNT(DISTINCT invitee_steam_id) AS total
    FROM hv_group_invites WHERE group_id=? AND status='accepted'
      ${since ? "AND resolved_at >= ?" : ""}
  `).get(...(since?[groupId,since]:[groupId])).total)||0;
}
function awardGroup(groupId,kind,id,period,xp){
  db.prepare(`
    INSERT OR IGNORE INTO hv_group_awards(group_id,kind,award_id,period_key,group_xp)
    VALUES(?,?,?,?,?)
  `).run(groupId,kind,id,period,xp);
}
function readMetrics(groupId,now){
  const {period,startSql,resetAt}=weekWindow(now);
  const active=db.prepare("SELECT COUNT(*) AS total FROM hv_group_members WHERE group_id=?").get(groupId).total;
  db.prepare(`
    INSERT INTO hv_group_progress_stats(group_id,max_members) VALUES(?,?)
    ON CONFLICT(group_id) DO UPDATE SET
      max_members=MAX(max_members,excluded.max_members),
      last_observed_at=datetime('now')
  `).run(groupId,active);
  db.prepare(`
    INSERT INTO hv_group_weekly_peaks(group_id,period_key,max_members) VALUES(?,?,?)
    ON CONFLICT(group_id,period_key) DO UPDATE SET max_members=MAX(max_members,excluded.max_members)
  `).run(groupId,period,active);
  const maxMembers=db.prepare("SELECT max_members AS value FROM hv_group_progress_stats WHERE group_id=?").get(groupId).value;
  const weeklyPeak=db.prepare("SELECT max_members AS value FROM hv_group_weekly_peaks WHERE group_id=? AND period_key=?").get(groupId,period).value;
  return { members:maxMembers, recruits:countDistinctRecruits(groupId), weeklyRecruits:countDistinctRecruits(groupId,startSql), weeklyPeak, period, resetAt, active };
}
function autoAward(groupId,metrics){
  for(const a of ACHIEVEMENTS){
    if(metrics[a.metric]>=a.target)awardGroup(groupId,"achievement",a.id,"lifetime",a.xp);
  }
  for(const q of QUESTS){
    if(metrics[q.metric]>=q.target)awardGroup(groupId,"quest",q.id,metrics.period,q.xp);
  }
}
// Called inside Groups' existing SQLite transaction following trusted creation/acceptance,
// and before a member departure, preserving maximum roster milestones.
function observeGroup(rawId,now=Date.now()){
  const groupId=validGroupId(rawId);
  const group=db.prepare("SELECT id FROM hv_groups WHERE id=? AND status='active'").get(groupId);
  if(!group)return null;
  const metrics=readMetrics(groupId,now);
  autoAward(groupId,metrics);
  return metrics;
}
function getProgress(rawSteam,now=Date.now()){
  const steam=String(rawSteam||"").trim();
  if(!/^\d{17}$/.test(steam)){
    const error=new Error("Sign in with a linked Steam account to see Group Quests.");
    error.status=403;throw error;
  }
  const membership=db.prepare(`
    SELECT g.id,g.name FROM hv_group_members m JOIN hv_groups g ON g.id=m.group_id
    WHERE m.steam_id=? AND g.status='active'
  `).get(steam);
  if(!membership)return {group:null,groupXp:0,achievements:[],quests:[],resetAt:weekWindow(now).resetAt,
    explanation:"Create or join a group to unlock achievements and weekly quests."};
  // SQLite transactions are synchronous. Reading and awarding in one transaction is idempotent.
  db.exec("BEGIN IMMEDIATE");
  try{
    const metrics=observeGroup(membership.id,now);
    const awarded=db.prepare("SELECT kind,award_id,period_key,awarded_at FROM hv_group_awards WHERE group_id=?").all(membership.id);
    const awardedSet=new Set(awarded.map(x=>x.kind+":"+x.award_id+":"+x.period_key));
    const achievements=ACHIEVEMENTS.map(a=>({
      id:a.id,title:a.title,description:a.description,target:a.target,
      progress:Math.min(a.target,metrics[a.metric]),xp:a.xp,
      completed:awardedSet.has("achievement:"+a.id+":lifetime"),
    }));
    const quests=QUESTS.map(q=>({
      id:q.id,title:q.title,description:q.description,target:q.target,
      progress:Math.min(q.target,metrics[q.metric]),xp:q.xp,
      completed:awardedSet.has("quest:"+q.id+":"+metrics.period),period:metrics.period,
    }));
    const groupXp=db.prepare("SELECT COALESCE(SUM(group_xp),0) AS total FROM hv_group_awards WHERE group_id=?").get(membership.id).total;
    const weeklyXp=db.prepare("SELECT COALESCE(SUM(group_xp),0) AS total FROM hv_group_awards WHERE group_id=? AND kind='quest' AND period_key=?").get(membership.id,metrics.period).total;
    db.exec("COMMIT");
    return {
      group:{id:membership.id,name:membership.name,activeMembers:metrics.active},
      groupXp,weeklyXp,achievements,quests,resetAt:metrics.resetAt,
      explanation:"Progress comes from accepted invitations and active website group membership. Group XP is a leaderboard-style score, not Valley Coins.",
    };
  }catch(e){db.exec("ROLLBACK");throw e;}
}
module.exports={ACHIEVEMENTS,QUESTS,weekWindow,observeGroup,getProgress};