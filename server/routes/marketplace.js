const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const {
  getMarketplaceCatalog,
  seedMarketplaceCatalogIfEmpty,
  getCatalogEntry,
  getMarketplaceListings,
  getListingEntry,
  createListing,
  closeListing,
  getRosterEntry,
  addRosterDino,
  transferRosterDino,
  getWallet,
  creditWallet,
} = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const seedPath = path.join(__dirname, "..", "data", "marketplace-catalog.json");
const seedEntries = JSON.parse(fs.readFileSync(seedPath, "utf8"));
seedMarketplaceCatalogIfEmpty(seedEntries);

function debitWallet(userId, amount, reason) {
  const wallet = getWallet(userId);
  if (wallet.balance < amount) return null;
  return creditWallet(userId, -amount, reason);
}

// Official server catalog — fixed price dinos, bought with Valley Coin.
router.get("/catalog", (req, res) => {
  res.json(getMarketplaceCatalog());
});

router.post("/catalog/:id/buy", requireAuth, (req, res) => {
  const entry = getCatalogEntry(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "Listing not found" });
  const wallet = debitWallet(req.user.id, entry.price, `Bought ${entry.species_id} from marketplace`);
  if (!wallet) return res.status(402).json({ error: "Not enough Valley Coin" });
  const dino = addRosterDino(req.user.id, entry.species_id, entry.size_percent);
  res.json({ ok: true, wallet, dino });
});

// Peer-to-peer resale of a player's own dino.
router.get("/listings", (req, res) => {
  res.json(getMarketplaceListings());
});

router.post("/listings", requireAuth, (req, res) => {
  const { rosterId, price } = req.body || {};
  const dino = getRosterEntry(Number(rosterId));
  if (!dino || dino.user_id !== req.user.id) {
    return res.status(404).json({ error: "Dino not found in your storage" });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Price must be a positive number" });
  }
  const listing = createListing(dino.id, req.user.id, Math.round(price));
  res.json(listing);
});

router.post("/listings/:id/buy", requireAuth, (req, res) => {
  const listing = getListingEntry(Number(req.params.id));
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  if (listing.seller_id === req.user.id) return res.status(400).json({ error: "You cannot buy your own listing" });

  const wallet = debitWallet(req.user.id, listing.price, "Bought dino from another survivor");
  if (!wallet) return res.status(402).json({ error: "Not enough Valley Coin" });

  transferRosterDino(listing.roster_id, req.user.id);
  closeListing(listing.id, "sold");
  creditWallet(listing.seller_id, listing.price, "Sold dino on marketplace");
  res.json({ ok: true, wallet });
});

router.post("/listings/:id/cancel", requireAuth, (req, res) => {
  const listing = getListingEntry(Number(req.params.id));
  if (!listing || listing.seller_id !== req.user.id) {
    return res.status(404).json({ error: "Listing not found" });
  }
  closeListing(listing.id, "cancelled");
  res.json({ ok: true });
});

module.exports = router;
