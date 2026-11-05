// Website bearer-token middleware authenticates this internal router.
const router=require('express').Router();let service;
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');if(process.env.SKIN_GIFTING_ENABLED!=='1')return res.status(503).json({error:'Skin gifting is not enabled'});next();});
const get=()=>service||(service=require('../services/skinGiftService').createSkinGiftService(require('../services/economyStore')));
const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status||400).json({error:e.message});}};
const user=req=>({steam_id:req.body?.steamId});
router.post('/reconcile',run(req=>get().reconcile(user(req),{cursor:req.body?.cursor??0,parkedCursor:req.body?.parkedCursor??0})));
router.post('/list',run(req=>get().list(user(req))));
router.post('/eligible',run(req=>get().eligible(user(req))));
router.post('/offer',run(req=>get().offer(user(req),{presetId:req.body?.presetId,recipientSteamId:req.body?.recipientSteamId,requestId:req.body?.requestId,note:req.body?.note})));
router.post('/decide',run(req=>get().decide(user(req),{id:req.body?.id,decision:req.body?.decision,expectedRevision:req.body?.expectedRevision})));
module.exports=router;
