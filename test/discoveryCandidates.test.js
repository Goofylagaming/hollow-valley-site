const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCandidates } = require('../scripts/build-discovery-candidates.cjs');
const bounds = { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 };
test('candidate import preserves distinct entrances, rejects malformed coordinates and leaves gameplay decisions for review', () => {
  const a = { name: 'Same cave', lat: 1, long: 2 }, b = { name: 'Same cave', lat: 2, long: 3 };
  const first = buildCandidates({ caves: [a, b, a], water: [{ name: 'Bad', lat: '', long: 1 }] }, bounds);
  assert.equal(first.candidates.length, 2); assert.equal(first.rejected.length, 1);
  assert.deepEqual(first.candidates, buildCandidates({ caves: [b, a] }, bounds).candidates);
  assert.ok(first.candidates.every(point => !point.enabled && point.radiusMetres === null && point.regionId === null));
  assert.equal(first.candidates.find(point => point.x === 1000).y, 2000);
});
