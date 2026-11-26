const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'arcade-lobby-test-secret';
process.env.NODE_ENV = 'test';

const { createApp } = require('../server/index');
const { db } = require('../server/db');
const { SqliteSessionStore } = require('../server/sessionStore');
const present = require('../public/assets/arcade-present.js');
const launch = require('../automation-platform/src/data/arcade-launch-rewards.json');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function signedCookie(sid) {
  const signature = require('cookie-signature');
  return `connect.sid=${encodeURIComponent('s:' + signature.sign(sid, process.env.SESSION_SECRET))}`;
}

function sessionFor(userId, sid) {
  const store = new SqliteSessionStore();
  return new Promise((resolve, reject) => {
    store.set(sid, {
      cookie: { originalMaxAge: 600000, expires: new Date(Date.now() + 600000) },
      userId,
    }, (error) => error ? reject(error) : resolve(signedCookie(sid)));
  });
}

test('retired arcade pages redirect and the skins pretty URL serves the page', async (t) => {
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const retired of ['/valley-arcade', '/valley-arcade/', '/valley-arcade.html']) {
    const response = await fetch(base + retired, { redirect: 'manual' });
    assert.equal(response.status, 301, retired);
    assert.equal(response.headers.get('location'), '/arcade');
  }
  for (const retired of ['/admin-valley-arcade', '/admin-valley-arcade/', '/admin-valley-arcade.html']) {
    const response = await fetch(base + retired, { redirect: 'manual' });
    assert.equal(response.status, 301, retired);
    assert.equal(response.headers.get('location'), '/admin/arcade');
  }

  const skins = await fetch(base + '/arcade-skins');
  assert.equal(skins.status, 200);
  const skinsHtml = await skins.text();
  assert.match(skinsHtml, /id="nav-slot"/);
  assert.match(skinsHtml, /for="preview-species"/);
  assert.match(skinsHtml, /Sign in|common\.js/);
  assert.match(skinsHtml, /Reset view/);

  const lobby = await fetch(base + '/arcade');
  assert.equal(lobby.status, 200);
  const lobbyHtml = await lobby.text();
  assert.match(lobbyHtml, /id="arcade-leaderboard"[^>]*hidden/);
  assert.match(lobbyHtml, /id="arcade-crate-stage"/);
  assert.match(lobbyHtml, /Sign in with Steam/);
  assert.match(lobbyHtml, /id="arcade-games"/);
  assert.doesNotMatch(lobbyHtml, /higher-lower|memory-match|reaction/);
});

