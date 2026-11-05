const router=require('express').Router();
const {requireWebsiteToken}=require('../middleware/websiteAuth');
const legacy=require('../services/valleyLegacyService');
router.use(requireWebsiteToken);
router.use((_req,res,next)=>{
  res.set('Cache-Control','private, no-store');
  if(process.env.JOURNEY_HISTORY_ENABLED!=='1')return res.status(503).json({error:'Journey history is not enabled'});
  next();
});
const run=fn=>(req,res)=>{try{res.json(fn(req,legacy.get().journeys));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Journey history could not complete this request'});}};
router.post('/settings',run((r,s)=>s.settings(r.body?.steamId)));
router.post('/points',run((r,s)=>s.points(r.body?.steamId,{before:r.body?.before})));
router.post('/change',(req,res,next)=>process.env.JOURNEY_HISTORY_READ_ONLY==='1'?res.status(403).json({error:'Journey history is read-only'}):next(),run((r,s)=>s.change(r.body?.steamId,{enabled:r.body?.enabled,expectedRevision:r.body?.expectedRevision,erase:r.body?.erase??false})));
module.exports=router;
