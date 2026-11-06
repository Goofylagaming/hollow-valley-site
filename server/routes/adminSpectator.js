'use strict';
const express=require('express'),{requireAdmin}=require('../middleware/requireAuth');
const router=express.Router();router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});router.use(requireAdmin);
function error(res,value){const status=[403,503].includes(value.status)?value.status:502;return res.status(status).json({error:status===403?'Current linked admin access is required. Reload this page.':status===503?'Spectator summary is disabled or unavailable.':'Spectator observations are unavailable.'});}
router.get('/capabilities',(req,res)=>{try{if(Object.keys(req.query).length)return res.status(400).json({error:'Summary queries do not accept overrides.'});return res.json(require('../services/adminSpectator').getDefaultService().capabilities(()=>req.user));}catch(value){return error(res,value);}});
router.get('/summary',async(req,res)=>{try{if(Object.keys(req.query).length)return res.status(400).json({error:'Summary queries do not accept overrides.'});return res.json(await require('../services/adminSpectator').getDefaultService().read(()=>req.user,req.get('X-Spectator-Reviewer')));}catch(value){return error(res,value);}});
module.exports=router;
