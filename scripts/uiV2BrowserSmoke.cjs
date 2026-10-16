"use strict";
// Isolated, read-only UI staging smoke checks. Never point this at production.
// The actual Express app serves pages; browser API mocks never touch player data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createApp } = require("../server/index");

const root = path.join(__dirname, "..");
const screenshots = path.join(root, "staging-ui-screenshots");
fs.mkdirSync(screenshots, { recursive: true });

const guest = {
  loggedIn: false, user: null,
  steamLoginConfigured: true, discordLoginConfigured: true,
};
const serverStatus = { configured: true, online: true, playerCount: 12, maxPlayers: 100 };

async function setReadOnlyApiMocks(page, me = guest) {
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) });
    }
    if (pathname === "/api/server-status") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverStatus) });
    }
    // These APIs normally proxy to live automation. Test page rendering with
    // read-only fixture data instead of accessing the real game economy.
    if (["/api/marketplace/catalog", "/api/marketplace/listings"].includes(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (pathname === "/api/marketplace/state") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ officialWritesEnabled: false, p2pWritesEnabled: false, p2pBuyEnabled: false }) });
    }
    // Avoid accidental writes even if a page auto-submits a login bonus request.
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ duplicate: true, ok: true }) });
    }
    return route.continue();
  });
  // Limit third-party requests in offline staging to assets served by our app.
  await page.route(/https?:\/\/(?!127\.0\.0\.1)[^/]+\//, (route) => route.abort());
}

function collect(page) {
  const errors = [];
  const missing = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 300)));
  page.on("response", (resp) => {
    const url = resp.url();
    if (url.includes("/assets/") && resp.status() >= 400) {
      missing.push(resp.status() + " " + new URL(url).pathname);
    }
  });
  return { errors, missing };
}

async function checkPage(browser, origin, route, size, name, opts = {}) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  const issues = collect(page);
  try {
    await setReadOnlyApiMocks(page);
    const resp = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 25000 });
    assert.equal(resp.status(), 200, name + " HTTP status");
    await page.locator(".snapshot-topbar").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator("main").count() > 0, true, name + " main missing");
    assert.equal(await page.locator('link[href*="ui-v2.css"]').count(), 1, name + " theme missing");
    assert.equal(await page.locator('link[href*="snapshot-ui.css"]').count(), 1, name + " snapshot layer missing");

    const color = await page.locator("body").evaluate((el) => getComputedStyle(el).color);
    assert.equal(color, "rgb(241, 247, 244)", name + " dark forest theme not applied");
    assert.equal(await page.locator("#admin-nav-group").evaluate((el) => el.hidden), true, name + " Admin links visible to guest");
    for (const href of ["/wallet", "/quests", "/marketplace", "/dinostorage/", "/skins"]) {
      assert.ok(await page.locator('.main-nav a[href="' + href + '"]').count(), name + " link missing " + href);
    }

    if (size.width <= 1050) {
      const menu = page.locator(".menu-toggle");
      assert.equal(await menu.isVisible(), true, name + " mobile navigation toggle hidden");
      await menu.click();
      assert.equal(await page.locator(".main-nav").evaluate((el) => el.classList.contains("open")), true, name + " mobile nav not opened");
      assert.equal(await page.locator('.main-nav a[href="/wallet"]').isVisible(), true, name + " Wallet hidden in mobile menu");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".main-nav").evaluate((el) => el.classList.contains("open")), false, name + " Escape does not close menu");
    }
    if (opts.capture) {
      await page.screenshot({ path: path.join(screenshots, name.replace(/[^a-z0-9_-]/gi, "_") + ".png"), fullPage: false });
    }
    // Allow page scripts a tick to load; actual API data is mocked or isolated.
    await page.waitForTimeout(200);
    assert.deepEqual(issues.missing, [], name + " missing local JS/CSS assets");
    assert.deepEqual(issues.errors, [], name + " uncaught JavaScript runtime errors");
    console.log("PASS", name, route, size.width + "x" + size.height);
  } finally {
    await context.close();
  }
}

async function main() {
  assert.ok(process.env.DB_PATH, "Must set DB_PATH to isolated staging SQLite file");
  assert.ok(!process.env.DB_PATH.startsWith("/app/data"), "Never use Render persistent disk");
  const app = createApp();
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, "127.0.0.1", () => resolve(handle));
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const desktop = { width: 1440, height: 900 };
    const tablet = { width: 820, height: 1100 };
    const phone = { width: 390, height: 844 };
    // Real Express pages in a disposable environment; no production tokens or DB.
    for (const [route, label] of [
      ["/", "home"], ["/wallet", "wallet"], ["/marketplace", "marketplace"],
      ["/marketplace-official.html", "market-official"], ["/marketplace-players.html", "market-player"],
      ["/dinostorage/", "dino-storage"], ["/events", "events"],
      ["/owner-login", "owner-login"], ["/livemap", "live-map"], ["/skins", "skin-studio"],
    ]) {
      await checkPage(browser, origin, route, desktop, label + "-desktop", { capture: ["home", "wallet", "marketplace", "dino-storage"].includes(label) });
    }
    for (const [route, label] of [
      ["/", "home"], ["/wallet", "wallet"], ["/marketplace", "marketplace"],
      ["/dinostorage/", "dino-storage"],
    ]) {
      await checkPage(browser, origin, route, tablet, label + "-tablet");
      await checkPage(browser, origin, route, phone, label + "-phone", { capture: true });
    }
    const page = await browser.newPage();
    const response = await page.goto(origin + "/admin");
    assert.ok([401, 403, 302].includes(response.status()), "Admin page should block unauthenticated requests; got " + response.status());
    console.log("PASS", "admin access denied without a valid production session");
    await page.close();
    console.log("STAGING UI BROWSER SMOKE PASSED");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error("STAGING UI BROWSER SMOKE FAILED:", error.stack); process.exitCode = 1; });
