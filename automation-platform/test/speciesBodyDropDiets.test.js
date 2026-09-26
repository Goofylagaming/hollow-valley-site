const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diets = require('../src/config/bodyDropDiets');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('restores the agreed Tyrannosaurus, Carnotaurus and Deinosuchus diets', () => {
  assert.deepEqual(diets.dietForSpecies('Tyrannosaurus').groups, {
    protein: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus'],
    carbohydrate: ['Diabloceratops', 'Triceratops', 'Hypsilophodon'],
    lipid: ['Maiasaura', 'Gallimimus', 'Dryosaurus', 'Beipiaosaurus'],
  });

  assert.deepEqual(diets.dietForSpecies('Carnotaurus').groups, {
    protein: ['Pachycephalosaurus', 'Tenontosaurus', 'Herrerasaurus'],
    carbohydrate: ['Omniraptor', 'Diabloceratops', 'Troodon'],
    lipid: ['Dryosaurus', 'Gallimimus', 'Dilophosaurus'],
  });

  assert.deepEqual(diets.dietForSpecies('Deinosuchus').groups, {
    protein: ['Tenontosaurus', 'Pachycephalosaurus', 'Ceratosaurus'],
    carbohydrate: ['Carnotaurus', 'Omniraptor', 'Diabloceratops', 'Deinosuchus', 'Troodon'],
    lipid: ['Gallimimus', 'Stegosaurus', 'Beipiaosaurus', 'Maiasaura'],
  });
});

test('restores every previously configured carnivore without inventing unsupported diets', () => {
  const configured = [
    'Tyrannosaurus',
    'Allosaurus',
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

  assert.equal(diets.dietForSpecies('Austroraptor'), null);
  assert.equal(diets.dietForSpecies('Beipiaosaurus'), null);
  assert.equal(diets.dietForSpecies('Baryonyx'), null);
});

test('Omnoraptor alias resolves to the Omniraptor diet', () => {
  assert.equal(diets.dietForSpecies('BP_Omnoraptor_C').species, 'Omniraptor');
});

test('Pteranodon keeps the agreed no-protein BodyDrop list', () => {
  const diet = diets.dietForSpecies('Pteranodon');
  assert.deepEqual(diet.groups.protein, []);
  assert.deepEqual(diet.groups.carbohydrate, ['Hypsilophodon', 'Troodon']);
  assert.deepEqual(diet.groups.lipid, ['Beipiaosaurus', 'Pteranodon']);
});

test('BodyDrop corpse growth is 75% of requester growth clamped to 15-40%', () => {
  assert.equal(diets.scaleCorpseGrowth(0.10), 0.15);
  assert.equal(diets.scaleCorpseGrowth(0.20), 0.15);
  assert.equal(diets.scaleCorpseGrowth(0.40), 0.30);
  assert.equal(diets.scaleCorpseGrowth(0.60), 0.40);
  assert.equal(diets.scaleCorpseGrowth(60), 0.40);
});

test('diet options carry nutrient identity, prey species and scaled growth', () => {
  const options = diets.optionsForSpecies('Carnotaurus', 0.40);
  const herrera = options.find((option) => option.id === 'protein-herrerasaurus');
  assert.ok(herrera);
  assert.equal(herrera.nutrient, 'protein');
  assert.equal(herrera.species, 'Herrerasaurus');
  assert.equal(herrera.growth, 0.30);
  assert.equal(herrera.growthPercent, 30);
});

test('regular BodyDrop API is wired to the species service while global emergency remains separate', () => {
  const routes = readRepoFile('automation-platform/src/routes/bodyDropRoutes.js');
  const speciesService = readRepoFile('automation-platform/src/services/speciesBodyDropService.js');
  const baseService = readRepoFile('automation-platform/src/services/bodyDropService.js');

  assert.match(routes, /speciesBodyDrop\.getBodyDropState/);
  assert.match(routes, /speciesBodyDrop\.requestBodyDrop/);
  assert.match(routes, /BODYDROP_DIET_MISMATCH/);

  assert.match(speciesService, /bodyDropDiets\.optionsForSpecies/);
  assert.match(speciesService, /baseBodyDrop\.bodyDropEligibility/);
  assert.match(speciesService, /baseBodyDrop\.assertBodyDropAvailable/);
  assert.match(speciesService, /buildCommand\('bd'/);
  assert.match(speciesService, /requestMode: 'species-diet'/);

  assert.match(baseService, /activateGlobalBodyDrop/);
  assert.match(baseService, /GLOBAL_BODYDROP_DROP_TYPE/);
});

test('website BodyDrop renders live diet options instead of generic fallback bodies', () => {
  const route = readRepoFile('server/routes/bodydrop.js');
  const client = readRepoFile('public/assets/bodydrop.js');

  assert.match(route, /options: Array\.isArray\(result\.options\) \? result\.options : \[\]/);
  assert.match(route, /dietEligibility/);
  assert.match(route, /corpseGrowthPercent/);

  assert.match(client, /nutrientGroupLabel/);
  assert.match(client, /PROTEIN/);
  assert.match(client, /CARBOHYDRATE/);
  assert.match(client, /LIPID/);
  assert.match(client, /data\.dietEligibility/);
});
