"use strict";
const router = require("express").Router();
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const service = require("../services/subscriberCommunity");
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
module.exports = router;
