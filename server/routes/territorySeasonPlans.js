'use strict';
const express=require('express');
const {createTerritorySeasonPlans}=require('../services/territorySeasonPlans');
function createTerritorySeasonPlansRouter({db,enabled=()=>process.env.TERRITORY_SEASON_PLANS_ENABLED==='1',readOnly=()=>require('../middleware/skinStudioSafety').getSkinStudioSafety().readOnly,now=Date.now}={}){
 const router=express.Router();let service;
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 const storage=()=>db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN('territory_season_plans','territory_season_plan_edits')").get().n===2;
 function actor(req){const user=req.user;if(!user)fail(401,'Sign in with a staff account');if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id))fail(403,'A current linked staff account is required');const saved=db.prepare('SELECT steam_id,is_admin FROM users WHERE id=?').get(user.id);if(!saved||saved.steam_id!==user.steam_id||saved.is_admin!==1)fail(403,'Current staff access is required');return {id:user.id,steamId:saved.steam_id,binding:user.id+':'+saved.steam_id};}
 const get=(allowInitialize=true)=>{const initialize=allowInitialize&&!storage()&&enabled()&&!readOnly();if(!service||initialize)service=createTerritorySeasonPlans(db,{enabled,readOnly,now,initialize});return service;};
 const error=(res,value)=>res.status([400,401,403,404,409,429,503].includes(value.status)?value.status:503).json({error:value.status&&value.status<500?value.message:'Season planning is unavailable'});
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 router.get('/capabilities',(req,res)=>{try{const user=actor(req);if(Object.keys(req.query).length)fail(400,'Season planning does not accept account overrides');res.json({enabled:Boolean(enabled()),readOnly:Boolean(readOnly()),historyAvailable:storage(),actorBinding:user.binding});}catch(value){error(res,value);}});
 const fields={read:[],prepare:null,confirm:['offer','requestId'],receipt:['requestId'],evidence:['seasonId'],resetInspection:['seasonId','targetEventIds']};
 for(const [action,allowed] of Object.entries(fields))router.post('/'+action,(req,res)=>{try{
  const user=actor(req);if(req.get('X-Season-Planner')!==user.binding)fail(403,'Refresh season planning for your current account');
  if(req.get('origin')!==req.protocol+'://'+req.get('host')||!req.is('application/json'))fail(403,'Use the staff page to review season plans');
  if(!req.body||Array.isArray(req.body)||Object.keys(req.query).length||allowed&&Object.keys(req.body).some(key=>!allowed.includes(key)))fail(400,'Invalid season planning request');
  if(['prepare','confirm'].includes(action)&&readOnly())fail(403,'This preview cannot change season plans');
  const core=get(action==='read'||action==='prepare');let result;if(action==='read')result=core.list(user);else if(action==='prepare')result=core.prepare(user,req.body);else if(action==='confirm')result=core.confirm(user,req.body.offer,req.body.requestId);else if(action==='evidence')result=require('../services/territorySeasonEvidence').createTerritorySeasonEvidence(db,{plans:core,now}).read(user,req.body.seasonId);else if(action==='resetInspection')result=require('../services/territorySeasonResetInspection').createTerritorySeasonResetInspection(db,{plans:core,now}).read(user,req.body.seasonId,req.body.targetEventIds);else result=core.receipt(user,req.body.requestId);
  if(actor(req).binding!==user.binding)fail(403,'Staff access changed. Refresh this page');return res.json({...result,actorBinding:user.binding});
 }catch(value){return error(res,value);}});
 return router;
}
let router;module.exports=(req,res,next)=>{router ||= createTerritorySeasonPlansRouter({db:require('../db').db});return router(req,res,next);};
module.exports.createTerritorySeasonPlansRouter=createTerritorySeasonPlansRouter;
