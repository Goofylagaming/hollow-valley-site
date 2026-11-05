const router=require('express').Router();
const {requireAuth}=require('../middleware/requireAuth');
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
const automation=require('../services/automationWebsiteClient');
const readOnly=()=>process.env.JOURNEY_HISTORY_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.get('/capabilities',(_req,res)=>res.json({enabled:process.env.JOURNEY_HISTORY_ENABLED==='1'&&process.env.VALLEY_LEGACY_ENABLED==='1',readOnly:readOnly()}));
router.use((_req,res,next)=>process.env.JOURNEY_HISTORY_ENABLED==='1'&&process.env.VALLEY_LEGACY_ENABLED==='1'?next():res.status(503).json({error:'Journey history is not enabled'}));
router.use(requireAuth);
router.use((req,res,next)=>/^\d{17}$/.test(String(req.user?.steam_id||''))?next():res.status(403).json({error:'A linked Steam account is required'}));
router.use((req,res,next)=>{
  if(req.method==='GET')return next();
  if(readOnly())return res.status(403).json({error:'This preview cannot change journey history'});
  if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||!req.is('application/json'))return res.status(403).json({error:'Use the website to manage journey history'});
  next();
});
const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status||502).json({error:e.status?e.message:'Journey history is temporarily unavailable'});}};
const call=(req,action,body={})=>automation.legacyRequest('/journeys/'+action,{method:'POST',body:{...body,steamId:req.user.steam_id}});
router.get('/settings',run(req=>call(req,'settings')));
router.get('/points',run(req=>{
  const raw=req.query.before;
  if(raw!==undefined&&(typeof raw!=='string'||!/^\d{1,16}$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1))throw Object.assign(new Error('Invalid history cursor'),{status:400});
  return call(req,'points',raw===undefined?{}:{before:Number(raw)});
}));
router.post('/settings',run(req=>call(req,'change',{enabled:req.body?.enabled,expectedRevision:req.body?.expectedRevision,erase:false})));
router.post('/delete',run(req=>call(req,'change',{enabled:false,expectedRevision:req.body?.expectedRevision,erase:true})));
module.exports=router;
