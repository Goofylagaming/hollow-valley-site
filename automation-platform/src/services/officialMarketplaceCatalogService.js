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
  return OFFICIAL_DINO_CATALOG.map(([speciesId, speciesName, price], index) =>
    store.upsertCatalogItem({
      id: `dino:${speciesId}:75`,
      itemType: 'dino',
      name: `${speciesName} 75%`,
      description: `Official Hollow Valley ${speciesName} growth purchase. Redeem into a matching live ${speciesName}.`,
      price,
      payload: {
        speciesId,
        species: speciesName,
        classPath: CLASS_PATHS[speciesId],
        growth: 0.75,
        growthPercent: 75,
        sizePercent: 75,
      },
      active: true,
      sortOrder: index,
    })
  );
}

function classPathForSpecies(speciesId) {
  return CLASS_PATHS[String(speciesId || '').trim().toLowerCase()] || null;
}

module.exports = {
  OFFICIAL_DINO_CATALOG,
  CLASS_PATHS,
  seedOfficialCatalog,
  classPathForSpecies,
};
