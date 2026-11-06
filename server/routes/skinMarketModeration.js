'use strict';
const express=require('express');
function createSkinMarketModerationRouter({db,client=require('../services/skinTradingClient'),enabled=()=>process.env.SKIN_TRADING_MANAGEMENT_ENABLED==='1',readOnly=()=>require('../middleware/skinStudioSafety').getSkinStudioSafety().readOnly||/^(1|true)$/i.test(process.env.SKIN_TRADING_READ_ONLY||'')}={}){
 const router=express.Router(),fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 function actor(req){if(!req.user)fail(401,'Sign in as staff');const user=req.user;if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id)||!db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=? AND is_admin=1').get(user.id,user.steam_id))fail(403,'Current linked staff access is required');return {steamId:user.steam_id,binding:user.id+':'+user.steam_id};}
 const error=(res,value)=>res.status([400,401,403,404,409,503].includes(value.status)?value.status:502).json({error:value.status&&value.status<500?value.message:value.status===503?'Skin market management is unavailable':'The review outcome could not be confirmed. Check its saved receipt before retrying.'});
 router.get('/capabilities',(req,res)=>{try{const user=actor(req);if(Object.keys(req.query).length)fail(400,'Account overrides are not accepted');return res.json({enabled:Boolean(enabled()),readOnly:Boolean(readOnly()),reviewerBinding:user.binding});}catch(value){return error(res,value);}});
 const fields={read:['id'],receipt:['requestId'],change:['action','target','active','expectedRevision','reason','requestId']};
 for(const [action,allowed]of Object.entries(fields))router.post('/'+action,async(req,res)=>{try{
  const user=actor(req);if(!enabled())fail(503,'Skin market management is disabled');if(req.get('X-Skin-Market-Reviewer')!==user.binding)fail(403,'Reload this page for the current staff account');
  if(req.get('origin')!==req.protocol+'://'+req.get('host')||!req.is('application/json'))fail(403,'Use the staff page for market reviews');
  if(!req.body||Array.isArray(req.body)||Object.keys(req.query).length||Object.keys(req.body).some(key=>!allowed.includes(key)))fail(400,'Invalid review request');
  if(action==='change'&&readOnly())fail(403,'This preview cannot change the skin market');
  const result=await client.callAdmin(action,{reviewerSteamId:user.steamId,...Object.fromEntries(allowed.filter(key=>Object.hasOwn(req.body,key)).map(key=>[key,req.body[key]]))});
  if(actor(req).binding!==user.binding)fail(403,'Your staff account changed. Reload this page');if(!enabled())fail(503,'Market management was paused. Check the saved receipt before retrying');if(action==='change'&&readOnly())fail(403,'The preview changed. Check the saved receipt before retrying');
  return res.json({...result,reviewerBinding:user.binding});
 }catch(value){return error(res,value);}});
 return router;
}
let router;const defaultRouter=(req,res,next)=>{router ||= createSkinMarketModerationRouter({db:require('../db').db});return router(req,res,next);};
module.exports=defaultRouter;module.exports.createSkinMarketModerationRouter=createSkinMarketModerationRouter;
