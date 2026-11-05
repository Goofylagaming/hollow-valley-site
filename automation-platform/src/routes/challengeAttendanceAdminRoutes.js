"use strict";
const router=require('express').Router();
const {requireAdminToken}=require('../middleware/adminAuth');
const legacy=require('../services/valleyLegacyService');
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.use(requireAdminToken);
router.use((req,res,next)=>{
  if(process.env.DYNAMIC_CHALLENGES_ENABLED!=='1'||process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED!=='1')return res.status(503).json({error:'Event challenge evidence is disabled'});
  if(!req.is('application/json'))return res.status(400).json({error:'JSON is required'});
  next();
});
const run=fn=>(req,res)=>{try{res.json(fn(req,legacy.get().challenges.attendance));}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Attendance evidence is temporarily unavailable'});}};
const writeGuard=(_req,res,next)=>process.env.DYNAMIC_CHALLENGES_READ_ONLY==='1'?res.status(403).json({error:'Attendance evidence is read-only'}):next();
router.post('/current',run((req,store)=>store.current(req.body?.eventId,req.body?.steamId)));
router.post('/review',writeGuard,run((req,store)=>store.review(req.body)));
router.post('/change',writeGuard,run((req,store)=>store.change(req.body)));
module.exports=router;
