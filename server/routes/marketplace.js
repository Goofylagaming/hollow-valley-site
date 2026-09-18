const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const {
  getMarketplaceCatalog,
  seedMarketplaceCatalogIfEmpty,
  getCatalogEntry,
  addRosterDino,
  getWallet,
  creditWallet,
} = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

const seedPath = path.join(__dirname, "..", "data", "marketplace-catalog.json");
const seedEntries = JSON.parse(fs.readFileSync(seedPath, "utf8"));
seedMarketplaceCatalogIfEmpty(seedEntries);

function debitWallet(userId, amount, reason) {
  const wallet = getWallet(userId);
  if (wallet.balance < amount) return null;
  return creditWallet(userId, -amount, reason);
}

// Official catalog remains on the existing website DB until its catalog and
// legacy wallet balances are deliberately migrated to the automation economy.
router.get("/catalog", (_req, res) => {
  res.json(getMarketplaceCatalog());
});

router.post("/catalog/:id/buy", requireAuth, (req, res) => {
  const entry = getCatalogEntry(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "Listing not found" });
  const wallet = debitWallet(req.user.id, entry.price, `Bought ${entry.species_id} from marketplace`);
  if (!wallet) return res.status(402).json({ error: "Not enough Valley Coin" });
  const dino = addRosterDino(req.user.id, entry.species_id, entry.size_percent || 75, 0, "parked");
  res.json({ ok: true, wallet, dino });
});

// Player-to-player selling uses the real parked DinoStorage file through the
// isolated automation service. No browser-supplied Steam ID is trusted.
router.get("/listings", (req, res) => automationRoutes.listDinoMarketplaceListings(req, res));
router.get("/listings/mine", requireAuth, (req, res) => automationRoutes.listMyDinoMarketplaceListings(req, res));
router.post("/listings", requireAuth, (req, res) => automationRoutes.createDinoMarketplaceListing(req, res));
router.post("/listings/:id/buy", requireAuth, (req, res) => automationRoutes.buyDinoMarketplaceListing(req, res, req.params.id));
router.post("/listings/:id/cancel", requireAuth, (req, res) => automationRoutes.cancelDinoMarketplaceListing(req, res, req.params.id));

module.exports = router;
