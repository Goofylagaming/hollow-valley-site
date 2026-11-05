const router=require('express').Router();
const {requireAuth,requireAdmin}=require('../middleware/requireAuth');
const {skinMutationGuard}=require('../middleware/skinStudioSafety');
const client=require('../services/skinPromoClient');
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');if(process.env.SKIN_PROMO_CODES_ENABLED!=='1')return res.status(503).json({error:'Promotional skin codes are not enabled'});next();});
router.use(requireAuth);
router.use((req,res,next)=>{if(!/^\d{17}$/.test(String(req.user?.steam_id||'')))return res.status(403).json({error:'A linked Steam account is required'});next();});
router.use(skinMutationGuard);
router.use((req,res,next)=>{
  if(req.method!=='GET'&&(req.get('origin')!==`${req.protocol}://${req.get('host')}`||!req.is('application/json')))return res.status(403).json({error:'Use the website to manage promotional codes'});
  next();
});
const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status||502).json({error:e.message||'Promotional codes are temporarily unavailable'});}};
router.get('/admin',requireAdmin,run(req=>client.list({actorSteamId:req.user.steam_id})));
router.post('/admin/issue',requireAdmin,run(req=>client.issue({actorSteamId:req.user.steam_id,presetId:req.body?.presetId,code:req.body?.code,reason:req.body?.reason,expiresAt:req.body?.expiresAt,requestId:req.body?.requestId})));
router.post('/admin/revoke',requireAdmin,run(req=>client.revoke({actorSteamId:req.user.steam_id,id:req.body?.id,reason:req.body?.reason})));
router.post('/redeem',run(req=>client.redeem({steamId:req.user.steam_id,code:req.body?.code})));
module.exports=router;
