'use strict';
const express=require('express');
const {requireAdminToken}=require('../middleware/adminAuth');
function createAdminSpectatorRouter({read}){
 const router=express.Router();router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});router.use(requireAdminToken);
 router.get('/summary',(req,res)=>{try{return res.json(read(req.query));}catch(error){const status=error.status===400?400:503;return res.status(status).json({error:status===400?'Summary queries do not accept overrides.':'Spectator observations are unavailable.'});}});return router;
}
module.exports={createAdminSpectatorRouter};
