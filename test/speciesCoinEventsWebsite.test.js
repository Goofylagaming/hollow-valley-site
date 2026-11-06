const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = ':memory:';
const automation = require('../server/services/automationWebsiteClient');
const admin = require('../server/routes/adminOperations');
const events = require('../server/routes/events');

function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin-operations', admin);
  app.use('/api/events', events);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const base = (server) => 'http://127.0.0.1:' + server.address().port;

test('only Steam-linked admins can create bonus events and identity cannot be spoofed', async (t) => {
  const original = automation.createAdminSpeciesCoinEvent;
  const calls = [];
  automation.createAdminSpeciesCoinEvent = async (payload) => {
    calls.push(payload);
    return { ok: true, event: { id: 'one', species: payload.species } };
  };
  t.after(() => { automation.createAdminSpeciesCoinEvent = original; });

  const adminUser = { id: 1, is_admin: 1, steam_id: '76561198038977506' };
  const server = await serve(adminUser);
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function post(data) {
    return fetch(base(server) + '/api/admin-operations/species-coin-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(data),
    });
  }
  const input = {
    title: 'Omniraptor Spotlight', species: 'omniraptor',
    coinsPerMinute: 75, durationMinutes: 30,
    requestId: '516e0f32-d0d5-4b53-bdab-32fdf208ff3d',
    actorSteamId: '76561198000000000',
  };
  assert.equal((await post({ ...input, species: 'fictionaldinosaur' })).status, 400);
  assert.equal((await post({ ...input, growthMultiplier: 4 })).status, 400);
  assert.equal((await post({ ...input, durationMinutes: 0 })).status, 400);
  assert.equal((await post(input)).status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actorSteamId, adminUser.steam_id);
});

test('public event listing hides administrator identity and private settings', async (t) => {
  const original = automation.getAdminSpeciesCoinEvents;
  automation.getAdminSpeciesCoinEvents = async () => ({
    enabled: true,
    events: [
      { id: 'active', title: 'Raptor Week', species: 'omniraptor', coinsPerMinute: 40,
        startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-01T10:00:00.000Z',
        status: 'active', createdBy: '76561198038977506', requestId: 'secret' },
      { id: 'expired', title: 'Old', species: 'deinosuchus', status: 'expired' },
    ],
  });
  t.after(() => { automation.getAdminSpeciesCoinEvents = original; });
  const server = await serve(null);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const res = await fetch(base(server) + '/api/events/species-bonuses');
  assert.equal(res.status, 200);
  const state = await res.json();
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].species, 'omniraptor');
  assert.equal(Object.hasOwn(state.events[0], 'createdBy'), false);
  assert.equal(Object.hasOwn(state.events[0], 'requestId'), false);
});

test('random event form visibly distinguishes supported minute coins and unavailable growth', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const publicEvents = fs.readFileSync(path.join(__dirname, '../public/events.html'), 'utf8');
  assert.match(html, /id="ops-species-event-form"/);
  assert.match(html, /Species-only growth/);
  assert.match(html, /Not supported yet/);
  assert.match(js, /\/api\/admin-operations\/species-coin-events/);
  assert.match(js, /crypto\.randomUUID/);
  assert.match(publicEvents, /RANDOM DINOSAUR BONUSES/);
});

test('random event UI consistently displays Brisbane time, not browser or Render local time', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '../public/assets/events-species-bonuses.js'), 'utf8');
  for (const script of [admin, player]) {
    assert.match(script, /Australia\/Brisbane/);
    assert.match(script, /QLD time/);
    assert.doesNotMatch(script, /date\.toLocaleString\('en-AU'\)/);
  }
});

