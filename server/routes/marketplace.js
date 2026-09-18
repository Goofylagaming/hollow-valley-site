const express = require("express");
const { randomUUID } = require("node:crypto");
const { requireAuth } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return { status: error.status, body: { error: error.message || fallback } };
  }
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return { status: 504, body: { error: "The automation service did not respond in time." } };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

router.get("/catalog", async (_req, res) => {
  try {
    const result = await automation.listMarketplaceCatalog();
    const catalog = (result.catalog || []).map((item) => ({
      id: item.id,
      species_id: item.payload?.speciesId || item.payload?.species || item.id,
      price: Number(item.price) || 0,
      size_percent: Number(item.payload?.sizePercent ?? item.payload?.growthPercent ?? 75),
      name: item.name || null,
      item_type: item.item_type || null,
    }));
    res.json(catalog);
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read marketplace catalog.");
    res.status(mapped.status).json(mapped.body);
  }
});

router.post("/catalog/:id/buy", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }
  try {
    const result = await automation.purchaseMarketplaceItem({
      steamId: String(req.user.steam_id),
      catalogId: req.params.id,
      idempotencyKey: `website-marketplace:${randomUUID()}`,
    });
    return res.status(result.duplicate ? 200 : 202).json({
      ok: true,
      accepted: true,
      fulfilled: result.order?.status === "fulfilled",
      order: result.order || null,
      wallet: result.wallet || null,
    });
  } catch (error) {
    const mapped = mapAutomationError(error, "Marketplace purchase failed.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.get("/state", async (_req, res) => {
  try {
    res.json(await automation.getDinoMarketplaceState());
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read marketplace state.");
    res.status(mapped.status).json(mapped.body);
  }
});

router.get("/listings", async (_req, res) => {
  try {
    const result = await automation.listDinoMarketplaceListings();
    res.json((result.listings || []).map((listing) => ({
      id: listing.id,
      price: Number(listing.price) || 0,
      species_id: listing.snapshot?.species || "Unknown",
      size_percent: Math.round((Number(listing.snapshot?.growth) || 0) * 100),
      gender: listing.snapshot?.gender || null,
      is_prime: Boolean(listing.snapshot?.isPrime),
      mutations: listing.snapshot?.mutationList || [],
      skin: listing.snapshot?.skin || null,
      created_at: listing.createdAt || null,
    })));
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read dino marketplace listings.");
    res.status(mapped.status).json(mapped.body);
  }
});

function writesDisabled(_req, res) {
  return res.status(503).json({ error: "Marketplace P2P writes are not enabled yet." });
}

router.post("/listings", requireAuth, writesDisabled);
router.post("/listings/:id/buy", requireAuth, writesDisabled);
router.post("/listings/:id/cancel", requireAuth, writesDisabled);

module.exports = router;
