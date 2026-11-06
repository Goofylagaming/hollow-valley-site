"use strict";
const router = require("express").Router();
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const service = require("../services/subscriberCommunity");
router.get("/public",(_req,res)=>{
  if(process.env.COMMUNITY_PARTICIPATION_ENABLED!=="1") return res.sendStatus(404);
  res.json(require("../services/communityParticipation").publicCommunity());
});
router.use(requireAuth);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  if (!service.enabled()) return res.status(503).json({ error: "Subscriber community is disabled." });
  if (req.method !== "GET") {
    try { if (new URL(req.get("origin")).host !== req.get("host")) throw new Error(); }
    catch { return res.status(403).json({ error: "Use the Hollow Valley website." }); }
  }
  next();
});
const handle = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "Community request unavailable." }); }
};
router.post("/suggestions", handle(req => service.suggest(req.user, req.body?.text)));
router.get("/admin", requireAdmin, handle(req => service.state(req.user)));
router.post("/admin/suggestions/:id", requireAdmin, handle(req => service.shortlist(req.user, req.params.id, req.body?.status)));
router.post("/admin/posts", requireAdmin, handle(req => service.publish(req.user, req.body, { dryRun: req.body?.dryRun !== false })));
router.post("/admin/monthly", requireAdmin, handle(req => service.monthly({ dryRun: req.body?.dryRun !== false })));
router.post("/admin/deliver", requireAdmin, handle(() => service.deliver()));
router.post("/admin/suggestions/:id/review", requireAdmin, handle(req => {
  if(process.env.COMMUNITY_PARTICIPATION_ENABLED !== "1") return {enabled:false};
  return require("../services/communityParticipation").review(req.user,Number(req.params.id),req.body);
}));
router.post("/suggestions/:id/credit", handle(req => {
  if(process.env.COMMUNITY_PARTICIPATION_ENABLED !== "1") return {enabled:false};
  const {db}=require("../db");
  require("../services/communityParticipation").schema();
  const changed=db.prepare(`UPDATE membership_suggestion_reviews SET public_credit=?
    WHERE suggestion_id=? AND EXISTS(SELECT 1 FROM subscriber_suggestions s WHERE s.id=suggestion_id AND s.user_id=?)`)
    .run(req.body?.optIn===true?1:0,Number(req.params.id),req.user.id).changes;
  return {updated:Boolean(changed)};
}));
router.post("/admin/suggestions/:id/weekend", requireAdmin, handle(req=>{
  if(process.env.COMMUNITY_PARTICIPATION_ENABLED!=="1") return {enabled:false};
  return require("../services/communityParticipation").activateWeekend(req.user,Number(req.params.id),req.body.startsAt,req.body.endsAt);
}));
module.exports = router;