test('Admin Hub only allows the three safe mention modes and forwards the selected preference', async (t) => {
  const original = automation.createAdminSpeciesCoinEvent;
  const calls = [];
  automation.createAdminSpeciesCoinEvent = async (payload) => {
    calls.push(payload);
    return { event: { id: 'unit-test', pingMode: payload.pingMode }, duplicate: false };
  };
  t.after(() => { automation.createAdminSpeciesCoinEvent = original; });
  const server = await serve({ id: 1, is_admin: 1, steam_id: '76561198038977506' });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const event = (pingMode, autoAnnounce = true) => ({
    requestId: '000df949-6000-4db0-92be-e137ae116c98', title: 'PT Test',
    species: 'pteranodon', durationMinutes: 30, coinsPerMinute: 300,
    pingMode, autoAnnounce,
  });
  async function post(payload) {
    return fetch(base(server) + '/api/admin-operations/species-coin-events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  assert.equal((await post(event('@everyone'))).status, 400);
  assert.equal((await post(event('here'))).status, 400);
  assert.equal((await post(event('community', false))).status, 400);
  assert.equal(calls.length, 0);

  for (const mode of ['community', 'everyone', 'none']) {
    const response = await post(event(mode));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).event.pingMode, mode);
    assert.equal(calls.at(-1).pingMode, mode);
  }
});

test('Admin Hub offers explicit role, everyone and no-ping choices for event starts', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  assert.match(html, /id="ops-species-event-ping"/);
  assert.match(html, /value="community" selected/);
  assert.match(html, /value="everyone"/);
  assert.match(html, /value="none"/);
  assert.match(html, /when the event starts/);
  assert.match(js, /pingMode[,}:]/, 'the Admin Hub forwards the selected Discord ping mode');
  assert.match(js, /effectivePing\(\)/);
  assert.match(js, /The START announcement will ping/);
});

test('admin submits one grouped event with validated individual dinosaur rates', async t => {
  const original = automation.createAdminSpeciesCoinEvent;
  const payloads = [];
  automation.createAdminSpeciesCoinEvent = async payload => {
    payloads.push(payload);
    return {
      ok: true, duplicate: false,
      event: { id: 'test-group', speciesBonuses: payload.speciesBonuses },
    };
  };
  t.after(() => { automation.createAdminSpeciesCoinEvent = original; });
  const server = await serve({ id: 1, is_admin: 1, steam_id: '76561198038977506' });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = base(server) + '/api/admin-operations/species-coin-events';
  const input = {
    requestId: 'dc85a398-6c17-4da1-a26c-2e650bb4a1f1',
    title: 'Featured Dinosaur Hour', durationMinutes: 60,
    actorSteamId: '76561198000000000',
    speciesBonuses: [
      { species: 'pteranodon', coinsPerMinute: 300 },
      { species: 'omniraptor', coinsPerMinute: 200 },
      { species: 'triceratops', coinsPerMinute: 500 },
    ],
  };
  const post = data => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify(data),
  });
  assert.equal((await post({ ...input, speciesBonuses: [] })).status, 400);
  assert.equal((await post({ ...input, speciesBonuses: 'not-an-array' })).status, 400);
  assert.equal((await post({ ...input, speciesBonuses: [
    { species: 'pteranodon', coinsPerMinute: 100 },
    { species: 'pteranodon', coinsPerMinute: 200 },
  ] })).status, 400);
  assert.equal((await post({ ...input, speciesBonuses: [
    { species: 'omniraptor', coinsPerMinute: 100 },
    { species: 'fictionaldinosaur', coinsPerMinute: 200 },
  ] })).status, 400);
  assert.equal((await post({ ...input, speciesBonuses: [
    { species: 'omniraptor', coinsPerMinute: 50.5 },
  ] })).status, 400);
  assert.equal((await post({ ...input, speciesBonuses: Array.from({ length: 21 }, () =>
    ({ species: 'omniraptor', coinsPerMinute: 5 })) })).status, 400);
  assert.equal(payloads.length, 0);
  const good = await post(input);
  assert.equal(good.status, 201);
  const response = await good.json();
  assert.equal(response.event.speciesBonuses.length, 3);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].actorSteamId, '76561198038977506');
  assert.deepEqual(payloads[0].speciesBonuses, [
    { species: 'omniraptor', coinsPerMinute: 200 },
    { species: 'pteranodon', coinsPerMinute: 300 },
    { species: 'triceratops', coinsPerMinute: 500 },
  ]);
});

