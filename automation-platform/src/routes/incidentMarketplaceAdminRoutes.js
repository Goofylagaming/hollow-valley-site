'use strict';
const express = require('express');
const {requireAdminToken} = require('../middleware/adminAuth');
const {createIncidentMarketplaceSource} = require('../services/incidentMarketplaceService');
const {createIncidentPeerMarketplaceSource} = require('../services/incidentPeerMarketplaceService');
function createIncidentMarketplaceRouter({db,now,enabled,peerEnabled} = {}) {
  const router=express.Router(),source=createIncidentMarketplaceSource({db,now,enabled});
  const peerSource=createIncidentPeerMarketplaceSource({db,now,enabled:peerEnabled});
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.use(requireAdminToken);
  router.get('/context',(req,res)=>{
    try {return res.json(source.read(req.query));}
    catch(error) {const status=error.status===400?400:503;return res.status(status).json({error:status===400?'A valid player and incident time are required.':'Marketplace incident context is unavailable.'});}
  });
  router.get('/peer-context',(req,res)=>{
    try {return res.json(peerSource.read(req.query));}
    catch(error) {const status=error.status===400?400:503;return res.status(status).json({error:status===400?'A valid player and incident time are required.':'Peer marketplace incident context is unavailable.'});}
  });
  return router;
}
module.exports={createIncidentMarketplaceRouter};
