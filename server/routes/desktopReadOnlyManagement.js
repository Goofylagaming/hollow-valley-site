"use strict";
// A separate and deliberately narrower capability than HV_MANAGEMENT_AGENT_TOKEN.
// GET-only with a distinct secret, fixed response schema and no job controls.
const express=require("express");
const {timingSafeEqual,createHash}=require("node:crypto");
const management=require("../services/serverManagement");
const router=express.Router();
const TASK_KEYS=["watchdog","scheduled_restart","autosave","scanner","command_bridge","combat_forwarder","legacy_combat_forwarder"];
const ALLOWED_TASK_STATES=new Set(["Running","Ready","Disabled","Queued","Unknown","Missing"]);
function configured(){
 const token=String(process.env.HV_DESKTOP_READONLY_TOKEN||"");
 const agent=String(process.env.HV_MANAGEMENT_AGENT_TOKEN||"");
 return process.env.HV_DESKTOP_READONLY_ENABLED==="1" &&
        token.length>=40 && token!==agent && !/\s/.test(token);
}
function authenticate(req,res,next){
 res.set("Cache-Control","no-store, private");
 res.set("Pragma","no-cache");
 res.set("X-Content-Type-Options","nosniff");
 if(!configured())return res.status(404).json({error:"Not found"});
 const auth=/^Bearer ([^\s]+)$/.exec(String(req.get("authorization")||""));
 const expected=createHash("sha256").update(String(process.env.HV_DESKTOP_READONLY_TOKEN)).digest();
 const actual=createHash("sha256").update(auth?.[1]||"").digest();
 if(!auth || !timingSafeEqual(actual,expected))return res.status(401).json({error:"Unauthorized"});
 return next();
}
function shape(){
 const h=management.heartbeat();
 const tasks={};
 for(const key of TASK_KEYS){
  const value=String(h.snapshot?.tasks?.[key]||"Unknown");
  tasks[key]=ALLOWED_TASK_STATES.has(value)?value:"Unknown";
 }
 const count=h.snapshot?.server?.processCount;
 return {
  connected:h.connected===true,
  receivedAt:h.receivedAt||null,
  ageSeconds:Number.isInteger(h.ageSeconds)?h.ageSeconds:null,
  stale:h.connected!==true,
  server:{processCount:Number.isInteger(count)&&count>=0&&count<=50?count:null,
          rconOwnedByGame:h.snapshot?.server?.rconOwnedByGame===true},
  tasks,
  // No logs, PID, job details, lease tokens, owner identity, player data or write gates.
  source:"binarylane-management-heartbeat",
  readOnly:true
 };
}
router.get("/status",authenticate,(_req,res)=>{
 try{return res.json(shape());}
 catch(err){console.error("[hvs-readonly] status failed:",err.message);return res.status(503).json({error:"Status unavailable"});}
});
// Explicitly reject all non-GET requests to this scope; no shared agent or
// owner router is mounted beneath this path.
router.all("*",(_req,res)=>res.status(405).json({error:"Method not allowed"}));
module.exports={router,configured,shape};
