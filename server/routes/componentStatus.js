"use strict";
const {createBridgeWorkerHealthStore}=require('../services/bridgeWorkerHealth');
function createRouter({db,env=process.env,now=Date.now}={}){
 const router=require('express').Router();
 router.get('/',(_req,res)=>{
  res.set('Cache-Control','no-store');
  if(env.STATUS_COMPONENTS_PUBLIC_ENABLED!=='1')return res.json({available:false,components:[]});
  const unknown=code=>({id:'bridge-worker',scope:'windows-scheduled-task',code,observedAt:null,executionVerified:false});
  if(env.STATUS_COMPONENTS_COLLECTION_ENABLED!=='1'||env.HV_MANAGEMENT_ENABLED!=='1'||String(env.HV_MANAGEMENT_AGENT_TOKEN||'').length<32)return res.json({available:true,components:[unknown('not-configured')]});
  try{return res.json({available:true,components:[createBridgeWorkerHealthStore(db||require('../db').db,{initialize:false,now}).read()]});}
  catch{return res.json({available:true,components:[unknown('unavailable')]});}
 });return router;
}
module.exports={createRouter};
