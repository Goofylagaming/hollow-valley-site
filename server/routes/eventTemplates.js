"use strict";
const {createEventTemplateStore,KINDS}=require('../services/eventTemplateStore');
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
function createRouter({db=require('../db').db,now=Date.now}={}){
  const router=require('express').Router(),enabled=()=>process.env.EVENT_ENGINE_ENABLED==='1';
  const readOnly=()=>process.env.EVENT_ENGINE_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
  const writable=()=>{if(!enabled())throw Object.assign(new Error('Event template builder is disabled'),{status:503});if(readOnly())throw Object.assign(new Error('This preview cannot change event templates'),{status:403});};
  const store=createEventTemplateStore(db,{now,writable});
  const run=fn=>(req,res)=>{try{res.json(fn(req));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Event templates are temporarily unavailable'});}};
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.use((req,res,next)=>{try{store.admin(req.user);next();}catch(e){res.status(e.status).json({error:e.message});}});
  router.get('/capabilities',run(()=>({enabled:enabled(),readOnly:readOnly(),kinds:KINDS,executionEnabled:false,rewardsEnabled:false})));
  router.use((_req,res,next)=>enabled()?next():res.status(503).json({error:'Event template builder is disabled'}));
  router.use((req,res,next)=>{
    if(req.method==='GET')return next();
    try{writable();}catch(e){return res.status(e.status).json({error:e.message});}
    if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('sec-fetch-site')==='cross-site'||!req.is('application/json'))return res.status(403).json({error:'Use same-origin JSON to manage templates'});
    next();
  });
  const before=value=>value===undefined?null:/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;
  router.get('/',run(req=>store.list(req.user,{before:before(req.query.before),includeArchived:req.query.archived==='1'})));
  router.get('/:id/history',run(req=>store.history(req.user,req.params.id,{before:before(req.query.before)})));
  router.get('/:id',run(req=>store.read(req.user,req.params.id)));
  router.post('/:id',run(req=>{
    if(!req.body||Array.isArray(req.body)||Object.keys(req.body).some(k=>!['expectedRevision','requestKey','action','details'].includes(k)))throw Object.assign(new Error('Only reviewed template fields are accepted'),{status:400});
    return store.change(req.user,{...req.body,id:req.params.id});
  }));
  return router;
}
module.exports={createRouter};
