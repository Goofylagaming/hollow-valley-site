'use strict';
const express=require('express'),{requireAdminToken}=require('../middleware/adminAuth');
function createSkinMarketModerationRouter({getStore=()=>require('../services/economyStore'),getService=null,enabled=()=>process.env.SKIN_TRADING_MANAGEMENT_ENABLED==='1',readOnly=()=>/^(1|true)$/i.test(process.env.SKIN_TRADING_READ_ONLY||'')}={}){
 const router=express.Router();let service;
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});router.use(requireAdminToken);
 const get=()=>{if(service)return service;if(getService)return service=getService();const store=getStore();if(store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('economy_skin_listings','economy_skin_trades')").get().n!==2)throw Object.assign(Error('Trading history is not initialized'),{status:503});const ready=store.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('economy_skin_market_holds','economy_skin_market_reviews')").get().n===2;if(!ready&&readOnly())throw Object.assign(Error('Market review history is not initialized'),{status:503});return service=require('../services/skinMarketModeration').createSkinMarketModeration(store,{enabled,readOnly,initialize:!ready});};
 const fields={read:['id'],receipt:['requestId'],change:['action','target','active','expectedRevision','reason','requestId']};
 for(const [action,allowed]of Object.entries(fields))router.post('/'+action,(req,res)=>{try{
  if(!enabled())return res.status(503).json({error:'Skin market management is disabled'});
  if(!req.is('application/json')||!req.body||Array.isArray(req.body)||Object.keys(req.query).length||Object.keys(req.body).some(key=>!['reviewerSteamId',...allowed].includes(key)))return res.status(400).json({error:'Invalid review request'});
  if(!/^\d{17}$/.test(req.body.reviewerSteamId||''))return res.status(400).json({error:'A linked reviewer is required'});
  if(action==='change'&&readOnly())return res.status(403).json({error:'This preview cannot change the skin market'});
  const input=Object.fromEntries(allowed.filter(key=>Object.hasOwn(req.body,key)).map(key=>[key,req.body[key]]));return res.json(get()[action]({steam_id:req.body.reviewerSteamId},input));
 }catch(error){const status=[400,403,404,409,503].includes(error.status)?error.status:500;return res.status(status).json({error:status===500?'Market review records require staff inspection':error.message});}});
 return router;
}
module.exports={createSkinMarketModerationRouter};
