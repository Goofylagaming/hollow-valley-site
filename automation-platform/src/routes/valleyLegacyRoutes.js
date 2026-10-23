"use strict";
const express = require("express");
const { requireWebsiteToken } = require("../middleware/websiteAuth");
const { requireAdminToken } = require("../middleware/adminAuth");
const legacy = require("../services/valleyLegacyService");
const router = express.Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const run = (fn) => (req, res) => {
  try {
    res.json(fn(req, legacy.get()));
  } catch (e) {
    res
      .status(e.status || 500)
      .json({
        error: e.status
          ? e.message
          : "Valley Legacy could not complete this request",
      });
  }
};
router.get(
  "/overview",
  requireWebsiteToken,
  run((_r, s) => {
    legacy.reconcile();
    return s.overview();
  }),
);
router.get(
  "/players/:steamId",
  requireWebsiteToken,
  run((r, s) => s.mine(r.params.steamId)),
);
router.post(
  "/nests",
  requireWebsiteToken,
  run((r, s) => s.createNest(r.body.steamId, r.body)),
);
router.post(
  "/nests/:id/request",
  requireWebsiteToken,
  run((r, s) => s.requestEgg(r.body.steamId, r.body.name, r.params.id)),
);
router.post(
  "/nests/:id/manage",
  requireWebsiteToken,
  run((r, s) => s.manageNest(r.body.steamId, r.params.id, r.body)),
);
// Evidence, records and season changes cannot be written with the website token.
router.post(
  "/events",
  requireAdminToken,
  run((r, s) => s.ingest(r.body)),
);
router.post(
  "/hatches",
  requireAdminToken,
  run((r, s) => s.hatch(r.body)),
);
router.post(
  "/seasons",
  requireAdminToken,
  run((r, s) => {
    legacy.reconcile();
    return s.rotate(r.body.name);
  }),
);
module.exports = router;
