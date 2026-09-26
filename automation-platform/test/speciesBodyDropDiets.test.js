const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diets = require('../src/config/bodyDropDiets');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('uses the current alpha beta gamma nutrient mapping', () => {
  assert.equal(diets.NUTRIENTS.carbohydrate.symbol, 'α');
  assert.equal(diets.NUTRIENTS.protein.symbol, 'β');
  assert.equal(diets.NUTRIENTS.lipid.symbol, 'γ');
  assert.equal(diets.DIET_SOURCE_UPDATED_AT, '2026-09-04');
});

test('restores the current Tyrannosaurus, Carnotaurus and Deinosuchus diets', () => {
  assert.deepEqual(diets.dietForSpecies('Tyrannosaurus').groups, {
    protein: ['Diabloceratops', 'Triceratops', 'Hypsilophodon', 'Deer', 'Chicken', 'Rabbit'],
    carbohydrate: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus', 'Boar', 'Crab', 'Kentrosaurus'],
    lipid: ['Maiasaura', 'Gallimimus', 'Dryosaurus', 'Beipiaosaurus', 'Goat', 'Psittacosaurus', 'Sea Turtle'],
  });

  assert.deepEqual(diets.dietForSpecies('Carnotaurus').groups, {
    protein: ['Omniraptor', 'Diabloceratops', 'Troodon', 'Deer'],
    carbohydrate: ['Pachycephalosaurus', 'Tenontosaurus', 'Herrerasaurus', 'Boar'],
    lipid: ['Dryosaurus', 'Gallimimus', 'Maiasaura'],
  });

  assert.deepEqual(diets.dietForSpecies('Deinosuchus').groups, {
    protein: ['Carnotaurus', 'Omniraptor', 'Diabloceratops', 'Deinosuchus', 'Troodon', 'Bullfrog'],
    carbohydrate: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus', 'Ceratosaurus', 'Kentrosaurus'],
    lipid: ['Elite Fish', 'Gallimimus', 'Beipiaosaurus', 'Maiasaura', 'Sea Turtle'],
  });
});

test('Troodon uses the current full diet rather than the older reduced map', () => {
  assert.deepEqual(diets.dietForSpecies('Troodon').groups, {
    protein: ['Bullfrog', 'Chicken', 'Deer', 'Rabbit', 'Compsognathus', 'Hypsilophodon'],
    carbohydrate: ['Stegosaurus', 'Crab', 'Pachycephalosaurus', 'Tenontosaurus', 'Kentrosaurus'],
    lipid: ['Goat', 'Psittacosaurus', 'Dryosaurus', 'Pteranodon', 'Maiasaura'],
  });
});

test('configures every current carnivore BodyDrop diet including Austroraptor', () => {
  const configured = [
    'Tyrannosaurus',
    'Allosaurus',
    'Austroraptor',
    'Carnotaurus',
    'Ceratosaurus',
    'Deinosuchus',
    'Dilophosaurus',
    'Herrerasaurus',
    'Omniraptor',
    'Troodon',
    'Pteranodon',
  ];

  for (const species of configured) {
    assert.ok(diets.dietForSpecies(species), `${species} should have a configured diet`);
  }

  assert.equal(diets.dietForSpecies('Beipiaosaurus'), null);
  assert.equal(diets.dietForSpecies('Baryonyx'), null);
});

test('Omnoraptor alias resolves to the Omniraptor diet', () => {
  assert.equal(diets.dietForSpecies('BP_Omnoraptor_C').species, 'Omniraptor');
});

test('Pteranodon carries the current fish and small-prey diet', () => {
  const diet = diets.dietForSpecies('Pteranodon');
  assert.deepEqual(diet.groups.protein, ['Chicken', 'Hypsilophodon', 'Bullfrog', 'Rabbit', 'Troodon']);
  assert.deepEqual(diet.groups.carbohydrate, ['Schooling Fish', 'Crab', 'Clam']);
  assert.deepEqual(diet.groups.lipid, ['Sea Turtle', 'Psittacosaurus', 'Beipiaosaurus', 'Pterodactylus']);
});

test('BodyDrop corpse growth is 75% of requester growth clamped to 15-40%', () => {
  assert.equal(diets.scaleCorpseGrowth(0.10), 0.15);
  assert.equal(diets.scaleCorpseGrowth(0.20), 0.15);
  assert.equal(diets.scaleCorpseGrowth(0.40), 0.30);
  assert.equal(diets.scaleCorpseGrowth(0.60), 0.40);
  assert.equal(diets.scaleCorpseGrowth(60), 0.40);
});

test('diet options expose current foods while fail-closing unsupported corpse actors', () => {
  const options = diets.optionsForSpecies('Troodon', 0.40);
  const compy = options.find((option) => option.id === 'protein-compsognathus');
  const chicken = options.find((option) => option.id === 'protein-chicken');
  const stego = options.find((option) => option.id === 'carbohydrate-stegosaurus');

  assert.ok(compy);
  assert.equal(compy.available, true);
  assert.equal(compy.growth, 0.30);
  assert.equal(compy.growthPercent, 30);

  assert.ok(chicken);
  assert.equal(chicken.available, false);
  assert.match(chicken.unavailableReason, /not BodyDrop-spawnable yet/);

  assert.ok(stego);
  assert.equal(stego.available, true);
});

test('regular BodyDrop API is wired to species service and refuses unavailable diet prey', () => {
  const routes = readRepoFile('automation-platform/src/routes/bodyDropRoutes.js');
  const speciesService = readRepoFile('automation-platform/src/services/speciesBodyDropService.js');
  const baseService = readRepoFile('automation-platform/src/services/bodyDropService.js');

  assert.match(routes, /speciesBodyDrop\.getBodyDropState/);
  assert.match(routes, /speciesBodyDrop\.requestBodyDrop/);
  assert.match(routes, /BODYDROP_DIET_MISMATCH/);

  assert.match(speciesService, /bodyDropDiets\.optionsForSpecies/);
  assert.match(speciesService, /entry\.available !== false/);
  assert.match(speciesService, /requestedOption\?\.available === false/);
  assert.match(speciesService, /baseBodyDrop\.bodyDropEligibility/);
  assert.match(speciesService, /baseBodyDrop\.assertBodyDropAvailable/);
  assert.match(speciesService, /buildCommand\('bd'/);
  assert.match(speciesService, /requestMode: 'species-diet'/);

  assert.match(baseService, /activateGlobalBodyDrop/);
  assert.match(baseService, /GLOBAL_BODYDROP_DROP_TYPE/);
});

test('website BodyDrop renders current diet options and unavailable prey state', () => {
  const route = readRepoFile('server/routes/bodydrop.js');
  const client = readRepoFile('public/assets/bodydrop.js');

  assert.match(route, /options: Array\.isArray\(result\.options\) \? result\.options : \[\]/);
  assert.match(route, /dietEligibility/);
  assert.match(route, /corpseGrowthPercent/);

  assert.match(client, /nutrientGroupLabel/);
  assert.match(client, /β/);
  assert.match(client, /α/);
  assert.match(client, /γ/);
  assert.match(client, /option\.available === false/);
  assert.match(client, /Greyed-out prey/);
  assert.match(client, /data\.dietEligibility/);
});
