"use strict";
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
const {createChallengeAttendanceHost}=require('../services/challengeAttendanceHost');
function createRouter({db=require('../db').db,client=require('../services/automationWebsiteClient').challengeAttendanceRequest,now=Date.now}={}) {
  const router=require('express').Router();
  const enabled=()=>process.env.DYNAMIC_CHALLENGES_ENABLED==='1'&&process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED==='1'&&process.env.VALLEY_LEGACY_ENABLED==='1';
  const readOnly=()=>process.env.DYNAMIC_CHALLENGES_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
  const writable=()=>{if(!enabled())throw Object.assign(new Error('Event challenge evidence is disabled'),{status:503});if(readOnly())throw Object.assign(new Error('This preview cannot change attendance evidence'),{status:403});};
  const host=createChallengeAttendanceHost(db,client,{now,writable});
  const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(error.status||502).json({error:error.status?error.message:'Attendance evidence is temporarily unavailable'});}};
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.use((req,res,next)=>{try{host.admin(req.user);next();}catch(e){res.status(e.status).json({error:e.message});}});
  router.get('/capabilities',(_req,res)=>res.json({enabled:enabled(),readOnly:readOnly(),rewardsEnabled:false}));
  router.use((_req,res,next)=>enabled()?next():res.status(503).json({error:'Event challenge evidence is disabled'}));
  router.use((req,res,next)=>{
    if(req.method==='GET')return next();
    try{writable();}catch(e){return res.status(e.status).json({error:e.message});}
    if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('sec-fetch-site')==='cross-site'||!req.is('application/json'))return res.status(403).json({error:'Use same-origin JSON to review attendance'});
    next();
  });
  router.get('/record',run(req=>host.inspect(req.user,{eventId:req.query.eventId,steamId:req.query.steamId})));
  router.post('/reviews',run(req=>host.review(req.user,req.body||{})));
  router.get('/reviews/:id',run(req=>host.read(req.user,req.params.id)));
  router.post('/reviews/:id/confirm',run(req=>{
    if(!req.body||Array.isArray(req.body)||Object.keys(req.body).length)throw Object.assign(new Error('Confirm the saved review without replacement fields'),{status:400});
    return host.confirm(req.user,req.params.id);
  }));
  return router;
}
module.exports={createRouter};
