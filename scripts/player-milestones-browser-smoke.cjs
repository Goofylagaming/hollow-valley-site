'use strict';
// Isolated browser staging: all API traffic is fixture-backed, no player writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
async function main() {
  const app = express(); app.use(express.static(path.join(__dirname, '../public')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.MILESTONE_BROWSER_CHANNEL ? { channel: process.env.MILESTONE_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext();
    const base = `http://127.0.0.1:${server.address().port}`;
    let current = 0;
    const prefs = { sanctuary: true, patrol: true, migration: true, inGame: false };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/me') data = { loggedIn: true, user: { steam_id: '76561198000000101', username: 'Staging Survivor' } };
      if (url.pathname === '/api/player-milestones/preferences') {
        Object.assign(prefs, JSON.parse(route.request().postData())); data = { preferences: prefs };
      } else if (url.pathname === '/api/player-milestones') {
        data = { steamId: '76561198000000101', cursor: current, preferences: prefs, enabled: true, inGameAvailable: false,
          stats: { unique: { patrol: 1, migration: 2 }, entries: { patrol: 3, migration: 4 } },
          events: url.searchParams.has('after') && Number(url.searchParams.get('after')) < current ?
            [{ id: current, message: 'Sanctuary entered: <img src=x onerror=alert(1)>' }] : [] };
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const a = await context.newPage(), b = await context.newPage();
    await Promise.all([a.goto(base + '/profile.html'), b.goto(base + '/profile.html')]);
    await Promise.all([a.waitForSelector('#player-notifications', { state: 'attached' }), b.waitForSelector('#player-notifications', { state: 'attached' })]);
    // Profile scripts may hide unrelated identity content when their fixture is empty.
    await a.locator('#profile-content').evaluate(el => { el.hidden = false; });
    assert.equal(await a.locator('[data-preference]').count(), 4);
    assert.equal(await a.locator('[data-preference=inGame]').isDisabled(), true);
    assert.match(await a.locator('#player-notifications').innerText(), /Patrol 1 unique \/ 3 entries/);
    current = 1;
    await Promise.all([a.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))), b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))]);
    await a.waitForFunction(() => Number(localStorage.getItem('hv-milestone-seen:76561198000000101')) === 1);
    assert.equal(await a.locator('.player-milestone-toast').count() + await b.locator('.player-milestone-toast').count(), 1);
    assert.equal(await a.locator('.player-milestone-toast img').count() + await b.locator('.player-milestone-toast img').count(), 0);
    await a.locator('[data-preference=patrol]').uncheck();
    await a.waitForFunction(() => document.getElementById('player-notifications').textContent.includes('settings saved'));
    assert.equal(prefs.patrol, false);
    await a.setViewportSize({ width: 390, height: 844 });
    const bounds = await a.locator('#player-notifications').boundingBox();
    assert.ok(bounds.width <= 390, 'Settings fit mobile width');
    console.log('PASS: actual profile loads settings; private toast; cross-tab dedupe; text escaping; saved toggle; mobile layout');
    await context.close();
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
