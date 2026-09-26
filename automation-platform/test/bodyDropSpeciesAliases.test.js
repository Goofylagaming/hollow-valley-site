const test = require('node:test');
const assert = require('node:assert/strict');

const diets = require('../src/config/bodyDropDiets');

test('Deino shorthand and blueprint class names resolve to Deinosuchus diet', () => {
  assert.equal(diets.dietForSpecies('Deino')?.species, 'Deinosuchus');
  assert.equal(diets.dietForSpecies('BP_Deino_C')?.species, 'Deinosuchus');
  assert.equal(diets.dietForSpecies('/Game/TheIsle/Core/Characters/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C')?.species, 'Deinosuchus');
});
