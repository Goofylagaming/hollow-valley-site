"use strict";
const router=require("express").Router();
const {requireAuth,requireAdmin}=require("../middleware/requireAuth");
const {arcadeRequest}=require("../services/automationWebsiteClient");
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
router.post("/answer",forward("answer",req=>({steamId:req.user.steam_id,id:req.body?.id,choice:req.body?.choice})));
router.get("/leaderboard",forward("leaderboard",()=>({})));
module.exports=router;
