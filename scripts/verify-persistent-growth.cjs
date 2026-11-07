// Isolated browser staging. All APIs are intercepted; never contacts the game host.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const app = express(); app.use(express.static(path.join(__dirname, '../public')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      let owner = true, confirmation = 'wrong', uncertain = false;
      const posts = [], errors = [];
      let status = { connected: true, canWrite: true, growth: { configuredMultiplier: 3, configHash: 'a'.repeat(64), state: 'unverified' } };
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept(confirmation));
      await page.route('**/api/**', async route => {
        const req = route.request(), pathname = new URL(req.url()).pathname;
        let body = {};
        if (pathname === '/api/me') body = { loggedIn: true, financeOwnerAccess: owner, user: { id: 7, is_admin: 1, username: 'Staging owner' } };
        else if (pathname === '/api/admin/server-management/growth') {
          if (req.method() === 'POST') {
            assert.match(req.headers()['content-type'], /application\/json/);
            assert.equal(req.headers()['x-hv-owner-action'], 'growth-config-v1');
            posts.push(req.postDataJSON());
            if (uncertain) return route.abort('failed');
            body = { job: { state: 'queued' } };
            status = { ...status, canWrite: false, latestJob: { ...posts.at(-1), state: 'queued' } };
          } else body = status;
        } else if (pathname === '/api/wallet/daily-login/claim') body = { claimed: false };
        else if (req.method() === 'POST') { errors.push(`Unexpected write: ${pathname}`); return route.fulfill({ status: 403, body: '{}' }); }
        else if (pathname === '/api/admin-operations') body = { status: { rconControl: { configured: true, actionGates: { growthMultiplier: true } } } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      const url = `http://127.0.0.1:${server.address().port}/adminoperations.html`;
      await page.goto(url);
      const save = page.locator('#ops-persistent-growth-save');
      await save.waitFor(); await page.waitForFunction(() => !document.getElementById('ops-persistent-growth-save').disabled);
      assert.equal(await page.locator('#ops-persistent-growth-value').inputValue(), '5');
      await save.click(); assert.equal(posts.length, 0, 'Incorrect confirmation must not submit');
      confirmation = 'SAVE 5X GROWTH'; uncertain = true;
      await save.click();
      await page.waitForFunction(() => document.getElementById('ops-persistent-growth-message').textContent.includes('retained'));
      const first = posts[0]; assert.equal(first.multiplier, 5);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('ops-persistent-growth-save').textContent.includes('retry'));
      uncertain = false; await save.click();
      await page.waitForFunction(() => document.getElementById('ops-persistent-growth-save').disabled);
      assert.deepEqual(posts[1], first, 'Reload retry must reuse the exact request identity and payload');
      status = { ...status, latestJob: { ...status.latestJob, state: 'written' }, growth: { ...status.growth, configuredMultiplier: 5, state: 'pending_restart' } };
      await page.locator('#ops-persistent-growth-refresh').click();
      await page.waitForFunction(() => document.getElementById('ops-persistent-growth-current').textContent.includes('Awaiting scheduled restart'));
      assert.equal(await save.isDisabled(), true);
      if (process.env.GROWTH_SCREENSHOT_DIR) await page.locator('#persistent-growth-controls').screenshot({ path: path.join(process.env.GROWTH_SCREENSHOT_DIR, `growth-${viewport.width}.png`) });
      status = { connected: false, canWrite: false, reason: 'Old agent requires an update.' };
      await page.locator('#ops-persistent-growth-refresh').click();
      await page.waitForFunction(() => document.getElementById('ops-persistent-growth-message').textContent.includes('update'));
      assert.equal(await save.isDisabled(), true);
      owner = false; await page.reload();
      assert.equal(await page.locator('#persistent-growth-controls').isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Desktop/mobile growth UI passed: owner visibility, 5x request, confirmation, durable retry, pending restart and old-agent gating.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
