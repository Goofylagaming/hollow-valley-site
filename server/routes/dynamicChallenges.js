"use strict";
const router=require('express').Router();
const {requireAuth}=require('../middleware/requireAuth');
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
const automation=require('../services/automationWebsiteClient');
const enabled=()=>process.env.DYNAMIC_CHALLENGES_ENABLED==='1'&&process.env.VALLEY_LEGACY_ENABLED==='1';
const readOnly=()=>process.env.DYNAMIC_CHALLENGES_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.get('/capabilities',(_req,res)=>res.json({enabled:enabled(),managementAvailable:process.env.VALLEY_LEGACY_ENABLED==='1',readOnly:readOnly(),rewardsEnabled:false}));
router.use((req,res,next)=>process.env.VALLEY_LEGACY_ENABLED==='1'&&(enabled()||req.method==='GET'||req.body?.selected===false)?next():res.status(503).json({error:'Dynamic challenges are not enabled'}));
router.use(requireAuth);
router.use((req,res,next)=>/^\d{17}$/.test(String(req.user?.steam_id||''))?next():res.status(403).json({error:'A linked Steam account is required'}));
router.use((req,res,next)=>{
  if(req.method==='GET')return next();
  if(readOnly())return res.status(403).json({error:'This preview cannot change challenge participation'});
  if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('sec-fetch-site')==='cross-site'||!req.is('application/json'))
    return res.status(403).json({error:'Use the website to manage challenge participation'});
  next();
});
const run=fn=>async(req,res)=>{
  try {res.json(await fn(req));}
  catch(error){res.status(error.status||502).json({error:error.status?error.message:'Dynamic challenges are temporarily unavailable'});}
};
const call=(req,path,body={})=>automation.legacyRequest('/challenges/'+path,{method:'POST',body:{...body,steamId:req.user.steam_id}});
router.get('/me',run(req=>call(req,'status')));
router.post('/location',run(req=>call(req,'location',{selected:req.body?.selected,expectedRevision:req.body?.expectedRevision,requestKey:req.body?.requestKey})));
router.post('/participation',run(req=>call(req,'change',{
  selected:req.body?.selected,expectedRevision:req.body?.expectedRevision,requestKey:req.body?.requestKey,
})));
module.exports=router;
