// Mounted only below the website bearer-token middleware. The website binds
// the Steam identity and admin role from its authenticated session.
const router=require('express').Router();let service;
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');if(process.env.SKIN_PROMO_CODES_ENABLED!=='1')return res.status(503).json({error:'Promotional skin codes are not enabled'});next();});
const get=()=>service||(service=require('../services/skinPromoService').createSkinPromoService(require('../services/economyStore')));
const run=fn=>(req,res)=>{try{res.json(fn(req));}catch(e){res.status(e.status||400).json({error:e.message});}};
const admin=req=>({steam_id:req.body?.actorSteamId,is_admin:true});
router.post('/admin/list',run(req=>get().list(admin(req))));
router.post('/admin/issue',run(req=>get().issue(admin(req),req.body)));
router.post('/admin/revoke',run(req=>get().revoke(admin(req),req.body)));
router.post('/redeem',run(req=>get().redeem({steam_id:req.body?.steamId},{code:req.body?.code})));
module.exports=router;
