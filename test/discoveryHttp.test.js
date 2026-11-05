const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

test('discovery account APIs isolate actors and protect consent and clearing', async () => {
  const keys = ['POI_DISCOVERY_ENABLED', 'POI_DISCOVERY_READ_ONLY', 'POI_DISCOVERY_CATALOG_VERSION', 'VALLEY_LEGACY_ENABLED', 'HOLLOW_VALLEY_API_TOKEN', 'AUTOMATION_SERVICE_URL', 'SKIN_STUDIO_READ_ONLY', 'RENDER_SERVICE_ID', 'RENDER_EXTERNAL_URL', 'PUBLIC_SITE_URL', 'STEAM_REALM', 'STEAM_RETURN_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { POI_DISCOVERY_ENABLED: '1', POI_DISCOVERY_CATALOG_VERSION: 'v1', VALLEY_LEGACY_ENABLED: '1', HOLLOW_VALLEY_API_TOKEN: 'isolated-discovery-fixture-token' });
  const db = new DatabaseSync(':memory:');
  const discoveries = require('../automation-platform/src/services/discoveryVisitStore').createDiscoveryVisitStore(db);
  require('../automation-platform/src/services/discoveryCatalog').createDiscoveryCatalogStore(db).register({ version: 'v1', mapVersion: 'fixture', bounds: { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 }, regions: [{ id: 'north', name: 'North' }], points: [{ id: 'secret', name: 'Hidden Cave', category: 'cave', regionId: 'north', enabled: true, x: 0, y: 0, radiusMetres: 50 }] });
  const steam = '76561198000000801', other = '76561198000000802';
  const legacy = require('../automation-platform/src/services/valleyLegacyService'), originalGet = legacy.get;
  legacy.get = () => ({ discoveries });
  let backend, website;
  try {
    const internal = express(); internal.use(express.json()); internal.use('/api/website/legacy/discovery', require('../automation-platform/src/routes/discoveryRoutes')); backend = await listen(internal);
    process.env.AUTOMATION_SERVICE_URL = backend.url;
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { if (req.get('x-user')) req.user = { steam_id: req.get('x-user') }; next(); }); app.use('/discovery', require('../server/routes/discovery')); website = await listen(app);
    const request = (path, body, user = steam, origin = website.url) => fetch(website.url + '/discovery' + path, { method: body ? 'POST' : 'GET', headers: { 'x-user': user, Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await request('/settings', null, '')).status, 401);
    assert.equal((await request('/settings', null, 'bad')).status, 403);
    assert.equal((await fetch(backend.url + '/api/website/legacy/discovery/settings', { method: 'POST' })).status, 401);
    assert.equal((await request('/settings', { enabled: true, expectedRevision: 0 }, steam, 'https://other.invalid')).status, 403);
    assert.equal((await request('/settings', { enabled: true, expectedRevision: 0, steamId: other })).status, 200);
    assert.equal(discoveries.settings(steam).enabled, true); assert.equal(discoveries.settings(other).enabled, false);
    const hidden = await request('/points?version=forged&steamId=' + other);
    assert.equal(hidden.headers.get('cache-control'), 'private, no-store'); assert.equal(JSON.stringify(await hidden.json()).includes('Hidden Cave'), false);
    db.prepare('INSERT INTO discovery_visits VALUES (?,?,?,?)').run(steam, 'v1', 'secret', Date.now());
    assert.equal((await (await request('/points')).json()).points.length, 1);
    assert.equal((await (await request('/points', null, other)).json()).points.length, 0);
    process.env.POI_DISCOVERY_READ_ONLY = '1'; assert.equal((await request('/delete', { expectedRevision: 1 })).status, 403); delete process.env.POI_DISCOVERY_READ_ONLY;
    assert.equal((await request('/delete', { expectedRevision: 0 })).status, 409);
    assert.equal((await request('/delete', { expectedRevision: 1, steamId: other })).status, 200);
    assert.deepEqual(discoveries.settings(steam), { enabled: false, revision: 2 }); assert.equal(discoveries.discovered(steam, 'v1').points.length, 0);
    process.env.POI_DISCOVERY_ENABLED = '0'; assert.equal((await request('/points')).status, 503);
  } finally {
    for (const surface of [website, backend]) if (surface) await new Promise(resolve => surface.server.close(resolve));
    legacy.get = originalGet; db.close();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
