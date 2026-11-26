const test = require("node:test");
const assert = require("node:assert/strict");
const warWindow = require("../server/services/territoryWindow");

const saturdayEvening = Date.parse("2026-11-28T09:30:00.000Z");

test("Saturday 28 Nov 2026 7:30pm Brisbane is inside the default war window", () => {
  assert.equal(warWindow.isOpen(saturdayEvening), true);
  assert.equal(warWindow.isOpen(Date.parse("2026-11-28T08:59:00.000Z")), false);
  assert.equal(warWindow.isOpen(Date.parse("2026-11-28T11:00:00.000Z")), false);
});

test("a capture during the window is protected until the next Saturday 7pm Brisbane", () => {
  const next = warWindow.nextWindowStart(saturdayEvening);
  assert.equal(next.toISOString(), "2026-12-05T09:00:00.000Z");
});
