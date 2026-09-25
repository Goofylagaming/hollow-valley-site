const store = require('./economyStore');

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

function seedOfficialCatalog() {
  const tiers = [
    { key: 'mid', growth: 60, priceMultiplier: 0.75, label: '50–74%' },
    { key: 'high', growth: 85, priceMultiplier: 1.15, label: '75%+' },
    { key: 'prime', growth: 100, priceMultiplier: 1.5, label: 'Prime', isPrime: true },
  ];
  const currentIds = [];
  const items = [];
  OFFICIAL_DINO_CATALOG.forEach(([speciesId, speciesName, basePrice], speciesIndex) => {
    tiers.forEach((tier, tierIndex) => {
      const id = `dino:${speciesId}:${tier.key}`;
      currentIds.push(id);
      const existing = store.getCatalogItem(id);
      if (existing) {
        items.push(existing);
        return;
      }
      items.push(store.upsertCatalogItem({
        id,
        itemType: 'dino',
        name: `${speciesName} ${tier.label}`,
        description: `Official Hollow Valley ${speciesName} ${tier.label} growth purchase.`,
        price: Math.max(1, Math.round(basePrice * tier.priceMultiplier)),
        payload: {
          speciesId,
          species: speciesName,
          classPath: CLASS_PATHS[speciesId],
          growth: tier.growth / 100,
          growthPercent: tier.growth,
          sizePercent: tier.growth,
          growthTier: tier.key,
          growthTierLabel: tier.label,
          isPrime: Boolean(tier.isPrime),
        },
        active: true,
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

function updateOfficialCatalogItem({ catalogId, price, growthPercent, active, isPrime }) {
  const item = store.getCatalogItem(catalogId);
  if (!item || item.item_type !== 'dino') {
    const error = new Error('Marketplace dinosaur item not found');
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }
  const growth = Number(growthPercent);
  const cost = Number(price);
  if (!Number.isInteger(growth) || growth < 1 || growth > 100) throw new Error('Growth must be a whole percentage from 1 to 100');
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > 100000000) throw new Error('Price must be a positive whole number');
  const tier = String(item.payload?.growthTier || '');
  if (tier === 'starter') {
    const error = new Error('25–49% official marketplace tier has been retired');
    error.code = 'CATALOG_ITEM_UNAVAILABLE';
    throw error;
  }
  if (tier === 'mid' && (growth < 50 || growth > 74)) throw new Error('50–74% tier growth must stay between 50 and 74');
  if (tier === 'high' && growth < 75) throw new Error('75%+ tier growth must be between 75 and 100');
  if (tier === 'prime' && !isPrime) throw new Error('Prime tier must grant Prime status');
  return store.upsertCatalogItem({
    id: item.id,
    itemType: item.item_type,
    name: item.name,
    description: item.description,
    price: cost,
    payload: { ...item.payload, growth: growth / 100, growthPercent: growth, sizePercent: growth, isPrime: Boolean(isPrime) },
    active: active !== false,
    sortOrder: item.sort_order,
  });
}

function classPathForSpecies(speciesId) {
  return CLASS_PATHS[String(speciesId || '').trim().toLowerCase()] || null;
}

module.exports = {
  OFFICIAL_DINO_CATALOG,
  CLASS_PATHS,
  seedOfficialCatalog,
  updateOfficialCatalogItem,
  classPathForSpecies,
};
