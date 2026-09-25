const MIN_PRIME_75_PRICE = 50000;

const OFFICIAL_TIERS = Object.freeze([
  { key: '50', growth: 50, label: '50%', isPrime: false, priceMultiplier: 0.75 },
  { key: '75', growth: 75, label: '75%', isPrime: true, priceMultiplier: 1.15, minimumPrice: MIN_PRIME_75_PRICE },
]);

function tierPolicyForItem(item) {
  const tierKey = String(item?.payload?.growthTier || '').trim();
  return OFFICIAL_TIERS.find((tier) => tier.key === tierKey) || null;
}

function assertOfficialDinoSalePolicy(item) {
  if (!item || item.item_type !== 'dino') return item;
  const tier = tierPolicyForItem(item);
  if (!tier) {
    const error = new Error('This official dinosaur tier has been retired');
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }

  const growthPercent = Math.round(Number(
    item.payload?.growthPercent
      ?? item.payload?.sizePercent
      ?? (Number(item.payload?.growth) * 100)
  ));
  if (growthPercent !== tier.growth) {
    const error = new Error(`Official ${tier.label} dinosaurs must be exactly ${tier.growth}% growth`);
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }

  if (Boolean(item.payload?.isPrime) !== tier.isPrime) {
    const error = new Error(tier.isPrime
      ? 'Official 75% dinosaurs must include Prime'
      : 'Official 50% dinosaurs cannot include Prime');
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }

  if (tier.minimumPrice && Number(item.price) < tier.minimumPrice) {
    const error = new Error(`Official 75% Prime dinosaurs must cost at least ${tier.minimumPrice.toLocaleString('en-AU')} Valley Coin`);
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }

  return item;
}

module.exports = {
  MIN_PRIME_75_PRICE,
  OFFICIAL_TIERS,
  tierPolicyForItem,
  assertOfficialDinoSalePolicy,
};
