// Isolated browser fixtures: real profile HTML/JS, mocked identity/progression.
// No production accounts, databases, game commands or external network access.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.HV_TEST_BROWSER ? { executablePath: process.env.HV_TEST_BROWSER } : {}) });
  const output = process.env.HV_TEST_OUTPUT;
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let selected = null, failSave = false, failRead = false, loggedIn = true;
      const writes = [], errors = [];
      const achievements = [
        {id:'territory-victory',title:'Territory Victor',description:'Participate in a verified Territory War capture.'},
        {id:'life-survival-10h',title:'Enduring Survivor',description:'Survive 10 recorded hours on one dinosaur life.'},
        {id:'nested-adult',title:'Valley Born',description:'Grow a verified nested dinosaur from juvenile to adult in one observed life.'},
        {id:'skins-10',title:'Valley Collector',description:'Own 10 distinct active skins through creation, purchase or a personal grant.'},
        {id:'combat-species-5',title:'Versatile Hunter',description:'Kill players of five different recorded dinosaur species.'},
        {id:'prime-observed',title:'Prime Survivor',description:'Have a dinosaur observed as Prime by the server.'},
      ].map(a => ({...a,unlockedAt:'2026-11-05T00:00:00.000Z'}));
      const titles = [
        { id: 'quest-master', name: 'Quest Master', requirement: 'Complete 100 verified quests.', unlocked: true },
        { id: 'valley-veteran', name: 'Valley Veteran', requirement: 'Log 100 verified hours in Hollow Valley.', unlocked: false },
      ];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://hv.test') return route.abort();
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/api/me') return json({ loggedIn, steamLoginConfigured: true, user: loggedIn ? { steam_id: '76561198000000001', username: 'Fixture player' } : null });
        if (url.pathname === '/api/progression/titles') {
          if (route.request().method() === 'POST') {
            writes.push(route.request().postDataJSON());
            if (failSave) return json({ error: 'Your title was not changed. Verified progression is temporarily unavailable.' }, 503);
            selected = writes.at(-1).titleId;
          } else if (failRead) return json({ error: 'Unavailable' }, 503);
          return json({ titles, selectedTitleId: selected });
        }
        if (url.pathname === '/api/progression') return json({ profile: { steamId: '76561198000000001', level: 10, achievements, achievementCount:achievements.length, rank: { name: 'Beipiaosaurus' } } });
        if (url.pathname.startsWith('/api/')) return json({});
        let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        if (relative === 'profile') relative = 'profile.html';
        const root = path.resolve(__dirname, '../public');
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
        return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://hv.test/profile');
      await page.waitForFunction(() => !document.getElementById('profile-title-choice').disabled);
      await page.waitForFunction(() => document.querySelectorAll('#profile-achievements article').length === 6);
      assert.deepEqual(await page.locator('#profile-achievements b').allTextContents(),achievements.map(a=>a.title));
      assert.equal(await page.locator('#profile-achievement-count').innerText(),'6');
      assert.equal(await page.locator('#profile-achievements').evaluate(panel => {
        const box=panel.getBoundingClientRect();
        return [...panel.querySelectorAll('article')].some(card=>card.getBoundingClientRect().right > box.right+1);
      }),false,`Badge layout overflow at ${width}px`);
      if (output) await page.locator('#profile-achievements').screenshot({path:path.join(output,`profile-badges-${width}.png`)});
      assert.deepEqual(await page.locator('#profile-title-choice option').evaluateAll(nodes => nodes.map(n => n.value)), ['', 'quest-master']);
      assert.match(await page.locator('#profile-title-catalog').innerText(), /LOCKED/);
      await page.selectOption('#profile-title-choice', 'quest-master');
      await page.click('#profile-title-save');
      await page.waitForFunction(() => document.getElementById('profile-title-status').textContent === 'Title saved.');
      assert.equal(await page.locator('#profile-title-current').innerText(), 'Quest Master');
      assert.deepEqual(writes, [{ titleId: 'quest-master' }]);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('profile-title-choice').value === 'quest-master');
      failSave = true;
      await page.selectOption('#profile-title-choice', '');
      await page.click('#profile-title-save');
      await page.waitForFunction(() => document.getElementById('profile-title-status').textContent.includes('not changed'));
      assert.equal(selected, 'quest-master');
      assert.equal(await page.locator('#profile-title-current').innerText(), 'Quest Master');
      assert.equal(await page.locator('#profile-title-save').isDisabled(), false);
      failSave = false;
      await page.click('#profile-title-save');
      await page.waitForFunction(() => document.getElementById('profile-title-current').textContent === 'No title selected');
      const overflow = await page.locator('#profile-title-form').evaluate(form => {
        const box = form.getBoundingClientRect();
        return [...form.children].some(child => child.getBoundingClientRect().right > box.right + 1);
      });
      assert.equal(overflow, false, `Title form overflow at ${width}px`);
      if (output) { await page.locator('.profile-title-panel').screenshot({ path: path.join(output, `profile-titles-${width}.png`) }); }
      failRead = true;
      await page.reload();
      await page.waitForFunction(() => document.getElementById('profile-title-current').textContent === 'Titles unavailable');
      assert.equal(await page.locator('#profile-title-save').isDisabled(), true);
      assert.equal(await page.locator('#profile-title-choice').isDisabled(), true);
      assert.equal(await page.locator('#profile-hero-level').innerText(), 'Level 10');
      loggedIn = false;
      await page.reload();
      await page.waitForFunction(() => !document.getElementById('profile-guard').hidden);
      assert.equal(await page.locator('#profile-title-form').isVisible(), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: six badges, unlocks, save/reload, failure/retry, clear, outage, guest, bounds, no page errors`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
