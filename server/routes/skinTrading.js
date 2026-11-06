'use strict';
const express=require('express');
function createSkinTradingRouter({db,client=require('../services/skinTradingClient'),enabled=()=>process.env.SKIN_TRADING_ENABLED==='1',readOnly=()=>require('../middleware/skinStudioSafety').getSkinStudioSafety().readOnly||/^(1|true)$/i.test(process.env.SKIN_TRADING_READ_ONLY||'')}={}){
 const router=express.Router(),fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 function actor(req){if(!req.user)fail(401,'Sign in to use skin trading');const user=req.user;if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id))fail(403,'A current linked Steam account is required');const saved=db.prepare('SELECT id,steam_id FROM users WHERE id=?').get(user.id);if(!saved||saved.steam_id!==user.steam_id)fail(403,'Your account changed; reload this page');return {steamId:saved.steam_id,binding:saved.id+':'+saved.steam_id};}
 const respond=(res,error)=>res.status([400,401,403,404,409,429,503].includes(error.status)?error.status:502).json({error:error.status&&error.status<500?error.message:error.status===503?'Skin trading is unavailable':'The trading service could not confirm this request. Check its status before retrying.'});
 router.get('/capabilities',(req,res)=>{try{if(Object.keys(req.query).length)fail(400,'Trading queries do not accept account overrides');const user=actor(req);res.json({enabled:Boolean(enabled()),readOnly:Boolean(readOnly()),traderBinding:user.binding});}catch(error){respond(res,error);}});
 const operations={list:['own','before','limit'],eligible:['before'],history:['before','limit'],receipt:['requestId'],offerReceipt:['requestId'],ownListing:['id'],offer:['presetId','price','requestId'],buy:['id','expectedRevision','expectedPrice','requestId'],cancel:['id','expectedRevision']};
 for(const [action,fields]of Object.entries(operations))router.post('/'+action,async(req,res)=>{
  try{
   const user=actor(req),mutation=['offer','buy','cancel'].includes(action),newTrade=['offer','buy','eligible'].includes(action);
   if(req.get('X-Skin-Trader')!==user.binding)fail(403,'Reload trading for your current account');
   if(req.get('origin')!==req.protocol+'://'+req.get('host')||!req.is('application/json'))fail(403,'Use the website to manage skin trading');
   if(!req.body||Array.isArray(req.body)||Object.keys(req.query).length||Object.keys(req.body).some(key=>!fields.includes(key)))fail(400,'Invalid trading request');
   if((newTrade||action==='list'&&req.body.own!==true)&&!enabled())fail(503,'New skin trading is unavailable');
   if(mutation&&readOnly())fail(403,'Trading changes are unavailable in this preview');
   const result=await client.call(action,{steamId:user.steamId,...Object.fromEntries(fields.filter(key=>Object.hasOwn(req.body,key)).map(key=>[key,req.body[key]]))});
   if(actor(req).binding!==user.binding)fail(403,'Your account changed; reload this page');
   if(mutation&&readOnly())fail(403,'This preview changed; check saved status before retrying');
   if(newTrade&&!enabled())fail(503,'Trading was paused; check saved status before retrying');
   return res.json({...result,traderBinding:user.binding});
  }catch(error){return respond(res,error);}
 });
 return router;
}
let router;const defaultRouter=(req,res,next)=>{router ||= createSkinTradingRouter({db:require('../db').db});return router(req,res,next);};
module.exports=defaultRouter;module.exports.createSkinTradingRouter=createSkinTradingRouter;