test('public listing exposes all grouped dinosaur rates without private administrator fields', async t => {
  const original = automation.getAdminSpeciesCoinEvents;
  automation.getAdminSpeciesCoinEvents = async () => ({
    enabled: true,
    events: [
      { id: 'group', title: 'Featured Hour', species: 'omniraptor',
        coinsPerMinute: 200, status: 'active',
        startsAt: '2026-11-02T00:00:00Z',
        endsAt: '2026-11-02T01:00:00Z',
        speciesBonuses: [
          { species: 'omniraptor', coinsPerMinute: 200 },
          { species: 'pteranodon', coinsPerMinute: 300 },
        ],
        requestId: 'private-request-identity',
        createdBy: '76561198038977506', pingMode: 'everyone',
      },
    ],
  });
  t.after(() => { automation.getAdminSpeciesCoinEvents = original; });
  const server = await serve(null);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(base(server) + '/api/events/species-bonuses');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.events[0].speciesBonuses, [
    { species: 'omniraptor', coinsPerMinute: 200 },
    { species: 'pteranodon', coinsPerMinute: 300 },
  ]);
  assert.equal(JSON.stringify(body).includes('76561198038977506'), false);
  assert.equal(JSON.stringify(body).includes('private-request-identity'), false);
  assert.equal(JSON.stringify(body).includes('everyone'), false);
});

test('Admin Hub supports adding, removing and editing individual dinosaur bonus rates', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const publicScript = fs.readFileSync(path.join(__dirname, '../public/assets/events-species-bonuses.js'), 'utf8');
  for (const identifier of [
    'ops-species-event-add', 'ops-species-event-selected',
    'ops-species-event-selected-caption',
  ]) assert.ok(html.includes('id="' + identifier + '"'));
  assert.match(js, /selectedBonuses = new Map/);
  assert.match(js, /selectedRates/);
  assert.match(js, /selectedBonuses\.delete/);
  assert.match(js, /speciesBonuses, durationMinutes/);
  assert.match(js, /One Discord start ping/);
  assert.match(publicScript, /event\.speciesBonuses/);
  assert.match(publicScript, /bonuses\.map/);
});


test('admin forwards exact Queensland range and includes Kentrosaurus', async (t) => {
  const originalCreate = automation.createAdminSpeciesCoinEvent;
  const originalList = automation.getAdminSpeciesCoinEvents;
  let received;
  automation.createAdminSpeciesCoinEvent = async payload => { received = payload; return { event: payload }; };
  automation.getAdminSpeciesCoinEvents = async () => ({ enabled: true, events: [] });
  t.after(() => { automation.createAdminSpeciesCoinEvent = originalCreate; automation.getAdminSpeciesCoinEvents = originalList; });
  const server = await serve({ is_admin: 1, steam_id: '76561198038977506' });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = base(server) + '/api/admin-operations/species-coin-events';
  const listed = await (await fetch(url)).json();
  assert.ok(listed.species.some(item => item.id === 'kentrosaurus'));
  const input = { title: 'Weekend', species: 'kentrosaurus', coinsPerMinute: 50,
    requestId: '516e0f32-d0d5-4b53-bdab-32fdf208ff3d', scheduleMode: 'range', timezone: 'Australia/Brisbane',
    startsAt: '2026-11-06T09:00:00.000Z', endsAt: '2026-11-08T13:59:00.000Z' };
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post(input)).status, 201);
  assert.equal(received.endsAt, input.endsAt);
  assert.equal(received.timezone, input.timezone);
  assert.equal(received.speciesBonuses[0].species, 'kentrosaurus');
  assert.equal((await post({ ...input, endsAt: input.startsAt })).status, 400);
  assert.equal((await post({ ...input, timezone: 'Australia/Sydney' })).status, 400);
});

