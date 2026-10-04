const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCombatLine, parseUnrealUtcTimestamp } = require('../scripts/game-combat-line');

test('combat parser uses outer Unreal UTC timestamp before daylight saving', () => {
  const line = '[2026.10.02-20.45.11:960][542]LogTheIsleKillData: [2026.10.03-06.45.11] Goofy [76561198038977506] Dino: Tyrannosaurus, Female, 0.776618 - Killed the following player: Heart Eternal, [76561197998095210], Dino: Diabloceratops, Gender: Female, Growth: 0.256452, at: X=75005.663 Y=-61468.513 Z=37199.856';
  const event = parseCombatLine(line);
  assert.equal(event.occurredAt, '2026-10-02T20:45:11.960Z');
  assert.equal(event.killerSteamId, '76561198038977506');
  assert.equal(event.victimSteamId, '76561197998095210');
});

test('combat parser stays correct when Windows local log time advances to UTC+11 for DST', () => {
  const line = '[2026.10.04-03.26.00:123][101]LogTheIsleKillData: [2026.10.04-14.26.00] Stressed_ [76561198000000001] Dino: Tyrannosaurus, Female, 0.800000 - Killed the following player: Joeyy, [76561198000000002], Dino: Omniraptor, Gender: Male, Growth: 0.700000, at: X=1 Y=2 Z=3';
  const event = parseCombatLine(line);
  assert.equal(event.occurredAt, '2026-10-04T03:26:00.123Z');
  assert.equal(event.killerName, 'Stressed_');
  assert.equal(event.victimName, 'Joeyy');
});

test('natural deaths also use outer UTC timestamp', () => {
  const line = '[2026.10.04-03.27.10:456][102]LogTheIsleKillData: [2026.10.04-14.27.10] DreamWolfer12 [76561198000000003] Dino: Gallimimus, Female, 0.500000 - Died from Natural cause';
  const event = parseCombatLine(line);
  assert.equal(event.occurredAt, '2026-10-04T03:27:10.456Z');
  assert.equal(event.killerSteamId, null);
  assert.equal(event.victimName, 'DreamWolfer12');
});

test('outer Unreal timestamp parser accepts millisecond precision', () => {
  assert.equal(
    parseUnrealUtcTimestamp('[2026.10.04-03.27.10:007][999]anything'),
    '2026-10-04T03:27:10.007Z'
  );
});
