"use strict";
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
function createRouter({db=require('../db').db,now=Date.now}={}){
 const router=require('express').Router(),enabled=()=>process.env.EVENT_ENGINE_ENABLED==='1'&&process.env.EVENT_ENGINE_SCHEDULES_ENABLED==='1'&&process.env.EVENT_ENGINE_REGISTRATION_ENABLED==='1',readOnly=()=>process.env.EVENT_ENGINE_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
 const writable=()=>{if(readOnly())throw Object.assign(new Error('This preview cannot change event registration'),{status:403});};
 const store=require('../services/eventRegistrationStore').createEventRegistrationStore(db,{now,enabled,writable}),run=fn=>(req,res)=>{try{res.json(fn(req));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Event registration is temporarily unavailable'});}};
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 router.get('/capabilities',run(()=>({enabled:enabled(),readOnly:readOnly(),rewardsEnabled:false,attendanceConfirmed:false})));
 router.use((req,res,next)=>{try{store.player(req.user);next();}catch(e){res.status(e.status).json({error:e.message});}});
 router.use((req,res,next)=>{if(req.method==='GET')return next();try{writable();}catch(e){return res.status(e.status).json({error:e.message});}if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('sec-fetch-site')==='cross-site'||!req.is('application/json'))return res.status(403).json({error:'Use same-origin JSON to manage registration'});next();});
 const before=value=>value===undefined?null:/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;
 router.get('/me',run(req=>store.mine(req.user,{before:before(req.query.before)})));
 router.get('/:id/history',run(req=>store.history(req.user,req.params.id,{before:before(req.query.before)})));
 router.get('/:id',run(req=>store.current(req.user,req.params.id)));
 router.post('/:id',run(req=>{if(!req.body||Array.isArray(req.body)||Object.hasOwn(req.body,'eventId'))throw Object.assign(new Error('Use the displayed event identity'),{status:400});return store.change(req.user,{...req.body,eventId:req.params.id});}));
 return router;
}
module.exports={createRouter};
