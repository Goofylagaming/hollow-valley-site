"use strict";
const express=require("express");
const {requireAuth}=require("../middleware/requireAuth");
const recruitment=require("../services/groupRecruitment");
const router=express.Router();
function requireOrigin(req,res,next) {
  const origin=req.get("Origin");
  let expected;
  try {expected=process.env.PUBLIC_SITE_URL?new URL(process.env.PUBLIC_SITE_URL).origin:
    req.protocol+"://"+req.get("Host");}
  catch{return res.status(500).json({error:"Website origin unavailable."});}
  if(!origin||origin!==expected)return res.status(403).json({error:"Use the Hollow Valley website to manage recruitment."});
  if(!req.is("application/json"))return res.status(415).json({error:"Use JSON for recruitment requests."});
  return next();
}
function respond(res,e) {
  const status=e.code==="NOT_FOUND"?404 :
    e.code==="INTEREST_LIMIT"?429 :
    ["ALREADY_GROUPED","ALREADY_APPLIED","GROUP_FULL","ALREADY_REVIEWED","NOT_RECRUITING"].includes(e.code)?409 :
    e.code==="GROUP_OWNER_REQUIRED"||e.code==="STEAM_REQUIRED"?403 :
    ["INVALID_LISTING","INVALID_MESSAGE","INVALID_GROUP","INVALID_DECISION"].includes(e.code)?400:500;
  if(status===500)console.error("[group-recruitment] failed",e);
  return res.status(status).json({code:status===500?"RECRUITMENT_UNAVAILABLE":e.code,
    error:status===500?"Group recruitment is temporarily unavailable.":e.message});
}
router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/", (req,res)=>{
  try{return res.json({groups:recruitment.browse(req.query),websiteGroupsOnly:true});}
  catch(e){return respond(res,e);}
});
router.get("/me",requireAuth,(req,res)=>{
  try{return res.json(recruitment.myInfo(req.user));}
  catch(e){return respond(res,e);}
});
router.put("/me",requireAuth,requireOrigin,(req,res)=>{
  try{return res.json(recruitment.upsertListing(req.user,req.body));}
  catch(e){return respond(res,e);}
});
router.post("/:groupId/interest",requireAuth,requireOrigin,(req,res)=>{
  try{return res.status(201).json(recruitment.apply(req.user,req.params.groupId,req.body?.message));}
  catch(e){return respond(res,e);}
});
router.post("/me/interest/:id/decision",requireAuth,requireOrigin,(req,res)=>{
  try{return res.json(recruitment.decide(req.user,req.params.id,req.body?.decision));}
  catch(e){return respond(res,e);}
});
router.post("/me/interest/:id/cancel",requireAuth,requireOrigin,(req,res)=>{
  try{return res.json(recruitment.cancel(req.user,req.params.id));}
  catch(e){return respond(res,e);}
});
module.exports=router;
