"use strict";
const assert = require('node:assert/strict'), express = require('express'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { DatabaseSync } = require('node:sqlite'), { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
process.env.DB_PATH = ':memory:';
for (const key of ['SEASON_TRACK_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL']) delete process.env[key];
process.env.SEASON_TRACK_ENABLED = '1'; process.env.SEASON_TRACK_MANAGEMENT_ENABLED = '1'; process.env.HOLLOW_VALLEY_API_TOKEN = randomBytes(32).toString('hex');
const { db: users } = require('../server/db');
const { describe, createSeasonTrackStore } = require('../automation-platform/src/services/seasonTrackStore');
const service = require('../automation-platform/src/services/seasonTrackService'), originalGet = service.get;
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT)');
const START = Date.parse('2027-01-01T00:00:00Z'); let now = START - 1000;
db.exec('CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));CREATE TABLE economy_quest_achievements(steam_id TEXT,quest_id TEXT,period_key TEXT,achieved_at TEXT)');
db.exec('CREATE TABLE vl_lives(id TEXT PRIMARY KEY,steam_id TEXT,species TEXT,started_at INTEGER,last_at INTEGER,ended_at INTEGER);CREATE TABLE vl_events(id TEXT PRIMARY KEY,payload TEXT,occurred_at INTEGER);CREATE TABLE vl_parents(child TEXT,parent TEXT);CREATE TABLE vl_growth_milestones(life_id TEXT,juvenile_at INTEGER,adult_at INTEGER);CREATE TABLE combat_events(id TEXT PRIMARY KEY,victim_steam_id TEXT,occurred_at TEXT)');
const achievementSources = require('../automation-platform/src/services/achievementSourceTime').createAchievementSourceTimeStore(db, { now: () => now });
const territorySources = require('../automation-platform/src/services/territoryVictoryStore').createTerritoryVictoryStore(db, { now: () => now });
const store = createSeasonTrackStore(db, { now: () => now }); service.get = () => store;
const definition = { id: 'synthetic-browser-season', title: 'Synthetic <Valley> season', startsAt: new Date(START).toISOString(), endsAt: new Date(START + 56 * 86400000).toISOString(), settlesAt: new Date(START + 57 * 86400000).toISOString(), retainUntil: new Date(START + 147 * 86400000).toISOString(), free: true,
  sources: [{ source: 'quest', policy: 'achievement-time' }], tiers: [{ xp: 10, title: 'First <milestone>' }, { xp: 100, title: 'Valley explorer' }],
  achievementPoints: { policy: 'qualifying-source-time', awards: [{ id:'quest-1', xp:25 }, {id:'nested-adult',xp:50}, {id:'territory-victory',xp:75}] } };
const digest = describe(definition).digest;
store.stage(definition, { reviewer: '76561198000000401', digest }); store.changeState(definition.id, { reviewer: '76561198000000401', digest, action: 'publish', expectedRevision: 1 }); now = START;
let writes = 0, drop = false, hold = false, held = null;
const unexpected = [], internal = express(); internal.use(express.json()); internal.use('/api/website/season-track', require('../automation-platform/src/routes/websiteSeasonTrackRoutes'));
const web = express(); web.use(express.json());
web.use((req, _res, next) => { const id = Number(String(req.headers.cookie || '').match(/fixture-user=(\d+)/)?.[1]); if (id) req.user = users.prepare('SELECT id,steam_id,username FROM users WHERE id=?').get(id); next(); });
web.get('/api/me', (req, res) => res.json({ loggedIn: Boolean(req.user), user: req.user || null, steamLoginConfigured: true }));
web.get('/api/quests', (_req, res) => res.json({ trackingEnabled: true, quests: [], challenges: [] }));
web.get('/api/dynamic-challenges/capabilities', (_req, res) => res.json({ enabled: false, managementAvailable: false, readOnly: true }));
web.get('/api/server-status', (_req, res) => res.json({ configured: false }));
web.post('/api/wallet/daily-login/claim', (_req, res) => res.json({ duplicate: true, amount: 0 }));
web.use('/api/season-track', (req, res, next) => {
  if (req.method === 'POST') writes++;
  if (req.method === 'POST' && req.path === '/participation' && drop) { drop = false; res.json = () => { res.status(200).type('application/json'); res.write('{', () => res.destroy()); return res; }; }
  if (req.method === 'GET' && req.path === '/' + definition.id && hold) { hold = false; const json = res.json.bind(res); res.json = body => { held = () => { held = null; json(body); }; return res; }; }
  next();
});
web.use('/api/season-track', require('../server/routes/seasonTrack'));
web.use('/api', (req, res) => { unexpected.push(req.method + ' ' + req.path); res.status(404).json({ error: 'Unexpected fixture API' }); });
web.get('/quests', (_req, res) => res.sendFile(path.join(__dirname, '../public/quests.html'))); web.use(express.static(path.join(__dirname, '../public')));
const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })); });
async function until(fn) { for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Season fixture observation timed out'); }
(async () => {
  let backend, frontend, browser;
  try {
    backend = await listen(internal); process.env.AUTOMATION_SERVICE_URL = backend.url; frontend = await listen(web);
    browser = await chromium.launch({ headless: true, executablePath: process.env.HV_TEST_BROWSER || undefined });
    for (const width of [1440, 390]) {
      now = START;
      const a = width, b = width + 1, steamA = String(76561198000030000n + BigInt(a)), steamB = String(76561198000030000n + BigInt(b));
      users.prepare('INSERT INTO users(id,steam_id,username) VALUES(?,?,?), (?,?,?)').run(a, steamA, 'Synthetic A', b, steamB, 'Synthetic B');
      const context = await browser.newContext({ viewport: { width, height: 980 } }), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const cookie = id => context.addCookies([{ name: 'fixture-user', value: String(id), url: frontend.url }]);
      const idle = () => page.waitForFunction(() => !document.getElementById('season-refresh').disabled);
      const refresh = async () => { await page.click('#season-refresh'); await idle(); };
      const confirm = async () => { await page.click('#season-confirm'); await idle(); };
      await cookie(a); await page.goto(frontend.url + '/quests'); await page.locator('#season-details').waitFor(); await idle();
      assert.match(await page.locator('#season-title').textContent(), /Synthetic <Valley>/); assert.equal(await page.locator('#season-title valley').count(), 0);
      await page.click('#season-choice'); assert.match(await page.locator('#season-review-text').textContent(), /for free/);
      assert.match(await page.locator('#season-review-text').textContent(), /First quest: 25 season XP/);
      assert.match(await page.locator('#season-review-text').textContent(), /Verified nested adulthood: 50 season XP/);
      assert.match(await page.locator('#season-review-text').textContent(), /Verified Territory capture participation: 75 season XP/);
      const before = writes; drop = true; await confirm(); await page.getByRole('button', { name: 'Retry saved season request', exact: true }).waitFor();
      assert.equal(writes, before + 1); assert.equal(store.status(definition.id, steamA).revision, 1);
      await confirm(); assert.equal(writes, before + 2); assert.equal(store.status(definition.id, steamA).revision, 1);
      db.prepare('INSERT INTO progression_xp_ledger VALUES(?,?,?,?,?,?)').run('browser-xp-' + width, steamA, 10, 'quest', 'quest', new Date(now).toISOString());
      db.prepare('INSERT INTO progression_xp_source_times VALUES(?,?,?)').run('browser-xp-' + width, now, 'quest-achievement');
      db.prepare('INSERT INTO economy_quest_achievements VALUES(?,?,?,?)').run(steamA, 'synthetic-browser-quest', 'synthetic-period', new Date(now).toISOString());
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(steamA, 'quest-1', JSON.stringify({ type:'quests', threshold:1, value:1 }), new Date(now).toISOString());
      achievementSources.recordNewAward(steamA, 'quest-1'); db.exec('COMMIT');
      const child = 'browser-child-' + width, parent = 'browser-parent-' + width;
      db.prepare('INSERT INTO vl_lives VALUES(?,?,?,?,?,NULL),(?,?,?,?,?,NULL)').run(child,steamA,'Rex',now-60000,now,parent,steamB,'Rex',now-120000,now);
      db.prepare('INSERT INTO vl_parents VALUES(?,?)').run(child,parent); db.prepare('INSERT INTO vl_growth_milestones VALUES(?,?,?)').run(child,now-30000,now);
      db.prepare('INSERT INTO vl_events VALUES(?,?,?)').run('hatch:'+child,JSON.stringify({type:'hatch',child,parents:[parent],evidence:'synthetic-browser-hatch'}),now);
      db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(steamA,'nested-adult',JSON.stringify({type:'nested_adult',threshold:1,value:1,evidence:{lifeId:child,juvenileAt:now-30000,adultAt:now}}),new Date(now).toISOString());
      achievementSources.recordNewAward(steamA,'nested-adult'); db.exec('COMMIT');
      territorySources.ingest({version:1,attackId:width,eventId:width,startedAt:now-60000,resolvedAt:now,outcome:'capture',provenance:'recorded-live',winners:[steamA,steamB]});
      db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(steamA,'territory-victory',JSON.stringify({type:'territory_victories',threshold:1,value:1}),new Date(now).toISOString());achievementSources.recordNewAward(steamA,'territory-victory');db.exec('COMMIT');
      await refresh(); assert.match(await page.locator('#season-points').textContent(), /^0 season XP/);
      await page.click('#season-sync'); await idle(); assert.match(await page.locator('#season-points').textContent(), /^160 season XP/);
      assert.match(await page.locator('#season-points').textContent(), /150 XP comes from reviewed achievements/);
      db.prepare('UPDATE economy_quest_achievements SET achieved_at=? WHERE steam_id=?').run(new Date(now-1).toISOString(), steamA);
      await refresh(); assert.match(await page.locator('#season-points').textContent(), /^135 season XP/); assert.match(await page.locator('#season-evidence').textContent(), /excluded/);
      db.prepare('UPDATE economy_quest_achievements SET achieved_at=? WHERE steam_id=?').run(new Date(now).toISOString(), steamA); await refresh();
      db.prepare('INSERT INTO combat_events VALUES(?,?,?)').run('nested-death-'+width,steamA,new Date(now-15000).toISOString());
      await refresh(); assert.match(await page.locator('#season-points').textContent(), /^110 season XP/); assert.match(await page.locator('#season-evidence').textContent(), /excluded/);
      db.prepare('DELETE FROM combat_events WHERE id=?').run('nested-death-'+width); await refresh(); assert.match(await page.locator('#season-points').textContent(), /^160 season XP/);
      const frozenResult=db.prepare('SELECT payload_json FROM progression_territory_results WHERE attack_id=?').get(width).payload_json;
      db.prepare('UPDATE progression_territory_results SET payload_json=? WHERE attack_id=?').run(JSON.stringify({...JSON.parse(frozenResult),provenance:'simulated'}),width);
      await refresh();assert.match(await page.locator('#season-points').textContent(),/^85 season XP/);
      db.prepare('UPDATE progression_territory_results SET payload_json=? WHERE attack_id=?').run(frozenResult,width);await refresh();assert.match(await page.locator('#season-points').textContent(),/^160 season XP/);
      assert.match(await page.locator('#season-tiers').textContent(), /✓ First <milestone>/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const output = process.env.HV_TEST_ARTIFACT_DIR || path.join(os.tmpdir(), 'hv-season-track-browser'); fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'season-' + width + '.png'), fullPage: true });
      process.env.SEASON_TRACK_READ_ONLY = '1'; await refresh(); assert.equal(await page.locator('#season-choice').isDisabled(), true); assert.equal(await page.locator('#season-sync').isDisabled(), true); delete process.env.SEASON_TRACK_READ_ONLY;
      await refresh(); await page.click('#season-choice');
      process.env.SEASON_TRACK_ENABLED = '0'; await confirm(); assert.equal(store.status(definition.id, steamA).participating, false, 'deletion remains available during a pause');
      assert.equal(store.progress(definition.id, steamA).xp, 0); process.env.SEASON_TRACK_ENABLED = '1';
      await refresh(); await page.click('#season-choice');
      store.changeParticipation(definition.id, steamA, { selected: true, expectedRevision: 2, requestKey: 'fixture-other-tab-' + width, seasonDigest: digest });
      await confirm(); assert.match(await page.locator('#season-status').textContent(), /changed/); assert.equal(await page.locator('#season-review').isVisible(), false);
      hold = true; await page.click('#season-refresh'); await until(() => held); await cookie(b); held(); await idle();
      assert.equal(await page.locator('#season-details').isVisible(), false); assert.equal(await page.locator('#season-tiers p').count(), 0);
      await refresh(); assert.match(await page.locator('#season-participation').textContent(), /not joined/);
      await page.click('#season-choice'); const pausedWrites = writes; process.env.SEASON_TRACK_ENABLED = '0'; await confirm();
      assert.equal(writes, pausedWrites); assert.equal(store.status(definition.id, steamB).participating, false); assert.equal(await page.locator('#season-confirm').isDisabled(), true);
      await page.click('#season-cancel'); process.env.SEASON_TRACK_ENABLED = '1'; await refresh();
      await page.click('#season-choice'); await context.clearCookies(); await confirm(); assert.equal(await page.locator('#season-review').isVisible(), false);
      assert.equal(await page.locator('#season-tiers p').count(), 0); assert.match(await page.locator('#season-status').textContent(), /account changed/);
      await cookie(a); now = Date.parse(definition.retainUntil) - 1; await refresh();
      assert.equal(store.status(definition.id, steamA).participating, true); assert.match(await page.locator('#season-retention').textContent(), /expire/);
      now++; await refresh(); assert.match(await page.locator('#season-evidence').textContent(), /retention period has ended/);
      assert.match(await page.locator('#season-points').textContent(), /progress has expired/); assert.equal(await page.locator('#season-sync').isDisabled(), true); assert.equal(await page.locator('#season-choice').isDisabled(), true);
      assert.deepEqual(errors, []); await context.close();
      console.log(JSON.stringify({ width, seasonUi: 'passed', screenshot: path.join(output, 'season-' + width + '.png') }));
    }
    assert.deepEqual(unexpected, []);
  } finally {
    if (browser) await browser.close(); service.get = originalGet;
    await Promise.all([backend, frontend].filter(Boolean).map(item => new Promise(resolve => item.server.close(resolve)))); db.close(); users.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
