const express=require('express');
const {requireWebsiteToken}=require('../middleware/websiteAuth');
const {db}=require('../services/economyStore');
const {createTerritoryVictoryStore}=require('../services/territoryVictoryStore');
const results=createTerritoryVictoryStore(db);
const router=express.Router();
router.use(requireWebsiteToken);
router.post('/',(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const result=results.ingest(req.body);
    res.status(result.duplicate?200:201).json(result);
  } catch(error) {
    res.status(error.status||500).json({error:error.status?error.message:'Territory result could not be recorded'});
  }
});
module.exports=router;
