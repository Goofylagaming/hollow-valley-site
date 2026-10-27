'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('public/assets/status-page.js');

async function render(snapshot, overrides = {}) {
  const ids = [
    'status-overall', 'status-refreshed', 'status-refresh', 'status-snapshot-time',
    'status-website-card', 'status-website-state', 'status-website-detail',
    'status-storage-card', 'status-storage-state', 'status-storage-detail',
    'status-game-card', 'status-game-state', 'status-game-detail',
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, {
    textContent: '', dataset: {}, disabled: false,
    addEventListener() {},
  }]));
  const defaultResponses = {
    '/healthz': { ok: true },
    '/readyz': { ok: true },
    '/api/server-status': snapshot,
  };
  const responses = { ...defaultResponses, ...overrides };
  const fetch = async (route) => {
    const value = responses[route];
    if (value instanceof Error) throw value;
    return { ok: value.httpOk !== false, json: async () => value.body || value };
  };
  const document = {
    readyState: 'complete',
    hidden: false,
    getElementById: (id) => nodes[id] || null,
  };
  vm.runInNewContext(source, {
    document, fetch, AbortController, setTimeout, clearTimeout,
    setInterval: () => 0, Date, Number, String,
  });
  await new Promise(resolve => setImmediate(resolve));
  return nodes;
}

test('status page is public, read-only and reachable without adding crowded navigation tabs', () => {
  const html = read('public/status.html');
  const index = read('public/index.html');
  const server = read('server/index.js');
  const roadmap = read('public/assets/home-roadmap.js');
  const sourceHome = read('public/assets/home-v2.js');
  assert.match(html, /\/assets\/status-page\.js\?v=1/);
  assert.match(html, /\/assets\/status-page\.css\?v=1/);
  assert.match(html, /not independently monitored/);
  assert.match(index, /href="\/status"/);
  assert.match(server, /"events", "status"/);
  assert.match(roadmap, /29: \{ status: 'building'/);
  assert.match(roadmap, /View status page/);
  assert.match(sourceHome, /status\?\.online && !status\?\.stale/);
  assert.match(source, /request\('\/healthz'\)/);
  assert.match(source, /request\('\/readyz'\)/);
  assert.match(source, /request\('\/api\/server-status'\)/);
  assert.doesNotMatch(source, /RCON_PASSWORD|HOLLOW_VALLEY_API_TOKEN|\/api\/(wallet|dinostorage|bodydrop)/);
  assert.doesNotThrow(() => new Function(source));
});

test('a verified fresh game snapshot can show online player count', async () => {
  const nodes = await render({
    configured: true, online: true, stale: false, playerCount: 12, maxPlayers: 100,
    lastChecked: new Date().toISOString(), players: ['PrivateNameIsNotShown'],
  });
  assert.equal(nodes['status-game-state'].textContent, 'Online');
  assert.match(nodes['status-game-detail'].textContent, /12 \/ 100 players/);
  assert.match(nodes['status-overall'].textContent, /Game server online/);
  assert.doesNotMatch(Object.values(nodes).map(n => n.textContent).join(' '), /PrivateNameIsNotShown/);
});

test('stale snapshots never claim an online game or show retained player counts', async () => {
  const nodes = await render({
    configured: true, online: true, stale: true, playerCount: 99, maxPlayers: 100,
    lastChecked: new Date().toISOString(),
  });
  assert.equal(nodes['status-game-state'].textContent, 'Delayed');
  assert.equal(nodes['status-game-card'].dataset.state, 'delayed');
  assert.match(nodes['status-overall'].textContent, /unverified/);
  assert.doesNotMatch(nodes['status-game-detail'].textContent, /99/);
});

test('an expired or future game snapshot is also delayed', async () => {
  for (const ts of [
    new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  ]) {
    const nodes = await render({ configured: true, online: true, stale: false, lastChecked: ts });
    assert.equal(nodes['status-game-state'].textContent, 'Delayed');
  }
});

test('unconfigured and unreachable monitors do not masquerade as offline games', async () => {
  const missing = await render({ configured: false, online: false, stale: true });
  assert.equal(missing['status-game-state'].textContent, 'Not monitored');
  const unreachable = await render({}, { '/api/server-status': new Error('upstream unavailable') });
  assert.equal(unreachable['status-game-state'].textContent, 'Unknown');
  assert.match(unreachable['status-overall'].textContent, /unverified/);
});

test('website readiness failure is independent from game status', async () => {
  const nodes = await render({
    configured: true, online: true, stale: false, lastChecked: new Date().toISOString(),
  }, { '/readyz': { httpOk: false, body: { ok: false } } });
  assert.equal(nodes['status-storage-state'].textContent, 'Not ready');
  assert.match(nodes['status-overall'].textContent, /Website not ready/);
});
