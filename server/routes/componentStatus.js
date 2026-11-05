"use strict";
const {createBridgeWorkerHealthStore}=require('../services/bridgeWorkerHealth');
function createRouter({db,env=process.env,now=Date.now,getMapState,getSteamHealth}={}){
 const router=require('express').Router();
 router.get('/',(_req,res)=>{
  res.set('Cache-Control','no-store');
  if(env.STATUS_COMPONENTS_PUBLIC_ENABLED!=='1')return res.json({available:false,components:[]});
  const unknown=code=>({id:'bridge-worker',scope:'windows-scheduled-task',code,observedAt:null,executionVerified:false});
  let worker=unknown('not-configured');
  if(env.STATUS_COMPONENTS_COLLECTION_ENABLED==='1'&&env.HV_MANAGEMENT_ENABLED==='1'&&String(env.HV_MANAGEMENT_AGENT_TOKEN||'').length>=32){try{worker=createBridgeWorkerHealthStore(db||require('../db').db,{initialize:false,now}).read();}catch{worker=unknown('unavailable');}}
  let map={id:'map-source',scope:'cached-position-source',code:'not-configured',observedAt:null,renderingVerified:false};
  if(env.STATUS_COMPONENTS_MAP_ENABLED==='1'){try{map=require('../services/liveMapProjection').health((getMapState||require('../services/serverStatus').getState)(),now());}catch{map={...map,code:'unavailable'};}}
  let steam={id:'steam-openid',scope:'provider-discovery-http',code:'not-configured',observedAt:null,linkingVerified:false};
  if(env.STATUS_COMPONENTS_STEAM_ENABLED==='1'){try{steam=(getSteamHealth||(()=>require('../services/steamProviderHealth').getDefaultService().read()))();}catch{steam={...steam,code:'unavailable'};}}
  return res.json({available:true,components:[worker,map,steam]});
 });return router;
}
module.exports={createRouter};
