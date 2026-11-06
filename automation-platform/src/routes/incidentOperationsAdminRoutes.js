'use strict';
const express=require('express');
const {requireAdminToken}=require('../middleware/adminAuth');
const {createIncidentOperationsSource}=require('../services/incidentOperationsService');
function createIncidentOperationsRouter(options={}){
 const router=express.Router(),read=typeof options.readContext==='function'?options.readContext:createIncidentOperationsSource(options).read;
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});router.use(requireAdminToken);
 router.get('/context',(req,res)=>{
  try{return res.json(read(req.query));}
  catch(error){const status=error.status===400?400:503;return res.status(status).json({error:status===400?'A valid player and incident time are required.':'Retained operation context is unavailable.'});}
 });
 return router;
}
module.exports={createIncidentOperationsRouter};
