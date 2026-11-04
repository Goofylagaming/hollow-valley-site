// Mounted below the existing website bearer-token middleware. Browser requests
// never reach this router directly; membership quota checks live on the website.
const express = require('express');
const premium = require('../services/premiumSkinService');
const router = express.Router();
router.use((_req,res,next) => {res.set('Cache-Control','private, no-store');next();});
function respond(res,action,successStatus=200) {
  try { return res.status(successStatus).json(action()); }
  catch(error) { return res.status(error.status || 400).json({error:error.message,code:error.code || 'PREMIUM_SKIN_ERROR'}); }
}
router.get('/catalog',(req,res)=>respond(res,()=>premium.listCatalog(req.query.steamId || null)));
router.get('/admin',(req,res)=>respond(res,()=>premium.listCatalog(req.query.steamId || null,{admin:true})));
router.post('/fulfill',(req,res)=>respond(res,()=>premium.fulfillClaim({claimId:req.body?.claimId,steamId:req.body?.steamId,skinId:req.body?.skinId})));
router.post('/admin/seed-drafts',(req,res)=>respond(res,()=>premium.seedDrafts({ownerSteamId:req.body?.actorSteamId}),201));
router.post('/admin/drafts',(req,res)=>respond(res,()=>premium.draftFromPreset({ownerSteamId:req.body?.actorSteamId,presetId:req.body?.presetId,collection:req.body?.collection}),201));
router.put('/admin/:skinId',(req,res)=>respond(res,()=>premium.updateDraft({skinId:req.params.skinId,actorSteamId:req.body?.actorSteamId,species:req.body?.species,name:req.body?.name,description:req.body?.description,skin:req.body?.skin})));
router.post('/admin/:skinId/verify',(req,res)=>respond(res,()=>premium.verifyDraft({skinId:req.params.skinId,actorSteamId:req.body?.actorSteamId,verifiedSpecies:req.body?.verifiedSpecies,note:req.body?.note,confirmedInGame:req.body?.confirmedInGame,expectedVersion:req.body?.expectedVersion})));
router.post('/admin/:skinId/publish',(req,res)=>respond(res,()=>premium.setPublished({skinId:req.params.skinId,actorSteamId:req.body?.actorSteamId,published:req.body?.published})));
module.exports=router;
