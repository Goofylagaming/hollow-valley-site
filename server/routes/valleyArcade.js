"use strict";
const router=require("express").Router();
const {requireAuth,requireAdmin}=require("../middleware/requireAuth");
const {arcadeRequest}=require("../services/automationWebsiteClient");
const {db}=require("../db");
const {present,presentRecent}=require("../services/arcadePublicBoard");
router.use(requireAuth);
router.use((req,res,next)=>{
  if(process.env.VALLEY_ARCADE_ENABLED!=="1") return res.sendStatus(404);
  res.set("Cache-Control","private, no-store");
  if(req.method==="POST"){
    try {if(new URL(req.get("origin")).host!==req.get("host")) return res.sendStatus(403);}
    catch {return res.sendStatus(403);}
  }
  next();
});
const forward=(action,payload)=>async(req,res)=>{
  try {res.json(await arcadeRequest(action,payload(req)));}
  catch {res.status(409).json({error:"Arcade unavailable. Check your round or try again later."});}
};
router.get("/settings",requireAdmin,forward("settings",()=>({})));
router.post("/settings",requireAdmin,forward("configure",req=>({actor:String(req.user.id),cap:req.body?.cap,
  enabled:req.body?.enabled,emergency:req.body?.emergency})));
router.post("/start",forward("start",req=>({steamId:req.user.steam_id,game:req.body?.game,requestKey:req.body?.requestKey})));
router.post("/answer",forward("answer",req=>({steamId:req.user.steam_id,id:req.body?.id,choice:req.body?.choice,
  token:typeof req.body?.token==="string"?req.body.token:undefined})));
router.post("/signal",forward("signal",req=>({steamId:req.user.steam_id,id:req.body?.id})));
router.post("/flip",forward("flip",req=>({steamId:req.user.steam_id,id:req.body?.id,position:req.body?.position})));
router.get("/leaderboard",forward("leaderboard",()=>({})));
// Scores are cached for 30s on the automation service. This route replaces Steam IDs with display names.
function namesFor(ids){
  const names=new Map();
  const unique=[...new Set(ids.filter(id=>/^\d{17}$/.test(id)))];
  if(!unique.length) return names;
  const rows=db.prepare(`SELECT steam_id, username FROM users WHERE steam_id IN (${unique.map(()=>"?").join(",")})`).all(...unique);
  for(const row of rows) names.set(row.steam_id,row.username);
  return names;
}
router.get("/weekly",async(req,res)=>{
  try {
    const raw=await arcadeRequest("weekly",{steamId:req.user.steam_id});
    const entries=Array.isArray(raw?.entries)?raw.entries.slice(0,10):[];
    const ids=[...entries.map(row=>String(row.steamId||"")),String(raw?.you?.steamId||"")];
    res.json(present(raw,namesFor(ids)));
  } catch {
    res.status(409).json({error:"Arcade unavailable. Check your round or try again later."});
  }
});
// Same POST as weekly: /api/website/admin-wallet/arcade/recent-wins
// Rows arrive as { steamId, type, name, rarity, timestamp }. steamId never leaves this server.
router.get("/recent-wins",async(req,res)=>{
  try {
    const raw=await arcadeRequest("recent-wins",{steamId:req.user.steam_id});
    const entries=Array.isArray(raw?.entries)?raw.entries.slice(0,10):null;
    if(!entries) throw new Error("Invalid recent wins");
    res.json(presentRecent({entries},namesFor(entries.map(row=>String(row?.steamId||"")))));
  } catch(error) {
    const status=Number(error&&error.status);
    if(status===404||status===401||status===403) return res.sendStatus(status);
    res.status(409).json({error:"Arcade unavailable. Check your round or try again later."});
  }
});
module.exports=router;
