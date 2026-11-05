"use strict";
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
function createRouter({db=require('../db').db,now=Date.now}={}){
  const router=require('express').Router(),enabled=()=>process.env.EVENT_ENGINE_ENABLED==='1'&&process.env.EVENT_ENGINE_SCHEDULES_ENABLED==='1',readOnly=()=>process.env.EVENT_ENGINE_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
  const writable=()=>{if(!enabled())throw Object.assign(new Error('Website event scheduling is disabled'),{status:503});if(readOnly())throw Object.assign(new Error('This preview cannot change event schedules'),{status:403});};
  const store=require('../services/eventScheduleStore').createEventScheduleStore(db,{now,writable}),run=fn=>(req,res)=>{try{res.json(fn(req));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Event schedules are temporarily unavailable'});}};
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.get('/public',run(req=>{
    if(!enabled())return {enabled:false,events:[],next:null,checkedAt:now()};
    const supplied=req.query.afterTime!==undefined||req.query.afterId!==undefined;
    const after=supplied?{startsAt:/^\d+$/.test(req.query.afterTime||'')?Number(req.query.afterTime):NaN,id:req.query.afterId}:null;
    return {enabled:true,registrationEnabled:process.env.EVENT_ENGINE_REGISTRATION_ENABLED==='1',...store.published({after})};
  }));
  router.use((req,res,next)=>{try{store.admin(req.user);next();}catch(e){res.status(e.status).json({error:e.message});}});
  router.get('/capabilities',run(()=>({enabled:enabled(),readOnly:readOnly(),gameExecutionEnabled:false,rewardsEnabled:false})));
  router.use((_req,res,next)=>enabled()?next():res.status(503).json({error:'Website event scheduling is disabled'}));
  router.use((req,res,next)=>{if(req.method==='GET')return next();try{writable();}catch(e){return res.status(e.status).json({error:e.message});}if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('sec-fetch-site')==='cross-site'||!req.is('application/json'))return res.status(403).json({error:'Use same-origin JSON to manage event schedules'});next();});
  const before=value=>value===undefined?null:/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;
  router.get('/',run(req=>store.list(req.user,{before:before(req.query.before)})));
  router.get('/:id/history',run(req=>store.history(req.user,req.params.id,{before:before(req.query.before)})));
  router.get('/:id',run(req=>store.read(req.user,req.params.id)));
  router.post('/:id',run(req=>{if(!req.body||Array.isArray(req.body)||Object.hasOwn(req.body,'eventId'))throw Object.assign(new Error('Use the displayed event identity'),{status:400});return store.change(req.user,{...req.body,eventId:req.params.id});}));
  return router;
}
module.exports={createRouter};
