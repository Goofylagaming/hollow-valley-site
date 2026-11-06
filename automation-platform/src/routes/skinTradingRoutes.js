'use strict';
const express=require('express'),{requireWebsiteToken}=require('../middleware/websiteAuth');
function createSkinTradingRouter({getService=null,getStore=()=>require('../services/economyStore'),enabled=()=>process.env.SKIN_TRADING_ENABLED==='1'&&process.env.SKIN_SYSTEM_ENABLED==='true',readOnly=()=>/^(1|true)$/i.test(process.env.SKIN_TRADING_READ_ONLY||'')}={}){
 const router=express.Router();let service;
 const get=()=>{
  if(service)return service;if(getService)return service=getService();
  const store=getStore(),initialize=Boolean(enabled()&&!readOnly());
  if(!initialize&&store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('economy_skin_listings','economy_skin_trades')").get().n!==2)throw Object.assign(Error('Trading history is not initialized'),{status:503});
  return service=require('../services/skinTradingService').createSkinTradingService(store,{enabled,initialize});
 };
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});router.use(requireWebsiteToken);
 const fields={list:['own','before','limit'],eligible:['before'],history:['before','limit'],receipt:['requestId'],offerReceipt:['requestId'],ownListing:['id'],offer:['presetId','price','requestId'],buy:['id','expectedRevision','expectedPrice','requestId'],cancel:['id','expectedRevision']};
 for(const [action,allowed]of Object.entries(fields))router.post('/'+action,(req,res)=>{
  try{
   if(!req.is('application/json')||!req.body||Array.isArray(req.body)||Object.keys(req.query).length||Object.keys(req.body).some(key=>!['steamId',...allowed].includes(key)))return res.status(400).json({error:'Invalid trading request'});
   if(!/^\d{17}$/.test(req.body.steamId||''))return res.status(400).json({error:'A linked Steam account is required'});
   if(['offer','buy','cancel'].includes(action)&&readOnly())return res.status(403).json({error:'Trading changes are unavailable in this preview'});
   const input=Object.fromEntries(allowed.filter(key=>Object.hasOwn(req.body,key)).map(key=>[key,req.body[key]]));
   return res.json(get()[action]({steam_id:req.body.steamId},input));
  }catch(error){const status=[400,403,404,409,429,503].includes(error.status)?error.status:500;return res.status(status).json({error:status===500?'Trading records require staff review':error.message});}
 });
 return router;
}
module.exports={createSkinTradingRouter};
