'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const nav = read('public/partials/nav.html');
const home = read('public/index.html');
const common = read('public/assets/common.js');

test('HV-UX01 groups the navigation without losing wallet, quests and Live Map', () => {
  assert.match(nav, /id="my-stuff-nav-group"/);
  assert.match(nav, /id="marketplace-nav-group"/);
  assert.match(nav, /id="community-nav-group"/);
  assert.match(nav, /id="help-nav-group"/);
  assert.match(nav, /href="\/wallet">WALLET<\/a>/);
  assert.match(nav, /href="\/quests">QUESTS<\/a>/);
  assert.match(nav, /href="\/livemap">LIVE MAP<\/a>/);
  assert.match(nav, /href="\/supporter">SUPPORTER<\/a>/);
  for (const route of ['/profile','/mydinos','/dinostorage/','/skins','/friends','/bodydrop',
    '/marketplace','/marketplace-official.html','/marketplace-players.html',
    '/groups','/events','/leaderboard?tab=levels','/help']) {
    assert.ok(nav.includes('href="' + route + '"'), 'Missing useful navigation route ' + route);
  }
  assert.doesNotMatch(nav, /How to Join<\/a>|Command<\/a>/);
});

test('all menu buttons have distinct, matching controlled submenu IDs', () => {
  const groupButtons = Array.from(nav.matchAll(/<button\b[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>/g));
  assert.equal(groupButtons.length, 5, 'My Stuff, Marketplace, Community, Help and Admin');
  const ids = groupButtons.map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(nav, new RegExp('id="' + id + '"'));
  assert.match(nav, /id="admin-nav-group" hidden/);
  assert.match(nav, /id="territory-admin-nav-link" hidden/);
  assert.match(nav, /id="valley-legacy-nav" hidden/);
  assert.match(nav, /id="primalbound-nav-link"/);
  assert.match(nav, /noopener noreferrer/);
});

test('menu behaviour supports mobile collapse, outside click, active groups and Escape', () => {
  const hub = read('public/assets/navigation-hub.css');
  assert.doesNotThrow(() => new Function(common));
  assert.match(common, /function closeGroups|const closeGroups =/);
  assert.match(common, /button\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(common, /group\.classList\.add\("has-current"\)/);
  assert.match(common, /event\.key !== "Escape"/);
  assert.match(common, /setMenuOpen\(false\)/);
  assert.match(hub, /@media \(max-width:1050px\)/);
  assert.match(hub, /mega-menu \[hidden\]/);
  assert.match(hub, /focus-visible/);
  const navCss = read('public/assets/navigation-layout.css');
  assert.match(nav, /\/assets\/navigation-hub\.css\?v=1/);
  assert.match(navCss, /min-width:1051px/);
});

test('homepage shows the server, player tools and community before the full 31-feature roadmap', () => {
  const hero = home.indexOf('class="snapshot-home-hero"');
  const player = home.indexOf('class="home-hub-player"');
  const quick = home.indexOf('class="snapshot-quick-grid"');
  const community = home.indexOf('class="home-hub-community"');
  const roadmap = home.indexOf('class="home-roadmap"');
  assert.ok(hero > 0 && player > hero && quick > player && community > quick && roadmap > community);
  assert.match(home, /id="roadmap" aria-labelledby="roadmap-heading"/);
  assert.match(home, /id="roadmap-expand-all"/);
  assert.match(home, /id="roadmap-collapse-all"/);
  assert.match(home, /id="home-roadmap-stages"/);
  assert.match(home, /id="roadmap-vote-status"/);
  assert.match(home, /id="roadmap-suggestion-form"/);
  assert.match(home, /id="home-wallet-balance"/);
  assert.match(home, /id="home-server-state"/);
  assert.match(home, /id="home-profile-progress"/);
  assert.match(home, /\/assets\/home-hub\.css\?v=1/);
  assert.match(home, /\/assets\/home-v2\.js\?v=3/);
  assert.match(home, /\/assets\/home-roadmap\.js\?v=2/);
  assert.match(home, /\/assets\/roadmap-voting\.js\?v=2/);
  for (const id of ['home-dino-count','home-player-label','home-wallet-balance','home-roadmap-stages']) {
    assert.equal((home.match(new RegExp('id="' + id + '"','g')) || []).length,1, 'duplicate or missing #' + id);
  }
});

test('homepage summary uses existing account reads, never initiates extra wallet or game writes', () => {
  const source = read('public/assets/home-v2.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /HDS\.api\("\/api\/progression"\)/);
  assert.match(source, /HDS\.api\("\/api\/wallet"\)/);
  assert.match(source, /HDS\.api\("\/api\/dashboard"\)/);
  assert.match(source, /HDS\.api\("\/api\/server-status"\)/);
  assert.doesNotMatch(source, /method:\s*["']POST|\/api\/dinostorage\/store|\/api\/wallet\/credit/);
});

test('Help page is a real page and links only to available tools or verified Discord invite', () => {
  const html = read('public/help.html');
  const server = read('server/index.js');
  assert.match(server, /"supporter", "events", "help"/);
  assert.match(html, /Help Centre/);
  assert.match(html, /https:\/\/discord\.gg\/herbydeathsquadgames/);
  assert.match(html, /href="\/profile"/);
  assert.match(html, /href="\/dinostorage\/"/);
  assert.match(html, /href="\/wallet"/);
  assert.match(html, /href="\/quests"/);
  assert.match(html, /href="\/rules"/);
  assert.match(html, /href="\/packs"/);
  assert.match(html, /href="\/reports"/);
  assert.doesNotMatch(html, /href="\/tickets"/);
  assert.match(html, /\/assets\/help-hub\.css\?v=1/);
});

test('UX01 retains the current roadmap feature register and preserves existing server command routing', () => {
  const roadmap = read('public/assets/home-roadmap.js');
  const app = read('server/index.js');
  assert.match(roadmap, /31, 'Territory Wars'/);
  assert.match(app, /app\.use\("\/api\/wallet", walletRouter\)/);
  assert.match(app, /app\.use\("\/api\/quests", questsRouter\)/);
  assert.match(app, /app\.use\("\/api\/mydinos", mydinosRouter\)/);
  assert.match(app, /app\.use\("\/api\/marketplace", marketplaceRouter\)/);
  assert.match(app, /app\.use\("\/api\/groups", groupsRouter\)/);
});
