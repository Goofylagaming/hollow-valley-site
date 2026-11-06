'use strict';
const router=require('express').Router();
const {requireAuth,requireAdmin}=require('../middleware/requireAuth');
const {arcadeRewardsRequest}=require('../services/automationWebsiteClient');
router.use(requireAuth);
router.use((req,res,next)=>{
  res.set('Cache-Control','private, no-store');
  if(process.env.VALLEY_ARCADE_ENABLED!=='1'||process.env.VALLEY_ARCADE_REWARDS_ENABLED!=='1')return res.sendStatus(404);
  if(req.method==='POST') {
    try {if(new URL(req.get('origin')).host!==req.get('host'))return res.sendStatus(403);}
    catch {return res.sendStatus(403);}
  }
  next();
});
const forward=(action,payload)=>async(req,res)=>{
  try {res.json(await arcadeRewardsRequest(action,payload(req)));}
  catch(error){res.status(error.status>=400&&error.status<600?error.status:502).json({error:error.status===409?error.message:'Arcade unavailable. Retry the same action to check its result.'});}
};
const player=req=>({steamId:req.user.steam_id,requestKey:req.body?.requestKey});
router.get('/',forward('state',player));
router.post('/daily',forward('daily',player));
router.post('/open',forward('open',req=>({...player(req),crateId:req.body?.crateId})));
router.post('/craft',forward('craft',req=>({...player(req),family:req.body?.family})));
router.get('/admin',requireAdmin,forward('admin',()=>({})));
router.post('/admin/configure',requireAdmin,forward('configure',req=>({actor:String(req.user.id),config:req.body?.config,expectedVersion:req.body?.expectedVersion})));
router.post('/admin/grant',requireAdmin,forward('grant',req=>({actor:String(req.user.id),steamId:req.body?.steamId,
  requestKey:req.body?.requestKey,kind:req.body?.kind,family:req.body?.family,amount:req.body?.amount,source:req.body?.source})));
module.exports=router;
