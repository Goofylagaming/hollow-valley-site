const express=require('express');
const {db}=require('../db');
const {requireAdmin}=require('../middleware/requireAuth');
const queue=require('../services/territoryVictoryOutbox').createVictoryOutbox(db);
const router=express.Router();
router.use(requireAdmin);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',(_req,res)=>res.json({deliveries:queue.list()}));
router.post('/:attackId/retry',(req,res)=>{
  if(req.get('origin')!==`${req.protocol}://${req.get('host')}` || !req.is('application/json')) return res.status(403).json({error:'Same-origin JSON request required'});
  try {res.json(queue.retry(Number(req.params.attackId),String(req.user.steam_id||''),req.body?.reason));}
  catch(error){res.status(error.status||500).json({error:error.status?error.message:'Delivery review could not be saved'});}
});
module.exports=router;
