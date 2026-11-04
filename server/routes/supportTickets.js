"use strict";
const express=require("express");
const { requireAuth, requireAdmin }=require("../middleware/requireAuth");
const tickets=require("../services/supportTickets");
const router=express.Router();
function sameOriginJson(req,res,next) {
  let expected;
  try{expected=process.env.PUBLIC_SITE_URL?new URL(process.env.PUBLIC_SITE_URL).origin:
    req.protocol+"://"+req.get("Host");}
  catch{return res.status(500).json({error:"Website origin is misconfigured."});}
  if(!req.get("Origin") || req.get("Origin")!==expected)
    return res.status(403).json({error:"Use the Hollow Valley website to manage support tickets."});
  if(!req.is("application/json"))return res.status(415).json({error:"Support requests require JSON."});
  next();
}
function mapFailure(res,e) {
  const status=e.code==="NOT_FOUND"?404 : e.code==="TICKET_LIMIT"?429 :
    e.code==="TICKETS_DISABLED"?503 : e.code==="TICKET_CLOSED"?409 :
    ["ADMIN_REQUIRED","STEAM_REQUIRED"].includes(e.code)?403 :
    ["INVALID_TICKET","INVALID_REPLY","INVALID_EVIDENCE","INVALID_STATUS"].includes(e.code)?400 : 500;
  if(status===500)console.error("[support-tickets] failed",e);
  return res.status(status).json({code:status===500?"SUPPORT_UNAVAILABLE":e.code,
    error:status===500?"Support tickets are temporarily unavailable.":e.message});
}
router.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
router.get("/capabilities",(_req,res)=>{
  res.json({enabled:process.env.HV_SUPPORT_TICKETS_ENABLED==="true",evidence:"Links only; no file uploads", categories:tickets.CATEGORIES});
});
router.get("/mine",requireAuth,(req,res)=>{
  try{return res.json({tickets:tickets.mine(req.user)});}
  catch(e){return mapFailure(res,e);}
});
router.post("/",requireAuth,sameOriginJson,(req,res)=>{
  try{const out=tickets.create(req.user,req.body);return res.status(out.duplicate?200:201).json(out);}
  catch(e){return mapFailure(res,e);}
});
router.get("/mine/:id",requireAuth,(req,res)=>{
  try{return res.json(tickets.view(req.params.id,req.user));}
  catch(e){return mapFailure(res,e);}
});
router.post("/mine/:id/replies",requireAuth,sameOriginJson,(req,res)=>{
  try{return res.json(tickets.reply(req.user,req.params.id,req.body));}
  catch(e){return mapFailure(res,e);}
});
router.get("/admin",requireAdmin,(req,res)=>{
  try{return res.json({tickets:tickets.adminQueue(req.user,req.query)});}
  catch(e){return mapFailure(res,e);}
});
router.get("/admin/:id",requireAdmin,(req,res)=>{
  try{return res.json(tickets.view(req.params.id,req.user));}
  catch(e){return mapFailure(res,e);}
});
router.post("/admin/:id/replies",requireAdmin,sameOriginJson,(req,res)=>{
  try{return res.json(tickets.reply(req.user,req.params.id,req.body));}
  catch(e){return mapFailure(res,e);}
});
router.post("/admin/:id/status",requireAdmin,sameOriginJson,(req,res)=>{
  try{return res.json(tickets.setStatus(req.user,req.params.id,req.body?.status));}
  catch(e){return mapFailure(res,e);}
});
module.exports=router;
