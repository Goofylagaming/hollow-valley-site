const router=require('express').Router();
const {requireAuth}=require('../middleware/requireAuth');
const {getSkinStudioSafety}=require('../middleware/skinStudioSafety');
const automation=require('../services/automationWebsiteClient');
const client=Object.fromEntries(['get','outcome','donate','cancel'].map(action=>[action,body=>automation.groupTreasuryRequest(action==='get'?'read':action,body)]));
const service=require('../services/groupTreasury').createGroupTreasury(require('../db').db,require('../groupsStore'),client);
const purchaseClient=Object.fromEntries([
 ['overview','spending-read'],['status','spend-status'],['reserve','spend-reserve'],['commit','spend-commit'],['release','spend-release'],
 ['dispatchTerritory','spend-dispatch-territory'],['settleTerritory','spend-settle-territory'],
].map(([name,action])=>[name,body=>automation.groupTreasuryRequest(action,body)]));
const territory=require('../services/groupTreasuryTerritoryCoordinator').createGroupTreasuryTerritoryCoordinator(require('../db').db,require('../groupsStore'),purchaseClient);
const purchases=require('../services/groupTreasuryPurchases').createGroupTreasuryPurchases(require('../db').db,require('../groupsStore'),purchaseClient,{territory});
const readOnly=()=>process.env.GROUP_TREASURY_READ_ONLY==='1'||getSkinStudioSafety().readOnly;
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.get('/capabilities',(_req,res)=>res.json({enabled:process.env.GROUP_TREASURY_ENABLED==='1',spendingEnabled:process.env.GROUP_TREASURY_ENABLED==='1'&&process.env.GROUP_TREASURY_SPEND_ENABLED==='1',territoryEntryEnabled:territory.ready(),readOnly:readOnly()}));
router.use(requireAuth);
router.use((req,res,next)=>/^\d{17}$/.test(String(req.user?.steam_id||''))?next():res.status(403).json({error:'A linked Steam account is required'}));
router.use((req,res,next)=>{
  if(req.method==='GET')return next();
  if(readOnly())return res.status(403).json({error:'This preview cannot change Group Treasury'});
  if(req.get('origin')!==`${req.protocol}://${req.get('host')}`||!req.is('application/json'))return res.status(403).json({error:'Use the website to manage Treasury donations'});
  next();
});
const run=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(error.status||502).json({error:error.status?error.message:'Group Treasury is temporarily unavailable',code:error.status?error.code:'TREASURY_UNAVAILABLE'});}};
router.get('/',run(req=>service.current(req.user.steam_id)));
router.get('/donations',run(req=>service.overview(req.user.steam_id)));
router.get('/donations/:id',run(req=>service.read(req.user.steam_id,req.params.id)));
router.post('/donations',run(req=>service.prepare(req.user.steam_id,{expectedGroupId:req.body?.expectedGroupId,amount:req.body?.amount,requestId:req.body?.requestId})));
router.post('/donations/:id/confirm',run(req=>service.confirm(req.user.steam_id,req.params.id,{confirmed:req.body?.confirmed,expectedGroupId:req.body?.expectedGroupId})));
router.post('/donations/:id/reconcile',run(req=>service.reconcile(req.user.steam_id,req.params.id)));
router.post('/donations/:id/cancel',run(req=>service.cancel(req.user.steam_id,req.params.id)));
router.get('/purchases',run(req=>purchases.overview(req.user.steam_id)));
router.get('/spending',run(req=>purchases.catalog(req.user.steam_id)));
router.post('/purchases',run(req=>purchases.prepare(req.user.steam_id,{expectedGroupId:req.body?.expectedGroupId,itemId:req.body?.itemId,revision:req.body?.revision,expectedCost:req.body?.expectedCost,requestId:req.body?.requestId})));
router.post('/purchases/:id/confirm',run(req=>purchases.confirm(req.user.steam_id,req.params.id,{expectedGroupId:req.body?.expectedGroupId,confirmed:req.body?.confirmed})));
router.post('/purchases/:id/reconcile',run(req=>purchases.reconcile(req.user.steam_id,req.params.id,{expectedGroupId:req.body?.expectedGroupId})));
router.post('/purchases/:id/release',run(req=>purchases.release(req.user.steam_id,req.params.id,{expectedGroupId:req.body?.expectedGroupId})));
router.post('/cosmetic-frame',run(req=>purchases.selectFrame(req.user.steam_id,{expectedGroupId:req.body?.expectedGroupId,frame:req.body?.frame,expectedRevision:req.body?.expectedRevision})));
module.exports=router;
