const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";

const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/map");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("map activity is public aggregate data while exact positions stay authenticated", async (t) => {
  const original = automation.getMapActivity;
  automation.getMapActivity = async () => ({
    trackingEnabled: true,
    hours: 24,
    sampleCount: 2,
    uniquePlayers: 3,
    sessions: 4,
    averageOnline: 1.5,
    peakConcurrent: 3,
    topSpecies: [{ species: "Triceratops", sampleCount: 2 }],
    activityTrend: [],
    lastVerifiedAt: "2026-09-21T05:00:00.000Z",
  });
  t.after(() => { automation.getMapActivity = original; });

  const app = express();
  app.use("/api/map", router);
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  const activity = await fetch(`${base}/api/map/activity?hours=24`);
  assert.equal(activity.status, 200);
  const body = await activity.json();
  assert.equal(body.peakConcurrent, 3);
  assert.equal(body.uniquePlayers, 3);
  assert.equal(JSON.stringify(body).includes("steam"), false);

  const positions = await fetch(`${base}/api/map/positions`);
  assert.equal(positions.status, 401);
});

test("map activity fails safely without leaking stale coordinate data", async (t) => {
  const original = automation.getMapActivity;
  automation.getMapActivity = async () => {
    const error = new Error("automation unavailable");
    error.status = 503;
    throw error;
  };
  t.after(() => { automation.getMapActivity = original; });

  const app = express();
  app.use("/api/map", router);
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/map/activity`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.trackingEnabled, false);
  assert.equal(body.sampleCount, 0);
  assert.equal(Object.hasOwn(body, "positions"), false);
  assert.equal(Object.hasOwn(body, "players"), false);
});