test('logged-out admin arcade redirects to Steam sign-in and API routes stay JSON 401', async (t) => {
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(base + '/admin/arcade', { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/auth/steam?returnTo=' + encodeURIComponent('/admin/arcade'));
  const body = await page.text();
  assert.doesNotMatch(body, /Not logged in/);

  for (const apiPath of ['/api/arcade', '/api/arcade/admin', '/api/valley-arcade/settings']) {
    const response = await fetch(base + apiPath, { redirect: 'manual' });
    assert.equal(response.status, 401, apiPath);
    assert.match(response.headers.get('content-type') || '', /json/);
    const payload = await response.json();
    assert.equal(payload.error, 'Not logged in');
  }
});

test('signed-in non-admins get JSON 403 on the arcade admin page and admins get the page', async (t) => {
  const player = db.prepare('INSERT INTO users (steam_id, username, is_admin) VALUES (?, ?, 0)').run('76561198000000141', 'Arcade Player');
  const admin = db.prepare('INSERT INTO users (steam_id, username, is_admin) VALUES (?, ?, 1)').run('76561198000000142', 'Arcade Admin');
  const playerCookie = await sessionFor(Number(player.lastInsertRowid), 'arcade-player-session');
  const adminCookie = await sessionFor(Number(admin.lastInsertRowid), 'arcade-admin-session');
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const forbidden = await fetch(base + '/admin/arcade', { headers: { cookie: playerCookie }, redirect: 'manual' });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.headers.get('content-type') || '', /json/);
  assert.equal((await forbidden.json()).error, 'Admin access required');

  const allowed = await fetch(base + '/admin/arcade', { headers: { cookie: adminCookie }, redirect: 'manual' });
  assert.equal(allowed.status, 200);
  const html = await allowed.text();
  assert.match(html, /Arcade availability/);
  assert.match(html, /Wagering disabled/);
  assert.doesNotMatch(html, /admin-valley-arcade\.html/);
});

test('homepage hub and how-to guide link to the Arcade', () => {
  const home = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(home, /href="\/arcade"/);
  assert.match(home, /Play free challenges and open earned crates/);
  const guide = fs.readFileSync(path.join(__dirname, '../public/how-to/index.html'), 'utf8');
  assert.match(guide, /id="arcade"/);
  assert.match(guide, /CHAPTER 7 OF 7/);
  assert.match(guide, /href="\/arcade-skins"/);
  const nav = fs.readFileSync(path.join(__dirname, '../public/partials/nav.html'), 'utf8');
  assert.doesNotMatch(nav, /valley-arcade\.html/);
  assert.match(nav, /href="\/arcade"/);
});

test('crate odds round the existing weights and rewards use friendly names', () => {
  const prime = launch.crates.prime;
  const total = prime.reduce((sum, reward) => sum + reward.weight, 0);
  assert.equal(total, 10000);
  const rex75 = prime.find((reward) => reward.id === 'rex-75');
  assert.equal(present.arcadePercent(rex75.weight / total), '2%');
  assert.equal(present.arcadeFamilyName('prime'), 'Prime crate');
  assert.equal(present.arcadeOddsLine({ ...rex75, probability: rex75.weight / total }, prime), '75% Tyrannosaurus entitlement: 2%');

  const valley = launch.crates.valley;
  const rare = valley.find((reward) => reward.id === 'trike-25');
  const valleyTotal = valley.reduce((sum, reward) => sum + reward.weight, 0);
  assert.equal(present.arcadePercent(rare.weight / valleyTotal), '<1%');
  assert.equal(present.arcadeOddsLine(rare, valley), '25% Triceratops entitlement: <1%');

  const line = present.arcadeEntitlementLine({
    id: '11111111-1111-4111-8111-111111111111',
    reward: { id: 'omni-25', species: 'omniraptor', growthPercent: 25, label: '25% Omniraptor entitlement' },
  }, { status: 'delivered', slot: 3 });
  assert.equal(line, '25% Omniraptor entitlement · Delivered to Dino Storage · slot 3');
  assert.doesNotMatch(line, /omni-25|11111111|7656119/);

  const unnamed = present.arcadeRewardName({ species: 'tyrannosaurus', growthPercent: 49, id: 'rex-49' });
  assert.equal(unnamed, '49% Tyrannosaurus');
  const now = Date.parse("2026-11-26T10:00:00.000Z");
  assert.equal(present.arcadeRecentLine({
    player: "Rex",
    type: "crate",
    name: "Emberwake",
    rarity: "Legendary",
    timestamp: new Date(now - 120000).toISOString(),
    amount: 500,
  }, now), "Rex pulled a Legendary Emberwake · 2m ago");
  const unknown = present.arcadeRecentLine({
    player: "Rex",
    type: "signal",
    name: "Emberwake",
    rarity: "Epic",
    timestamp: new Date(now).toISOString(),
  }, now);
  assert.equal(unknown, "Rex earned an Epic Emberwake · just now");
  assert.equal(unknown.includes("signal"), false);
  assert.equal(present.arcadeRecentLine({
    player: "Rex",
    type: "crate",
    name: "500 Valley Coins",
    rarity: "Legendary",
    timestamp: new Date(now).toISOString(),
  }, now), "");

  assert.equal(present.arcadeHistoryLine({
    id: 'crate-1',
    family: 'alpha',
    reward: { label: 'Emberwake skin', presetId: 'arcade-emberwake-v1' },
  }, '1 Jan'), '1 Jan · Alpha crate · Emberwake skin');
});

test('lobby script keeps a game-card registry and does not trust a browser score', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/assets/arcade.js'), 'utf8');
  assert.match(script, /const GAME_CARDS = \[/);
  assert.match(script, /id: 'trivia'/);
  assert.match(script, /id: 'daily-puzzle'/);
  assert.match(script, /id: 'guess-the-dino'/);
  assert.match(script, /PR 2 adds Higher\/Lower, Memory Match and Reaction/);
  assert.match(script, /noteCrateOpen/);
  assert.doesNotMatch(script, /toFixed\(4\)|weight/);
  assert.doesNotMatch(script, /body\.score|payload\.score|payout:/);
});
