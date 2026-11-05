"use strict";
const router=require('express').Router();
const {requireWebsiteToken}=require('../middleware/websiteAuth');
const legacy=require('../services/valleyLegacyService');
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.use(requireWebsiteToken);
const run=fn=>(req,res)=>{
  try {res.json(fn(req,legacy.get().challenges));}
  catch(error){res.status(error.status||500).json({error:error.status?error.message:'Dynamic challenges could not complete this request'});}
};
router.post('/status',run((req,store)=>store.status(req.body?.steamId)));
// Rollout pauses collection and enrollment, not a player's existing deletion
// choice. Authentication and read-only guards still apply to these requests.
router.use((req,res,next)=>process.env.DYNAMIC_CHALLENGES_ENABLED==='1'||req.body?.selected===false?next():res.status(503).json({error:'Dynamic challenges are not enabled'}));
router.post('/location',(req,res,next)=>process.env.DYNAMIC_CHALLENGES_READ_ONLY==='1'?res.status(403).json({error:'Location tracking is read-only'}):next(),
  run((req,store)=>store.locations.change(req.body?.steamId,{selected:req.body?.selected,expectedRevision:req.body?.expectedRevision,requestKey:req.body?.requestKey})));
router.post('/change',(req,res,next)=>process.env.DYNAMIC_CHALLENGES_READ_ONLY==='1'?res.status(403).json({error:'Challenge participation is read-only'}):next(),
  run((req,store)=>store.change(req.body?.steamId,{
    selected:req.body?.selected,expectedRevision:req.body?.expectedRevision,requestKey:req.body?.requestKey,
  })));
module.exports=router;