test('browser schedule conversion is Queensland-specific and calculates the weekend duration', () => {
  const vm = require('node:vm');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const fn = js.slice(js.indexOf('  function scheduleValues()'), js.indexOf('  function preview()'));
  const values = { 'ops-species-event-mode': 'range', 'ops-species-event-start-at': '2026-11-06T19:00',
    'ops-species-event-end-at': '2026-11-08T23:59', 'ops-species-event-duration': '60' };
  const run = () => vm.runInNewContext(fn + ';scheduleValues()', { el: id => ({ value: values[id] }) });
  const result = run();
  assert.equal(result.startsAt, '2026-11-06T09:00:00.000Z');
  assert.equal(result.endsAt, '2026-11-08T13:59:00.000Z');
  assert.equal(result.durationMinutes, 3179);
  values['ops-species-event-start-at'] = '2026-02-30T19:00';
  assert.throws(run, /valid Queensland/);
  values['ops-species-event-mode'] = 'duration';
  values['ops-species-event-start-at'] = '';
  assert.equal(run().startsAt, null);
  assert.equal(run().durationMinutes, 60);
});


test('browser submits the computed range payload and retains duration mode', () => {
  const vm = require('node:vm');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const schedule = js.slice(js.indexOf('  function scheduleValues()'), js.indexOf('  function preview()'));
  const draft = js.slice(js.indexOf('  function draftPayload()'), js.indexOf("  el('ops-species-event-form')"));
  const values = { 'ops-species-event-title': 'Weekend', 'ops-species-event-mode': 'range',
    'ops-species-event-start-at': '2026-11-06T19:00', 'ops-species-event-end-at': '2026-11-08T23:59',
    'ops-species-event-duration': '60' };
  const run = () => vm.runInNewContext(schedule + draft + ';draftPayload()', {
    el: id => ({ value: values[id], checked: true }),
    selectedRates: () => [{ species: 'kentrosaurus', coinsPerMinute: 50 }],
    speciesNames: new Map([['kentrosaurus', 'Kentrosaurus']]),
    effectivePing: () => 'none', pingLabels: { none: 'No ping' },
  });
  const range = run();
  assert.equal(range.durationMinutes, 3179);
  assert.equal(range.endsAt, '2026-11-08T13:59:00.000Z');
  assert.equal(range.timezone, 'Australia/Brisbane');
  values['ops-species-event-mode'] = 'duration';
  values['ops-species-event-start-at'] = '';
  const duration = run();
  assert.equal(duration.durationMinutes, 60);
  assert.equal(duration.startsAt, null);
  assert.equal(duration.endsAt, undefined);
});


test('add all dinosaurs includes Kentrosaurus, preserves edited rates and rejects invalid rates', () => {
  const vm = require('node:vm');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const handler = js.slice(js.indexOf("  el('ops-species-event-add-all')"), js.indexOf('  const pingLabels'));
  const selectedBonuses = new Map([['omniraptor', 75]]);
  const speciesNames = new Map([['omniraptor', 'Omniraptor'], ['kentrosaurus', 'Kentrosaurus']]);
  let click; let coins = 50;
  vm.runInNewContext(handler, { el: id => id.endsWith('add-all') ? { addEventListener: (_event, fn) => { click = fn; } } : { value: coins },
    selectedBonuses, speciesNames, renderSelected() {}, preview() {}, text() {} });
  click();
  assert.equal(selectedBonuses.get('omniraptor'), 75);
  assert.equal(selectedBonuses.get('kentrosaurus'), 50);
  selectedBonuses.delete('kentrosaurus'); coins = 0; click();
  assert.equal(selectedBonuses.has('kentrosaurus'), false);
});
