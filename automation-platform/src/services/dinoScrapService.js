const store = require('./economyStore');
const dinoStorage = require('./dinoStorageService');

const ACTIVE_LISTING_STATUSES = Object.freeze([
  'escrowing',
  'active',
  'reserved',
  'transfer_uncertain',
  'cancelling',
]);

function enabled() {
  return String(process.env.DINO_SCRAP_ENABLED || 'true').toLowerCase() === 'true';
}

function percent() {
  const value = Number(process.env.DINO_SCRAP_PERCENT || 20);
  if (!Number.isFinite(value)) return 20;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function growthPercent(dino) {
  const value = Number(dino?.growth);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value <= 1 ? Math.round(value * 100) : Math.round(value)));
}

function tierForDino(dino) {
  if (dino?.isPrime === true) return 'prime';
  const growth = growthPercent(dino);
  if (growth >= 75) return 'high';
  if (growth >= 50) return 'mid';
  return 'starter';
}

function quoteFromDino(dino) {
  if (!enabled()) return { enabled: false, payout: 0, percent: percent(), referencePrice: 0, tier: null };
  const species = String(dino?.species || dinoStorage.speciesFromClassPath?.(dino?.classPath) || '').trim();
  const wantedTier = tierForDino(dino);
  const items = store.listCatalog({ activeOnly: true }).filter((item) =>
    item.item_type === 'dino' &&
    String(item.payload?.species || '').toLowerCase() === species.toLowerCase()
  );
  const item = items.find((entry) => String(entry.payload?.growthTier || '').toLowerCase() === wantedTier)
    || items.sort((a, b) => Number(a.price) - Number(b.price))[0]
    || null;
  if (!item) {
    return {
      enabled: false,
      payout: 0,
      percent: percent(),
      referencePrice: 0,
      tier: wantedTier,
      reason: 'No official marketplace price is configured for this species.',
    };
  }
  const referencePrice = Math.max(0, Number(item.price) || 0);
  const payout = Math.max(0, Math.floor(referencePrice * percent() / 100));
  return {
    enabled: payout > 0,
    payout,
    percent: percent(),
    referencePrice,
    catalogId: item.id,
    tier: wantedTier,
  };
}

function activeListingForSlot(steamId, slot) {
  return store.listDinoListings({
    sellerSteamId: steamId,
    statuses: [...ACTIVE_LISTING_STATUSES],
    limit: 500,
  }).find((listing) => String(listing.original_slot || '') === String(slot || '')) || null;
}

function assertNotListed(steamId, slot) {
  const listing = activeListingForSlot(steamId, slot);
  if (listing) {
    const error = new Error('Listed dinosaurs cannot be deleted or scrapped. Cancel the marketplace listing first.');
    error.code = 'DINO_LISTED';
    throw error;
  }
}

async function quoteStoredDino(steamId, slot) {
  const steam = store.validateSteamId(steamId);
  const selectedSlot = dinoStorage.validateSlot(slot);
  const dino = await dinoStorage.getStoredDino(steam, selectedSlot);
  return { dino, quote: quoteFromDino(dino) };
}

async function scrapStoredDino({ steamId, slot }) {
  if (!enabled()) {
    const error = new Error('Dinosaur scrapping is currently disabled.');
    error.code = 'DINO_SCRAP_DISABLED';
    throw error;
  }

  const steam = store.validateSteamId(steamId);
  const selectedSlot = dinoStorage.validateSlot(slot);
  assertNotListed(steam, selectedSlot);

  const dino = await dinoStorage.getStoredDino(steam, selectedSlot);
  const quote = quoteFromDino(dino);
  if (!quote.enabled || quote.payout <= 0) {
    const error = new Error(quote.reason || 'This dinosaur does not currently have a scrap value.');
    error.code = 'DINO_SCRAP_UNAVAILABLE';
    throw error;
  }

  await dinoStorage.deleteStoredDino({ steamId: steam, slot: selectedSlot });

  const capturedAt = Math.max(0, Math.floor(Number(dino.capturedAt) || 0));
  const ledgerKey = `dino-scrap:${steam}:${selectedSlot}:${capturedAt}`;
  const walletResult = store.applyWalletTransaction({
    steamId: steam,
    amount: quote.payout,
    kind: 'dino_scrap',
    reason: `Scrapped parked ${dino.species || 'dinosaur'}`,
    idempotencyKey: ledgerKey,
    referenceType: 'dinostorage_slot',
    referenceId: selectedSlot,
    metadata: {
      species: dino.species || null,
      growth: Number(dino.growth) || 0,
      isPrime: dino.isPrime === true,
      capturedAt,
      referencePrice: quote.referencePrice,
      scrapPercent: quote.percent,
      catalogId: quote.catalogId || null,
      tier: quote.tier || null,
    },
  });

  return {
    ok: true,
    slot: selectedSlot,
    species: dino.species || 'Dinosaur',
    payout: quote.payout,
    quote,
    wallet: walletResult.wallet,
    duplicateCredit: Boolean(walletResult.duplicate),
  };
}

module.exports = {
  ACTIVE_LISTING_STATUSES,
  enabled,
  percent,
  growthPercent,
  tierForDino,
  quoteFromDino,
  quoteStoredDino,
  activeListingForSlot,
  assertNotListed,
  scrapStoredDino,
};
