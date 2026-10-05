const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTROL_CONTRIBUTOR_CAP,
  effectivePresence,
  controlRatePerMinute,
  advanceControlScore,
} = require('../server/services/territoryControl');

test('control contribution is capped so large zergs do not accelerate capture indefinitely', () => {
  assert.equal(CONTROL_CONTRIBUTOR_CAP, 4);
  assert.equal(effectivePresence(4), 4);
  assert.equal(effectivePresence(10), 4);

  const four = controlRatePerMinute({ attackers: 4, defenders: 0 });
  const ten = controlRatePerMinute({ attackers: 10, defenders: 0 });
  assert.equal(four.rate, ten.rate);
  assert.equal(four.rate, 7);
  assert.equal(ten.effectiveAttackers, 4);
});

test('equal effective presence freezes territory movement', () => {
  const state = controlRatePerMinute({ attackers: 3, defenders: 3 });
  assert.equal(state.rate, 0);
  assert.equal(state.contested, true);
});

test('a defender advantage pushes control back toward the owner', () => {
  const state = controlRatePerMinute({ attackers: 2, defenders: 3 });
  assert.equal(state.rate, -4);
});

test('control advancement uses capped presence and clamps the score to territory limits', () => {
  const oneMinute = advanceControlScore({
    score: -100,
    attackers: 10,
    defenders: 0,
    elapsedSeconds: 60,
  });
  assert.equal(oneMinute.score, -93);

  const captured = advanceControlScore({
    score: 99,
    attackers: 4,
    defenders: 0,
    elapsedSeconds: 60,
  });
  assert.equal(captured.score, 100);

  const defended = advanceControlScore({
    score: -99,
    attackers: 0,
    defenders: 4,
    elapsedSeconds: 60,
  });
  assert.equal(defended.score, -100);
});
