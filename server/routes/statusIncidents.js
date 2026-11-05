"use strict";
const {createStatusIncidentStore,COMPONENTS,STATES}=require('../services/statusIncidentStore');
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
function createRouters({db=require('../db').db,now=Date.now}={}){
 const express=require('express'),publicRouter=express.Router(),adminRouter=express.Router();
 const enabled=()=>process.env.STATUS_INCIDENTS_ENABLED==='1',management=()=>enabled()||process.env.STATUS_INCIDENTS_MANAGEMENT_ENABLED==='1',published=()=>process.env.STATUS_INCIDENTS_PUBLIC_ENABLED==='1';
 const readOnly=()=>process.env.STATUS_INCIDENTS_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
 const store=createStatusIncidentStore(db,{now,writable:action=>{if(readOnly())throw Object.assign(new Error('This preview cannot change incident reports'),{status:403});if(!enabled()&&!(management()&&action==='withdraw'))throw Object.assign(new Error('Incident publishing is paused'),{status:503});}});
 const run=fn=>(req,res)=>{try{res.json(fn(req));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Incident reports are temporarily unavailable'});}};
 const before=value=>value===undefined?null:typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;
 publicRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 publicRouter.get('/capabilities',run(()=>({available:published(),source:'staff-reviewed',independentMonitoring:false})));
 publicRouter.use((_req,res,next)=>published()?next():res.status(503).json({error:'Incident history is not available'}));
 publicRouter.get('/',run(req=>store.publicList({before:before(req.query.before)})));
 adminRouter.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 adminRouter.use((req,res,next)=>{try{store.admin(req.user);next();}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Staff access could not be checked'});}});
 adminRouter.get('/capabilities',run(()=>({enabled:enabled(),managementAvailable:management(),readOnly:readOnly(),components:COMPONENTS,statuses:STATES,evidenceConfigured:/^\d{10,24}$/.test(process.env.STATUS_INCIDENTS_EVIDENCE_GUILD_ID||''),automaticallyVerified:false})));
 adminRouter.use((_req,res,next)=>management()?next():res.status(503).json({error:'Incident management is not available'}));
 adminRouter.use((req,res,next)=>{if(req.method==='GET')return next();if(readOnly())return res.status(403).json({error:'This preview cannot change incident reports'});if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||req.get('sec-fetch-site')==='cross-site'||!req.is('application/json'))return res.status(403).json({error:'Use same-origin JSON to manage incident reports'});next();});
 adminRouter.get('/',run(req=>store.list(req.user,{before:before(req.query.before)})));
 adminRouter.get('/:id/history',run(req=>store.history(req.user,req.params.id,{before:before(req.query.before)})));
 adminRouter.get('/:id',run(req=>store.read(req.user,req.params.id)));
 adminRouter.post('/:id',run(req=>{if(!req.body||Array.isArray(req.body)||Object.hasOwn(req.body,'id'))throw Object.assign(new Error('Review the incident fields first'),{status:400});return store.change(req.user,{...req.body,id:req.params.id});}));
 return {publicRouter,adminRouter};
}
module.exports={createRouters};
