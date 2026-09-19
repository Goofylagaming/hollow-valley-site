const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

const { normalizeStoredDino } = require('../src/services/dinoStorageService');

test('stored dino normalization preserves the live My Dinos response shape', () => {
  const stored = normalizeStoredDino({
    version: 2,
    slot: 'dino-test',
    classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C',
    growth: 0.76,
    health: 800,
    maxHealth: 1000,
    hunger: 55,
    maxHunger: 100,
    stamina: 75,
    maxStamina: 100,
    thirst: 66,
    maxThirst: 100,
    blood: 900,
    maxBlood: 1000,
    isFemale: true,
    isPrime: true,
    capturedAt: 1770000000,
    mutations: {
      Slot1: 'Truculency',
      Slot2: '',
      ParentSlot1: 'Truculency',
      Slot3: 'None',
    },
    nutrients: { carbValue: 10 },
  }, 'fallback');

  assert.equal(stored.slot, 'dino-test');
  assert.equal(stored.species, 'Triceratops');
  assert.equal(stored.gender, 'Female');
  assert.equal(stored.isPrime, true);
  assert.equal(stored.health, 800);
  assert.equal(stored.maxHealth, 1000);
  assert.equal(stored.hunger, 55);
  assert.equal(stored.maxHunger, 100);
  assert.equal(stored.stamina, 75);
  assert.equal(stored.maxStamina, 100);
  assert.equal(stored.thirst, 66);
  assert.equal(stored.maxThirst, 100);
  assert.equal(stored.blood, 900);
  assert.equal(stored.maxBlood, 1000);
  assert.deepEqual(stored.mutationList, ['Truculency']);
  assert.deepEqual(stored.mutations, {
    Slot1: 'Truculency',
    Slot2: '',
    ParentSlot1: 'Truculency',
    Slot3: 'None',
  });
  assert.deepEqual(stored.nutrients, { carbValue: 10 });
});
