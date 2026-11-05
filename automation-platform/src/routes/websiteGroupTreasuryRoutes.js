const router=require('express').Router();
router.use(require('../middleware/websiteAuth').requireWebsiteToken);
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
let service;
const get=()=>service||(service=require('../services/groupTreasuryService').createGroupTreasury(require('../services/economyStore')));
let closure;
const getClosure=()=>closure||(closure=require('../services/groupTreasuryClosure').createGroupTreasuryClosure(require('../services/economyStore')));
let spending;
let groupEvents;
const getGroupEvents=()=>groupEvents||(groupEvents=require('../services/groupEventRegistration').createGroupEventRegistration(require('../services/economyStore').db));
const territoryProof=require('../services/groupTreasuryTerritoryProof');
const getSpending=()=>spending||(spending=require('../services/groupTreasurySpending').createGroupTreasurySpending(require('../services/economyStore'),{
 verifyFulfillment:proof=>territoryProof.verify(proof,process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET),
 groupEvents:getGroupEvents(),
}));
const run=fn=>(req,res)=>{try{res.json(fn(req));}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Group Treasury is temporarily unavailable',code:error.status?error.code:'TREASURY_UNAVAILABLE'});}};
router.post('/read',run(req=>get().get(req.body?.groupId)));
router.post('/outcome',run(req=>get().outcome({steamId:req.body?.steamId,requestId:req.body?.requestId})));
router.post('/donate',run(req=>get().donate({steamId:req.body?.steamId,groupId:req.body?.groupId,amount:req.body?.amount,requestId:req.body?.requestId})));
router.post('/cancel',run(req=>get().cancel({steamId:req.body?.steamId,groupId:req.body?.groupId,amount:req.body?.amount,requestId:req.body?.requestId})));
const ticket=req=>({groupId:req.body?.groupId,requestId:req.body?.requestId,actorSteamId:req.body?.actorSteamId,action:req.body?.action});
router.post('/closure-begin',run(req=>getClosure().begin(ticket(req))));
router.post('/closure-abort',run(req=>getClosure().abort(ticket(req))));
router.post('/closure-complete',run(req=>getClosure().complete(ticket(req))));
const purchase=req=>({groupId:req.body?.groupId,requestId:req.body?.requestId,actorSteamId:req.body?.actorSteamId,itemId:req.body?.itemId,revision:req.body?.revision,expectedCost:req.body?.expectedCost,event:req.body?.event});
router.post('/group-event-preview',run(req=>getGroupEvents().preview(req.body?.eventId)));
router.post('/group-event-registrations',run(req=>{
 getSpending();
 const rows=getGroupEvents().list(req.body?.groupId);
 for(const row of rows)getSpending().read(req.body?.groupId,row.requestId);
 return {groupId:req.body?.groupId,registrations:rows};
}));
router.post('/spending-read',run(req=>({groupId:req.body?.groupId,catalog:getSpending().list(),cosmetics:getSpending().cosmetics(req.body?.groupId),eventRegistrationEnabled:getGroupEvents().enabled()})));
router.post('/spend-status',run(req=>{try{return getSpending().read(req.body?.groupId,req.body?.requestId);}catch(error){if(error.code==='SPEND_UNAVAILABLE')return null;throw error;}}));
router.post('/spend-reserve',run(req=>getSpending().reserve(purchase(req))));
router.post('/spend-commit',run(req=>getSpending().commit({groupId:req.body?.groupId,requestId:req.body?.requestId,actorSteamId:req.body?.actorSteamId})));
router.post('/spend-release',run(req=>getSpending().release(purchase(req))));
router.post('/spend-dispatch-territory',run(req=>{
 if(process.env.GROUP_TREASURY_TERRITORY_ENABLED!=='1')throw Object.assign(new Error('New Territory spending is not enabled'),{status:503,code:'TREASURY_SPENDING_DISABLED'});
 if(!territoryProof.configured(process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET))throw Object.assign(new Error('Territory evidence verification is not configured'),{status:503,code:'FULFILLMENT_NOT_CONFIGURED'});
 const order=getSpending().read(req.body?.groupId,req.body?.requestId);
 if(order.item.purpose!=='territory_entry')throw Object.assign(new Error('Only Territory entry dispatch is available'),{status:409,code:'INVALID_SPEND'});
 return getSpending().beginFulfillment({groupId:req.body?.groupId,requestId:req.body?.requestId,actorSteamId:req.body?.actorSteamId});
}));
router.post('/spend-settle-territory',run(req=>{
 const evidence=req.body?.evidence;
 if(!territoryProof.verify(evidence,process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET))throw Object.assign(new Error('Authenticated Territory delivery evidence is required'),{status:403,code:'FULFILLMENT_UNVERIFIED'});
 const groupId=req.body?.groupId,requestId=req.body?.requestId,actorSteamId=req.body?.actorSteamId;
 if(evidence.groupId!==groupId||evidence.requestId!==requestId)throw Object.assign(new Error('Territory evidence does not match this purchase'),{status:409,code:'FULFILLMENT_UNVERIFIED'});
 const order=getSpending().read(groupId,requestId);
 if(order.item.purpose!=='territory_entry'||order.item.cost!==evidence.cost||String(order.item.target.eventId)!==evidence.targetKey||
   (order.fulfillment&&(order.fulfillment.id!==evidence.id||order.fulfillment.outcome!==evidence.outcome)))throw Object.assign(new Error('Territory evidence disagrees with the saved purchase'),{status:409,code:'FULFILLMENT_UNVERIFIED'});
 if(evidence.outcome==='delivered')return getSpending().commit({groupId,requestId,actorSteamId,fulfillmentProof:evidence});
 return getSpending().release({groupId,requestId,actorSteamId,itemId:order.item.id,revision:order.item.revision,expectedCost:order.item.cost,fulfillmentProof:evidence});
}));
module.exports=router;
