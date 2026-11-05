const express=require('express');
const {requireAdmin,requireAuth}=require('../middleware/requireAuth');
const {skinMutationGuard}=require('../middleware/skinStudioSafety');
const client=require('../services/premiumSkinClient');
const router=express.Router();
router.use(skinMutationGuard);
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.use((req,res,next)=>{
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('origin')) {
    try {if(new URL(req.get('origin')).host!==req.get('host'))return res.status(403).json({error:'Use Hollow Valley Skin Studio to manage this collection.',code:'ORIGIN_MISMATCH'});}
    catch{return res.status(403).json({error:'Invalid request origin.',code:'ORIGIN_MISMATCH'});}
  }
  next();
});
function actor(req,res,next) {
  if (!/^\d{17}$/.test(String(req.user?.steam_id||''))) return res.status(409).json({error:'Link Steam before managing premium skins.'});
  next();
}
async function respond(res,action,successStatus=200) {
  try {return res.status(successStatus).json(await action());}
  catch(error) {return res.status(Number.isInteger(error.status)?error.status:502).json({error:error.message||'Premium skins are temporarily unavailable.',code:error.code||null});}
}
router.get('/',(req,res)=>respond(res,()=>client.listCatalog(req.user?.steam_id||null)));
router.get('/collections',requireAuth,actor,(req,res)=>respond(res,()=>client.listCollections(req.user.steam_id)));
router.get('/admin',requireAdmin,actor,(req,res)=>respond(res,()=>client.listAdmin(req.user.steam_id)));
router.post('/admin/seed-drafts',requireAdmin,actor,(req,res)=>respond(res,()=>client.seedDrafts(req.user.steam_id),201));
router.post('/admin/drafts',requireAdmin,actor,(req,res)=>respond(res,()=>client.draftFromPreset({actorSteamId:req.user.steam_id,presetId:req.body?.presetId,collection:req.body?.collection}),201));
router.put('/admin/:skinId',requireAdmin,actor,(req,res)=>respond(res,()=>client.updateDraft({skinId:req.params.skinId,actorSteamId:req.user.steam_id,species:req.body?.species,name:req.body?.name,description:req.body?.description,skin:req.body?.skin})));
router.post('/admin/:skinId/verify',requireAdmin,actor,(req,res)=>respond(res,()=>client.verifyDraft({skinId:req.params.skinId,actorSteamId:req.user.steam_id,verifiedSpecies:req.body?.verifiedSpecies,note:req.body?.note,confirmedInGame:req.body?.confirmedInGame,expectedVersion:req.body?.expectedVersion})));
router.post('/admin/:skinId/publish',requireAdmin,actor,(req,res)=>respond(res,()=>client.setPublished({skinId:req.params.skinId,actorSteamId:req.user.steam_id,published:req.body?.published})));
module.exports=router;
