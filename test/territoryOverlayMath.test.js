const test = require("node:test");
const assert = require("node:assert/strict");

const {
  direction8,
  timerState,
  radarPoint,
  resolveViewMode,
} = require("../server/services/territoryOverlayMath");

test("direction8 follows Gateway north/south orientation", () => {
  const origin = { lat: 0, long: 0 };
  assert.equal(direction8(origin, { lat: -10, long: 0 }), "N");
  assert.equal(direction8(origin, { lat: -10, long: 10 }), "NE");
  assert.equal(direction8(origin, { lat: 0, long: 10 }), "E");
  assert.equal(direction8(origin, { lat: 10, long: 10 }), "SE");
  assert.equal(direction8(origin, { lat: 10, long: 0 }), "S");
  assert.equal(direction8(origin, { lat: 10, long: -10 }), "SW");
  assert.equal(direction8(origin, { lat: 0, long: -10 }), "W");
  assert.equal(direction8(origin, { lat: -10, long: -10 }), "NW");
});

test("timerState exposes warning and claim arming countdown phases", () => {
  const now = Date.parse("2026-10-07T00:00:00.000Z");
  const event = { status: "live" };

  assert.deepEqual(timerState(event, {
    status: "warning",
    starts_at: "2026-10-07T00:05:00.000Z",
  }, now), {
    phase: "attack-warning",
    label: "Attack begins",
    endsAt: "2026-10-07T00:05:00.000Z",
  });

  assert.deepEqual(timerState(event, {
    status: "active",
    contest_started_at: "2026-10-07T00:00:30.000Z",
  }, now), {
    phase: "claim-arming",
    label: "Claim Zone activates",
    endsAt: "2026-10-07T00:02:30.000Z",
  });

  assert.equal(timerState(event, {
    status: "active",
    contest_started_at: "2026-10-06T23:57:00.000Z",
  }, now).phase, "control-live");
});

test("role requests can only downgrade overlay information", () => {
  assert.equal(resolveViewMode({ is_admin: 0 }, { role: "member" }, "admin"), "player");
  assert.equal(resolveViewMode({ is_admin: 0 }, { role: "leader" }, "admin"), "leader");
  assert.equal(resolveViewMode({ is_admin: 1 }, { role: "leader" }, "player"), "player");
  assert.equal(resolveViewMode({ is_admin: 1 }, { role: "leader" }, "admin"), "admin");
});

test("radarPoint clamps the viewer marker to the battlefield ring", () => {
  const geometry = {
    center: { lat: 100, long: 100 },
    battlefieldRadius: 50,
  };

  assert.deepEqual(radarPoint({ lat: 100, long: 100 }, geometry), {
    x: 0,
    y: 0,
    outsideBattlefield: false,
  });

  const outside = radarPoint({ lat: 100, long: 200 }, geometry);
  assert.equal(outside.outsideBattlefield, true);
  assert.equal(outside.x, 1);
  assert.equal(outside.y, 0);
});
