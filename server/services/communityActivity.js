"use strict";
// Public analytics use *already existing* read-only automation snapshots.
// The website never opens direct RCON and never shares player coordinates,
// Steam IDs, admin audits, precise trails or private group rosters.
const {db}=require("../db");
const status=require("./serverStatus");
const automation=require("./automationWebsiteClient");
const guides=require("./communityGuides");
const groups=require("../groupsStore");

const publications=require('./eventResultPublicStore').createPublicResultStore(db);

function problem(code,message){const e=new Error(message);e.code=code;return e;}
function safeText(value,max) {
  if(typeof value!=="string")return "";
  const text=value.replace(/[\u0000-\u001f\u007f]/g," ").trim();
  return text.slice(0,max+1);
}
function numeric(value,max=1000000) {
  const n=Number(value);
  return Number.isFinite(n)&&n>=0 ? Math.min(max,n) : 0;
}
function iso(value) {
  const n=Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
function validDiscordEventLink(value) {
  const str=String(value||"");
  return /^https:\/\/discord\.com\/events\/\d{10,24}\/\d{10,24}$/.test(str)?str:null;
}
function verifiedServer(nowMs=Date.now()) {
  const state=status.getDisplayState();
  const checked=iso(state.lastChecked);
  // Allow small clock skew and a snapshot updated during this async request.
  // Otherwise a fresh check milliseconds after "nowMs" looks stale.
  const ageMs=checked?nowMs-Date.parse(checked):Number.POSITIVE_INFINITY;
  const fresh=Boolean(state.configured)&&state.stale!==true&&Boolean(checked)&&
    ageMs>=-60000&&ageMs<=180000;
  return {
    state: !state.configured?"unconfigured":!fresh?"delayed":state.online?"online":"offline",
    checkedAt:checked,
    playersOnline:fresh&&state.online?numeric(state.playerCount,1000):null,
    maxPlayers:fresh?numeric(state.maxPlayers,1000):null,
    // Important: stale snapshots are never relabelled offline.
    verifiedBy:"automation snapshot",
  };
}
function sanitizeActivity(raw,nowMs=Date.now(),hours=24){
  const last=iso(raw?.lastVerifiedAt);
  const hasData=raw?.trackingEnabled===true && numeric(raw?.sampleCount,100000)>0;
  const stale=last ? nowMs-Date.parse(last)>600000 || Date.parse(last)>nowMs+60000 : true;
  if(!hasData)return {
    available:false,stale:true,hours,sampleCount:0,lastVerifiedAt:last,
    reason:"No verified player activity samples are available for this period.",
    uniquePlayers:null,sessions:null,averageOnline:null,peakConcurrent:null,topSpecies:[],activityTrend:[],
  };
  const topSpecies=(Array.isArray(raw.topSpecies)?raw.topSpecies:[]).slice(0,8)
    .map(item=>({
      species:safeText(item?.species,60),samplePlayerCount:numeric(item?.samplePlayerCount,100000),
    })).filter(item=>item.species);
  const activityTrend=(Array.isArray(raw.activityTrend)?raw.activityTrend:[]).slice(0,48)
    .map(item=>({
      startedAt:iso(item?.startedAt),
      averagePlayers:numeric(item?.averagePlayers,1000),
      peakPlayers:numeric(item?.peakPlayers,1000),
      samples:numeric(item?.samples,100000),
    })).filter(item=>item.startedAt);
  return {
    available:true,stale,hours,
    sampleCount:numeric(raw.sampleCount,100000),lastVerifiedAt:last,
    uniquePlayers:numeric(raw.uniquePlayers,100000),
    sessions:numeric(raw.sessions,100000),
    averageOnline:numeric(raw.averageOnline,1000),
    peakConcurrent:numeric(raw.peakConcurrent,1000),
    topSpecies,activityTrend,
  };
}
function sanitizeEvents(raw,nowMs=Date.now()){
  const syncedAt=iso(raw?.syncedAt);
  const valid=raw?.configured===true && raw.stale!==true && Boolean(syncedAt) &&
    Date.parse(syncedAt)<=nowMs+60000 && nowMs-Date.parse(syncedAt)<=300000;
  if(!valid) {
    return {available:false,stale:true,syncedAt,
      upcoming:[],reason:"Scheduled event feed is unavailable or delayed."};
  }
  const rows=(Array.isArray(raw.events)?raw.events:[]).map(entry=>({
    title:safeText(entry?.title,120),
    startTime:iso(entry?.startTime),
    url:validDiscordEventLink(entry?.url),
    location:safeText(entry?.location,100)||null,
  })).filter(entry=>entry.title&&entry.startTime&&Date.parse(entry.startTime)>=nowMs)
    .sort((a,b)=>a.startTime.localeCompare(b.startTime)).slice(0,8);
  return {available:true,stale:false,syncedAt,upcoming:rows};
}
function publicResults(limit=12){
  return publications.list(limit);
}
async function overview({hours=24,nowMs=Date.now()}={}){
  const requested=Number(hours),windowHours=[24,72,168].includes(requested)?requested:24;
  const [activity,events]=await Promise.allSettled([
    automation.getMapActivity({hours:windowHours}),
    automation.getDiscordScheduledEvents(),
  ]);
  return {
    checkedAt:new Date(nowMs).toISOString(),
    readOnly:true,
    server:verifiedServer(nowMs),
    activity:sanitizeActivity(activity.status==="fulfilled"?activity.value:null,nowMs,windowHours),
    events:sanitizeEvents(events.status==="fulfilled"?events.value:null,nowMs),
    // No verified in-game party/pack feed is currently integrated.
    inGamePartyVerificationAvailable:false,
    eventResults:publicResults(8),
  };
}
function packContext(user){
  const s=String(user?.steam_id||"");
  if(!/^\d{17}$/.test(s))throw problem("STEAM_REQUIRED","Sign in with Steam to check your own group.");
  const group=groups.getState(s).current;
  const live=status.getState();
  const now=Date.now(),last=iso(live.lastChecked);
  const fresh=live.configured && !live.stale && last && now-Date.parse(last)>=0 && now-Date.parse(last)<=180000;
  const own=fresh&&live.online && Array.isArray(live.characters) ?
    live.characters.find(c=>String(c.steamId||"")===s):null;
  const speciesName=own?safeText(String(own.species||""),80)||null:null;
  const guide=guides.publicState();
  const known=speciesName ? guide.species.find(entry=>speciesName.toLowerCase().includes(entry.id.toLowerCase())):null;
  const published=guide.published&&known?guide.packs.find(entry=>entry.speciesId===known.id):null;
  return {
    websiteGroup:group?{name:group.name,members:group.members.length,capacity:groups.CAPACITY}:null,
    myLiveSpecies:speciesName,
    publishedSingleSpeciesLimit:published?.maxMembers??null,
    policyVersion:guide.published?guide.version:null,
    verification:"unavailable",
    reason:"Hollow Valley website groups are not authoritative in-game parties. Other members' actual dinosaur species and game-party membership cannot be verified by this website.",
    // Never return positions, Steam IDs or member names.
  };
}
function validateEventResult(value,nowMs=Date.now()){
  return require('./eventResultValidation').validateEventResult(value,nowMs);
}
function publishResult(user,value){
  if(!user?.is_admin || !/^\d{17}$/.test(String(user.steam_id||""))||!Number.isSafeInteger(user.id)||!db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=? AND is_admin=1').get(user.id,user.steam_id))
    throw problem("ADMIN_REQUIRED","A Steam-linked administrator is required.");
  if(require('../middleware/skinStudioSafety').getSkinStudioSafety().readOnly)throw problem('READ_ONLY','This preview cannot publish event results.');
  if(value?.confirm!=="PUBLISH")throw problem("CONFIRM_REQUIRED",'Type "PUBLISH" to release the event result.');
  const event=validateEventResult(value);
  const at=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=? AND is_admin=1').get(user.id,user.steam_id))throw problem('ADMIN_REQUIRED','Current staff access is required.');
    if(require('../middleware/skinStudioSafety').getSkinStudioSafety().readOnly)throw problem('READ_ONLY','This preview cannot publish event results.');
    db.prepare(
      "INSERT INTO hv_event_results_public (event_key,title,event_at,summary,winners_json,published_at,published_by_steam_id) VALUES(?,?,?,?,?,?,?)"
    ).run(event.key,event.title,event.time,event.summary,JSON.stringify(event.winners),at,user.steam_id);
    db.exec('COMMIT');
  }catch(error){
    db.exec('ROLLBACK');
    if(/UNIQUE|PRIMARY KEY|constraint/i.test(error.message))
      throw problem("EVENT_ALREADY_PUBLISHED","This event already has a published result. Publish a correction as a separate event note.");
    throw error;
  }
  return publications.get(event.key);
}
module.exports={
  verifiedServer,sanitizeActivity,sanitizeEvents,overview,packContext,
  publicResults,validateEventResult,publishResult,
};
