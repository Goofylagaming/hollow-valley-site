'use strict';
const express = require('express');
function createDeathRecapsRouter({ db, client = require('../services/automationWebsiteClient'), enabled = () => process.env.DEATH_RECAP_ENABLED === '1' && process.env.VALLEY_LEGACY_ENABLED === '1' } = {}) {
  const router = express.Router();
  const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
  function actor(req) {
    if (!req.user) fail(401,'Sign in to view your death recaps');
    const user = req.user;
    if (!Number.isSafeInteger(user.id) || typeof user.steam_id !== 'string' || !/^\d{17}$/.test(user.steam_id)) fail(403,'A current linked Steam account is required');
    const saved = db.prepare('SELECT id,steam_id FROM users WHERE id=?').get(user.id);
    if (!saved || saved.steam_id !== user.steam_id) fail(403,'Your linked account changed. Reload this page.');
    return { steamId: saved.steam_id, binding: saved.id + ':' + saved.steam_id };
  }
  const respond = (res,error) => res.status([400,401,403,503].includes(error.status) ? error.status : 502).json({error:error.status && error.status < 500 ? error.message : 'Death recaps are temporarily unavailable'});
  router.use((_req,res,next) => { res.set('Cache-Control','private, no-store');next(); });
  router.get('/capabilities',(req,res) => {
    if (Object.keys(req.query).length) return res.status(400).json({error:'Death recap queries do not accept overrides'});
    return res.json({enabled:Boolean(enabled())});
  });
  router.get('/',async(req,res) => {
    try {
      if (!enabled()) fail(503,'Death recaps are not enabled');
      const user = actor(req);
      if (Object.keys(req.query).length) fail(400,'Death recap queries do not accept overrides');
      if (req.get('X-Death-Recap-Actor') !== user.binding) fail(403,'Refresh death recaps for your current account');
      const data = await client.legacyRequest('/death-recaps/list',{method:'POST',body:{steamId:user.steamId}});
      if (actor(req).binding !== user.binding) fail(403,'Your linked account changed. Reload this page.');
      if (!enabled()) fail(503,'Death recaps were paused');
      return res.json({...data,actorBinding:user.binding});
    } catch(error) { return respond(res,error); }
  });
  return router;
}
let router;
module.exports = (req,res,next) => { router ||= createDeathRecapsRouter({db:require('../db').db});return router(req,res,next); };
module.exports.createDeathRecapsRouter = createDeathRecapsRouter;
