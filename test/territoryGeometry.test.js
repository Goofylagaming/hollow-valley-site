const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BATTLEFIELD_RADIUS,
  DEFAULT_CLAIM_RADIUS,
  regionAnchor,
  territoryGeometry,
  classifyLatLong,
  classifyWorldPosition,
} = require('../server/services/territoryGeometry');

test('South Plains uses the existing Gateway region anchor', () => {
  const anchor = regionAnchor('south-plains');
  assert.deepEqual(anchor, { name: 'South Plains', lat: 250, long: -302 });

  const geometry = territoryGeometry({ territoryName: 'South Plains' });
  assert.equal(geometry.center.lat, 250);
  assert.equal(geometry.center.long, -302);
  assert.equal(geometry.battlefieldRadius, DEFAULT_BATTLEFIELD_RADIUS);
  assert.equal(geometry.claimRadius, DEFAULT_CLAIM_RADIUS);
  assert.equal(geometry.source, 'region-anchor');
});

test('battlefield and claim zones are classified independently', () => {
  const geometry = territoryGeometry({
    territoryName: 'South Plains',
    battlefieldRadius: 60,
    claimRadius: 20,
  });

  const centre = classifyLatLong({ lat: 250, long: -302 }, geometry);
  assert.equal(centre.inBattlefield, true);
  assert.equal(centre.inClaim, true);

  const battlefieldOnly = classifyLatLong({ lat: 280, long: -302 }, geometry);
  assert.equal(battlefieldOnly.inBattlefield, true);
  assert.equal(battlefieldOnly.inClaim, false);
  assert.equal(battlefieldOnly.distanceMetres, 300);

  const outside = classifyLatLong({ lat: 315, long: -302 }, geometry);
  assert.equal(outside.inBattlefield, false);
  assert.equal(outside.inClaim, false);
});

test('custom event centre overrides the named-region anchor', () => {
  const geometry = territoryGeometry({
    territoryName: 'South Plains',
    centerLat: 260,
    centerLong: -290,
    battlefieldRadius: 50,
    claimRadius: 15,
  });

  assert.deepEqual(geometry.center, { lat: 260, long: -290 });
  assert.equal(geometry.source, 'event-config');
  assert.equal(classifyLatLong({ lat: 260, long: -290 }, geometry).inClaim, true);
});

test('claim radius cannot exceed battlefield radius', () => {
  const geometry = territoryGeometry({
    territoryName: 'South Plains',
    battlefieldRadius: 25,
    claimRadius: 100,
  });

  assert.equal(geometry.battlefieldRadius, 25);
  assert.equal(geometry.claimRadius, 25);
});

test('raw Evrima world coordinates classify through the same Lat/Long geometry', () => {
  const geometry = territoryGeometry({ territoryName: 'South Plains' });
  const result = classifyWorldPosition(250000, -302000, geometry);
  assert.equal(result.valid, true);
  assert.equal(result.inBattlefield, true);
  assert.equal(result.inClaim, true);
});
