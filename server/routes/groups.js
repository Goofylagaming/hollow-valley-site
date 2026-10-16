const express=require("express");
const { requireAuth }=require("../middleware/requireAuth");
const groups=require("../groupsStore");
const router=express.Router();
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
router.post("/",handle(req=>groups.createGroup(req.groupSteam,req.body?.name)));
router.post("/invites",handle(req=>groups.invite(req.groupSteam,req.body?.steamId)));
router.post("/invites/:id/accept",handle(req=>groups.actOnInvite(req.groupSteam,req.params.id,"accept")));
router.post("/invites/:id/decline",handle(req=>groups.actOnInvite(req.groupSteam,req.params.id,"decline")));
router.post("/invites/:id/cancel",handle(req=>groups.cancelInvite(req.groupSteam,req.params.id)));
router.post("/leave",handle(req=>groups.exitGroup(req.groupSteam)));
router.post("/remove",handle(req=>groups.exitGroup(req.groupSteam,req.body?.steamId)));
router.post("/disband",handle(req=>groups.disband(req.groupSteam)));
module.exports=router;