const express=require('express');
const {requireWebsiteToken}=require('../middleware/websiteAuth');
const progression=require('../services/progressionService');
const router=express.Router();
router.use(requireWebsiteToken);
router.post('/',(req,res)=>{
  res.set('Cache-Control','no-store');
  try {res.json({players:progression.getTitleEvidence(req.body?.steamIds)});}
  catch(error){res.status(error.status||500).json({error:error.status?error.message:'Title evidence unavailable'});}
});
module.exports=router;
