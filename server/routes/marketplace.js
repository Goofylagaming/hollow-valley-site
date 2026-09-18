const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

// On the automation branch both the official catalog and player-to-player
// marketplace read from the Steam-keyed automation economy. Official purchases
// remain fail-closed until real DinoStorage fulfillment is explicitly enabled.
router.get("/catalog", (req, res) => automationRoutes.listMarketplaceCatalog(req, res));
router.post("/catalog/:id/buy", requireAuth, (req, res) =>
  automationRoutes.buyMarketplaceCatalogItem(req, res, req.params.id));

router.get("/state", (req, res) => automationRoutes.getDinoMarketplaceState(req, res));
router.get("/listings", (req, res) => automationRoutes.listDinoMarketplaceListings(req, res));
router.get("/listings/mine", requireAuth, (req, res) => automationRoutes.listMyDinoMarketplaceListings(req, res));
router.post("/listings", requireAuth, (req, res) => automationRoutes.createDinoMarketplaceListing(req, res));
router.post("/listings/:id/buy", requireAuth, (req, res) => automationRoutes.buyDinoMarketplaceListing(req, res, req.params.id));
router.post("/listings/:id/cancel", requireAuth, (req, res) => automationRoutes.cancelDinoMarketplaceListing(req, res, req.params.id));

module.exports = router;
