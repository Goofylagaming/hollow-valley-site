const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

// Both the official catalog and player-to-player marketplace read from the
// Steam-keyed automation economy. Writes remain fail-closed behind the
// automation service's explicit marketplace write gates.
router.get("/catalog", (req, res) => automationRoutes.listMarketplaceCatalog(req, res));
router.post("/catalog/:id/buy", requireAuth, (req, res) =>
  automationRoutes.buyMarketplaceCatalogItem(req, res, req.params.id));

router.get("/state", (req, res) => automationRoutes.getDinoMarketplaceState(req, res));
router.get("/orders/mine", requireAuth, (req, res) => automationRoutes.listMarketplaceOrders(req, res));
router.get("/listings", (req, res) => automationRoutes.listDinoMarketplaceListings(req, res));
router.get("/listings/mine", requireAuth, (req, res) => automationRoutes.listMyDinoMarketplaceListings(req, res));
router.post("/listings", requireAuth, (req, res) => automationRoutes.createDinoMarketplaceListing(req, res));
router.post("/listings/:id/buy", requireAuth, (req, res) => automationRoutes.buyDinoMarketplaceListing(req, res, req.params.id));
router.post("/listings/:id/cancel", requireAuth, (req, res) => automationRoutes.cancelDinoMarketplaceListing(req, res, req.params.id));

module.exports = router;
