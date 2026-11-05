const express=require('express');
const {requireAdmin}=require('../middleware/requireAuth');
const automation=require('../services/automationWebsiteClient');
const router=express.Router();
router.use(requireAdmin);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
function failure(res,error) {
  const status=[400,404,409,503].includes(error.status)?error.status:502;
  res.status(status).json({error:status===502?'Achievement service unavailable. Retry with the same decision.':error.message});
}
router.get('/',async(_req,res)=>{
  try {res.json(await automation.getAchievementReviews());} catch(error){failure(res,error);}
});
router.post('/',async(req,res)=>{
  if(req.get('origin')!==`${req.protocol}://${req.get('host')}` || !req.is('application/json')) return res.status(403).json({error:'Same-origin JSON request required'});
  const actorSteamId=String(req.user.steam_id||'');
  if(!/^\d{17}$/.test(actorSteamId)) return res.status(403).json({error:'A linked admin Steam account is required'});
  const {requestId,steamId,achievementId,decision,reason,expectedRevision}=req.body||{};
  try {res.json(await automation.decideAchievementReview({requestId,steamId,achievementId,decision,reason,expectedRevision,actorSteamId}));}
  catch(error){failure(res,error);}
});
module.exports=router;
