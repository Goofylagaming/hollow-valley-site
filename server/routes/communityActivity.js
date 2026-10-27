"use strict";
const express=require("express");
const {requireAuth,requireAdmin}=require("../middleware/requireAuth");
const activity=require("../services/communityActivity");
const router=express.Router();
function sameOriginJson(req,res,next){
  let expected;
  try{expected=process.env.PUBLIC_SITE_URL?new URL(process.env.PUBLIC_SITE_URL).origin:
    req.protocol+"://"+req.get("Host");}
  catch{return res.status(500).json({error:"Website origin is misconfigured."});}
  if(!req.get("Origin")||req.get("Origin")!==expected)
    return res.status(403).json({error:"Publish through the Hollow Valley website."});
  if(!req.is("application/json"))return res.status(415).json({error:"JSON is required."});
  next();
}
function errorResult(res,e) {
  const status=e.code==="ADMIN_REQUIRED"||e.code==="STEAM_REQUIRED"?403 :
    e.code==="EVENT_ALREADY_PUBLISHED"?409:
    ["INVALID_EVENT_RESULT","CONFIRM_REQUIRED"].includes(e.code)?400:500;
  if(status===500)console.error("[community-activity] failed",e);
  return res.status(status).json({error:status===500?"Community activity unavailable.":e.message,
    code:status===500?"ACTIVITY_UNAVAILABLE":e.code});
}
router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/",async(req,res)=>{
  try{return res.json(await activity.overview({hours:req.query.hours}));}
  catch(e){return errorResult(res,e);}
});
router.get("/pack-context",requireAuth,(req,res)=>{
  res.set("Cache-Control","private, no-store");
  try{return res.json(activity.packContext(req.user));}
  catch(e){return errorResult(res,e);}
});
router.get("/event-results",(_req,res)=>{
  try{return res.json({results:activity.publicResults(25)});}
  catch(e){return errorResult(res,e);}
});
router.post("/admin/event-results",requireAdmin,sameOriginJson,(req,res)=>{
  res.set("Cache-Control","private, no-store");
  try{return res.status(201).json({result:activity.publishResult(req.user,req.body)});}
  catch(e){return errorResult(res,e);}
});
module.exports=router;
