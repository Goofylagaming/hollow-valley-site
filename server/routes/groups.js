const express=require("express");
const { requireAuth }=require("../middleware/requireAuth");
const groups=require("../groupsStore");
const router=express.Router();
const automation=require('../services/automationWebsiteClient');
const closure=require('../services/groupTreasuryClosure').createGroupTreasuryClosure(require('../db').db,groups,{
 begin:body=>automation.groupTreasuryRequest('closure-begin',body),abort:body=>automation.groupTreasuryRequest('closure-abort',body),complete:body=>automation.groupTreasuryRequest('closure-complete',body),
});
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.use(requireAuth);
router.use((req,res,next)=>{
 const steam=String(req.user?.steam_id||"").trim();
 if(!/^\d{17}$/.test(steam))return res.status(403).json({error:"Link your Steam account before using Groups."});
 req.groupSteam=steam;
 next();
});
function handle(fn){return (req,res)=>{try{return res.json(fn(req));}catch(error){
 if(process.env.NODE_ENV!=="test"&&!(error.status>=400))console.error("[groups]",error);
 return res.status(Number(error.status)||500).json({error:error.status?error.message:"Could not complete Groups request."});
}};}
router.get("/",handle(req=>groups.getState(req.groupSteam)));
router.get("/progress",handle(req=>require("../groupProgress").getProgress(req.groupSteam)));
router.post("/",handle(req=>groups.createGroup(req.groupSteam,req.body?.name)));
router.post("/invites",handle(req=>groups.invite(req.groupSteam,req.body?.steamId)));
router.post("/invites/:id/accept",handle(req=>groups.actOnInvite(req.groupSteam,req.params.id,"accept")));
router.post("/invites/:id/decline",handle(req=>groups.actOnInvite(req.groupSteam,req.params.id,"decline")));
router.post("/invites/:id/cancel",handle(req=>groups.cancelInvite(req.groupSteam,req.params.id)));
const closureGuard=(req,res,next)=>req.get('origin')===`${req.protocol}://${req.get('host')}`&&req.is('application/json')?next():res.status(403).json({error:'Use the website to close a group'});
const asyncHandle=fn=>async(req,res)=>{try{res.set('Cache-Control','private, no-store').json(await fn(req));}catch(error){res.status(error.status||502).json({error:error.status?error.message:'The closure check is temporarily unavailable',code:error.code||null});}};
router.post("/leave",closureGuard,asyncHandle(req=>closure.close(req.groupSteam,'leave',{expectedGroupId:req.body?.expectedGroupId})));
router.post("/remove",handle(req=>groups.exitGroup(req.groupSteam,req.body?.steamId)));
router.post("/disband",closureGuard,asyncHandle(req=>closure.close(req.groupSteam,'disband',{expectedGroupId:req.body?.expectedGroupId})));
router.post('/closure/cancel',closureGuard,asyncHandle(req=>closure.cancel(req.groupSteam,{expectedGroupId:req.body?.expectedGroupId,requestId:req.body?.requestId})));
router.post('/closure/reconcile',closureGuard,asyncHandle(req=>closure.reconcile(req.groupSteam,{expectedGroupId:req.body?.expectedGroupId})));
module.exports=router;
