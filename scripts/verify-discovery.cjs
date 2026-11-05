const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.HV_TEST_BROWSER });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      let settings = { enabled: false, revision: 0 }, cleared = false, readOnly = false;
      const writes = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://localhost') return route.abort();
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/assets/common.js') return route.fulfill({ contentType: 'text/javascript', body: `window.HDS={api:async(u,o={})=>(await fetch(u,{headers:{'Content-Type':'application/json'},...o})).json(),loadMe:async()=>({user:{steam_id:'76561198000000801'}})};` });
        if (url.pathname.endsWith('/capabilities')) return json({ enabled: true, readOnly });
        if (url.pathname.endsWith('/settings') && route.request().method() === 'GET') return json(settings);
        if (url.pathname.endsWith('/settings') || url.pathname.endsWith('/delete')) {
          const body = route.request().postDataJSON(); writes.push(body);
          settings = { enabled: body.enabled ?? false, revision: settings.revision + 1 };
          if (url.pathname.endsWith('/delete')) cleared = true;
          return json(settings);
        }
        if (url.pathname.endsWith('/points')) return json({ total: 2, bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 }, points: cleared ? [] : [{ name: 'Cave <img src=x>', x: 0, y: 0 }] });
        if (url.pathname.endsWith('.js') && !url.pathname.includes('livemap-discovery')) return route.fulfill({ contentType: 'text/javascript', body: '' });
        const file = path.join(__dirname, '../public', url.pathname === '/livemap' ? 'livemap.html' : url.pathname.slice(1));
        if (!fs.existsSync(file)) return route.abort();
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'text/javascript' });
      });
      const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
      await page.goto('http://localhost/livemap');
      await page.getByText('1 of 2 locations discovered. Discovery recording is off.', { exact: true }).waitFor();
      assert.equal(await page.locator('#tracker-discoveries img').count(), 0);
      await page.check('#discovery-mode');
      for (const id of ['tracker-pois', 'tracker-labels', 'tracker-shapes', 'territory-war-shapes', 'territory-war-overlay-slot']) assert.equal(await page.locator('#' + id).evaluate(element => getComputedStyle(element).display), 'none');
      assert.equal(await page.locator('#tracker-discoveries').evaluate(element => getComputedStyle(element).display), 'block');
      await page.check('#discovery-optin'); await page.click('#discovery-save');
      await page.getByText('1 of 2 locations discovered. Discovery recording is on.', { exact: true }).waitFor();
      assert.deepEqual(writes[0], { enabled: true, expectedRevision: 0 });
      await page.click('#discovery-delete'); await page.getByText('0 of 2 locations discovered. Discovery recording is off.', { exact: true }).waitFor();
      assert.equal(await page.locator('#tracker-discoveries .poi').count(), 0);
      readOnly = true; await page.reload(); await page.getByText(/This preview is read-only/).waitFor(); assert.equal(await page.locator('#discovery-save').isDisabled(), true);
      assert.deepEqual(errors, []); console.log(`PASS ${width}px discovery controls, layer filtering, safe text, clearing and read-only mode`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
