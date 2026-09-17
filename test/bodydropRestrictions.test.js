const test = require("node:test");
const assert = require("node:assert/strict");
const bodydropRouter = require("../server/routes/bodydrop");

const {
  bodyDropEligibility,
  growthPercent,
  isCarnivoreSpecies,
} = bodydropRouter._private;

test("bodydrop growth converts fractions and percentages", () => {
  assert.equal(growthPercent(0.6), 60);
  assert.equal(growthPercent(60), 60);
  assert.equal(growthPercent(1), 100);
  assert.equal(growthPercent(null), null);
  assert.equal(growthPercent(undefined), null);
});

test("bodydrop recognizes supported carnivore species and rejects herbivores", () => {
  assert.equal(isCarnivoreSpecies("Carnotaurus"), true);
  assert.equal(isCarnivoreSpecies("BP_Carnotaurus_C"), true);
  assert.equal(isCarnivoreSpecies("Pteranodon"), true);
  assert.equal(isCarnivoreSpecies("Compsognathus"), true);
  assert.equal(isCarnivoreSpecies("Austroraptor"), true);
  assert.equal(isCarnivoreSpecies("Triceratops"), false);
  assert.equal(isCarnivoreSpecies("Gallimimus"), false);
  assert.equal(isCarnivoreSpecies("Beipiaosaurus"), false);
});

test("bodydrop allows carnivores at exactly 60 percent growth", () => {
  const result = bodyDropEligibility({ species: "Carnotaurus", growth: 0.6 });
  assert.equal(result.eligible, true);
  assert.equal(result.growthPercent, 60);
});

test("bodydrop rejects carnivores above 60 percent growth", () => {
  const result = bodyDropEligibility({ species: "Carnotaurus", growth: 0.601 });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /60% growth or below/);
});

test("bodydrop rejects non-carnivores regardless of growth", () => {
  const result = bodyDropEligibility({ species: "Tenontosaurus", growth: 0.25 });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /only available to carnivores/);
});

test("bodydrop rejects requests when live growth is unavailable", () => {
  const result = bodyDropEligibility({ species: "Carnotaurus", growth: null });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /growth could not be verified/);
});
