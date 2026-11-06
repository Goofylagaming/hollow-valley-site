const express=require('express');
const {requireAdminToken}=require('../middleware/adminAuth');
const {db}=require('../services/economyStore');
const review=require('../services/achievementEvidenceReview').createAchievementEvidenceReview(db);
const router=express.Router();
router.use(requireAdminToken);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',(_req,res)=>res.json({reviews:review.list()}));
router.post('/',(req,res)=>{
  try {res.json(review.decide(req.body));}
  catch(error){res.status(error.status||500).json({error:error.status?error.message:'Achievement review could not be saved'});}
});
module.exports=router;
