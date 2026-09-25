const store = require('./economyStore');
const {
  MIN_PRIME_75_PRICE,
  OFFICIAL_TIERS,
  tierPolicyForItem,
  assertOfficialDinoSalePolicy,
} = require('./officialMarketplacePolicy');

const OFFICIAL_DINO_CATALOG = Object.freeze([
  ['tyrannosaurus', 'Tyrannosaurus', 3680],
  ['allosaurus', 'Allosaurus', 3000],
  ['carnotaurus', 'Carnotaurus', 2800],
  ['ceratosaurus', 'Ceratosaurus', 2720],
  ['deinosuchus', 'Deinosuchus', 3760],
  ['dilophosaurus', 'Dilophosaurus', 2400],
  ['herrerasaurus', 'Herrerasaurus', 1520],
  ['omniraptor', 'Omniraptor', 2080],
  ['troodon', 'Troodon', 1400],
  ['pteranodon', 'Pteranodon', 1800],
  ['diabloceratops', 'Diabloceratops', 2600],
  ['dryosaurus', 'Dryosaurus', 1200],
  ['tenontosaurus', 'Tenontosaurus', 2200],
  ['maiasaura', 'Maiasaura', 2320],
  ['pachycephalosaurus', 'Pachycephalosaurus', 1920],
  ['stegosaurus', 'Stegosaurus', 3280],
  ['triceratops', 'Triceratops', 3520],
  ['gallimimus', 'Gallimimus', 1680],
  ['hypsilophodon', 'Hypsilophodon', 960],
  ['beipiaosaurus', 'Beipiaosaurus', 1600],
]);

const CLASS_PATHS = Object.freeze(Object.fromEntries(
  OFFICIAL_DINO_CATALOG.map(([speciesId, speciesName]) => [
    speciesId,
    `/Game/TheIsle/Core/Characters/Dinosaurs/${speciesName}/BP_${speciesName}.BP_${speciesName}_C`,
  ])
));

function desiredTierPrice({ speciesId, tier, basePrice }) {
  const legacyId = tier.key === '50'
    ? `dino:${speciesId}:mid`
    : `dino:${speciesId}:high`;
  const existingNew = store.getCatalogItem(`dino:${speciesId}:${tier.key}`);
  const legacy = store.getCatalogItem(legacyId);
  const existingPrice = Number(existingNew?.price ?? legacy?.price);
  const defaultPrice = Math.max(1, Math.round(basePrice * tier.priceMultiplier));
  const price = Number.isSafeInteger(existingPrice) && existingPrice > 0 ? existingPrice : defaultPrice;
  return tier.minimumPrice ? Math.max(tier.minimumPrice, price) : price;
}

function seedOfficialCatalog() {
  const currentIds = [];
  const items = [];

  OFFICIAL_DINO_CATALOG.forEach(([speciesId, speciesName, basePrice], speciesIndex) => {
    OFFICIAL_TIERS.forEach((tier, tierIndex) => {
      const id = `dino:${speciesId}:${tier.key}`;
      currentIds.push(id);
      const existing = store.getCatalogItem(id);
      const price = desiredTierPrice({ speciesId, tier, basePrice });
      const active = existing ? existing.active !== false : true;

      items.push(store.upsertCatalogItem({
        id,
        itemType: 'dino',
        name: `${speciesName} ${tier.label}${tier.isPrime ? ' Prime' : ''}`,
        description: tier.isPrime
          ? `Official Hollow Valley ${speciesName} at 75% growth with Prime.`
          : `Official Hollow Valley ${speciesName} at 50% growth.`,
        price,
        payload: {
          speciesId,
          species: speciesName,
          classPath: CLASS_PATHS[speciesId],
          growth: tier.growth / 100,
          growthPercent: tier.growth,
          sizePercent: tier.growth,
          growthTier: tier.key,
          growthTierLabel: tier.label,
          isPrime: tier.isPrime,
        },
        active,
        sortOrder: speciesIndex * 10 + tierIndex,
      }));
    });
  });

  const placeholders = currentIds.map(() => '?').join(',');
  store.db.prepare(`
    UPDATE economy_marketplace_catalog
    SET active = 0, updated_at = datetime('now')
    WHERE item_type = 'dino' AND id NOT IN (${placeholders})
  `).run(...currentIds);

  return items;
}

function updateOfficialCatalogItem({ catalogId, price, active }) {
  const item = store.getCatalogItem(catalogId);
  if (!item || item.item_type !== 'dino') {
    const error = new Error('Marketplace dinosaur item not found');
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }

  const tier = tierPolicyForItem(item);
  if (!tier) {
    const error = new Error('This official dinosaur tier has been retired');
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }

  const cost = Number(price);
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > 100000000) {
    throw new Error('Price must be a positive whole number');
  }
  if (tier.minimumPrice && cost < tier.minimumPrice) {
    throw new Error(`75% Prime dinosaurs have a minimum price of ${tier.minimumPrice.toLocaleString('en-AU')} Valley Coin`);
  }

  const updated = store.upsertCatalogItem({
    id: item.id,
    itemType: item.item_type,
    name: item.name,
    description: item.description,
    price: cost,
    payload: {
      ...item.payload,
      growth: tier.growth / 100,
      growthPercent: tier.growth,
      sizePercent: tier.growth,
      growthTier: tier.key,
      growthTierLabel: tier.label,
      isPrime: tier.isPrime,
    },
    active: active !== false,
    sortOrder: item.sort_order,
  });

  return assertOfficialDinoSalePolicy(updated);
}

function classPathForSpecies(speciesId) {
  return CLASS_PATHS[String(speciesId || '').trim().toLowerCase()] || null;
}

module.exports = {
  MIN_PRIME_75_PRICE,
  OFFICIAL_DINO_CATALOG,
  OFFICIAL_TIERS,
  CLASS_PATHS,
  seedOfficialCatalog,
  updateOfficialCatalogItem,
  assertOfficialDinoSalePolicy,
  classPathForSpecies,
};
