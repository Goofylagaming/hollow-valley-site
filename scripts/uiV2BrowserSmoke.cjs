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
    // The pack checker is a read-only query even though it uses POST. Only
    // allow it through to this isolated staging database, never production.
    if (pathname === "/api/community-guides/check") return route.continue();
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

    if (route === "/") {
      assert.equal(await page.locator("#home-roadmap-stages > .roadmap-stage").count(), 6,
        "Homepage must preserve all roadmap stages");
      assert.equal(await page.locator(".roadmap-feature").count(), 31,
        "Homepage must retain all 31 community roadmap features");
      assert.ok(await page.locator("#roadmap-suggestion-form").count(),
        "The roadmap suggestion form must remain reachable");
    }

    if (size.width > 1050 && route === "/") {
      const myStuff = page.locator("#my-stuff-nav-group > button");
      await myStuff.click();
      assert.equal(await myStuff.getAttribute("aria-expanded"), "true",
        "Desktop My Stuff dropdown must open");
      assert.equal(await page.locator('#my-stuff-submenu a[href="/dinostorage/"]').isVisible(), true,
        "Dino Storage must be visible in the desktop submenu");
      await page.locator(".home-hub-intro").click();
      assert.equal(await myStuff.getAttribute("aria-expanded"), "false",
        "Clicking outside desktop dropdown must close it");
    }

    if (size.width <= 1050) {
      const menu = page.locator(".menu-toggle");
      assert.equal(await menu.isVisible(), true, name + " mobile navigation toggle hidden");
      await menu.click();
      assert.equal(await page.locator(".main-nav").evaluate((el) => el.classList.contains("open")), true, name + " mobile nav not opened");
      assert.equal(await page.locator('.main-nav a[href="/wallet"]').isVisible(), true, name + " Wallet hidden in mobile menu");
      if (route === "/") {
        const communityButton = page.locator("#community-nav-group > button");
        await communityButton.click();
        assert.equal(await communityButton.getAttribute("aria-expanded"), "true",
          "Community mobile submenu must open");
        assert.equal(await page.locator('#community-submenu a[href="/groups"]').isVisible(), true,
          "Groups must be accessible in the mobile submenu");
        await page.keyboard.press("Escape");
        assert.equal(await communityButton.getAttribute("aria-expanded"), "false",
          "Escape must close the open mobile submenu");
        assert.equal(await page.locator(".main-nav").evaluate((el) => el.classList.contains("open")), true,
          "Closing a submenu should leave the mobile navigation available");
      }
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".main-nav").evaluate((el) => el.classList.contains("open")), false, name + " Escape does not close menu");
    }
    if (route === "/support") {
      await page.locator("#hv-support-guest").waitFor({state:"visible",timeout:12000});
      assert.equal(await page.locator("#hv-support-app").isVisible(),false,
        "Support creation and private ticket list must not be visible to guests");
      assert.ok(await page.locator('a[href="/auth/steam?returnTo=/support"]').count(),
        "Guest must be able to sign in with Steam");
    }
    if (route === "/updates") {
      await page.locator("#hv-updates-feedback").getByText("0 published update(s)", {exact:false})
        .waitFor({timeout:12000});
      assert.equal(await page.locator("#hv-updates-list .hv-update-card").count(), 0,
        "Unpublished development changes must never appear as a live release");
      assert.ok(await page.locator('a[href="/#roadmap"]').count(),
        "Roadmap remains reachable from Updates");
    }
    if (route === "/") {
      await page.locator("#home-updates-list").getByText("first approved development", {exact:false})
        .waitFor({timeout:12000});
      assert.equal(await page.locator("#home-updates-list .hv-home-update").count(),0,
        "Homepage may not invent news items before staff publishes any");
    }
    if (route === "/rules") {
      await page.locator("#hv-rules-status").getByText("No approved Hollow Valley rules", { exact:false })
        .waitFor({ timeout:12000 });
      assert.equal(await page.locator("#hv-rules-list .hv-rule-item").count(),0,
        "An isolated staging database must not invent official server rules");
    }
    if (route === "/packs") {
      await page.locator("#hv-species-list .hv-species-card").first()
        .waitFor({ timeout:12000 });
      assert.equal(await page.locator("#hv-species-list .hv-species-card").count(),21,
        "Pack directory must reuse Hollow Valley's existing species list");
      await page.locator("#hv-pack-species-a").selectOption("tyrannosaurus");
      await page.locator("#hv-pack-count").fill("3");
      await page.locator("#hv-pack-checker button[type=submit]").click();
      await page.locator("#hv-pack-result").getByText("No staff-published group-size limit", { exact:false })
        .waitFor({ timeout:12000 });
      assert.equal(await page.locator("#hv-pack-result").getAttribute("data-status"), "unverified",
        "Reference pack sizes must not become rules automatically");
    }
    if (route === "/groups") {
      assert.equal(await page.locator(".groups-note").first().isVisible(), true, "Groups must be website-only");
      assert.equal(await page.locator("#groups-signin").isVisible(), true, "Guest should be prompted to sign in");
      assert.equal(await page.locator('a[href="/groups/territory-wars/"]').count(), 0, "Territory Wars not enabled");
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

async function checkAuthenticatedGroupProgress(browser, origin){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const issues=collect(page);
  const steam="76561198000000101";
  const group={
    current:{id:42,name:"Valley Pack",ownerSteamId:steam,role:"owner",
      createdAt:"2026-10-16 00:00:00",capacity:12,
      members:[{steamId:steam,username:"Alpha",role:"owner",joinedAt:"2026-10-16 00:00:00"}],
      sentInvites:[]},
    incoming:[],previous:[]
  };
  const progress={
    group:{id:42,name:"Valley Pack",activeMembers:1},groupXp:175,weeklyXp:75,
    resetAt:"2026-10-18T14:00:00.000Z",
    achievements:[{id:"founding-pack",title:"Founding Pack",description:"Start a Hollow Valley group.",
      target:1,progress:1,xp:100,completed:true}],
    quests:[{id:"welcome-one",title:"A New Face",description:"Welcome a player this week.",
      target:1,progress:1,xp:75,completed:true}],
  };
  try{
    await page.route("**/api/**",route=>{
      const p=new URL(route.request().url()).pathname;
      const fixture=p==="/api/me"?{loggedIn:true,user:{steam_id:steam,username:"Alpha"}}:
        p==="/api/groups"?group:p==="/api/groups/progress"?progress:
        p==="/api/server-status"?serverStatus:null;
      if(fixture)return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixture)});
      if(route.request().method()!=="GET")
        return route.fulfill({status:200,contentType:"application/json",body:"{}"});
      return route.continue();
    });
    await page.route(/https?:\/\/(?!127\.0\.0\.1)[^/]+\//,route=>route.abort());
    const resp=await page.goto(origin+"/groups",{waitUntil:"domcontentloaded"});
    assert.equal(resp.status(),200);
    await page.locator("#groups-xp-value").getByText("175").waitFor({timeout:15000});
    assert.equal(await page.locator(".groups-milestone").count(),2);
    assert.equal(await page.locator(".groups-milestone.is-complete").count(),2);
    assert.equal(await page.locator("#groups-achievements-count").textContent(),"1 / 1 earned");
    assert.equal(await page.locator("#groups-quests-count").textContent(),"1 / 1 complete");
    assert.equal(await page.locator("#groups-progress-panel").isVisible(),true);
    assert.deepEqual(issues.errors,[],"No JavaScript errors in authenticated Group Progress");
    assert.deepEqual(issues.missing,[],"No missing Groups assets");
    await page.screenshot({path:path.join(screenshots,"groups-achievements-phone.png"),fullPage:true});
    console.log("PASS authenticated Groups Achievements & Quests mobile");
  }finally{await context.close();}
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
      ["/dinostorage/", "dino-storage"], ["/groups", "groups"], ["/help", "help"], ["/events", "events"],
      ["/owner-login", "owner-login"], ["/livemap", "live-map"], ["/skins", "skin-studio"],
      ["/rules", "rules"], ["/packs", "packs"], ["/updates", "updates"], ["/support", "support"],
    ]) {
      await checkPage(browser, origin, route, desktop, label + "-desktop", { capture: ["home", "wallet", "marketplace", "dino-storage", "help", "rules", "packs", "updates", "support"].includes(label) });
    }
    for (const [route, label] of [
      ["/", "home"], ["/wallet", "wallet"], ["/marketplace", "marketplace"],
      ["/dinostorage/", "dino-storage"], ["/groups", "groups"], ["/help", "help"],
      ["/rules", "rules"], ["/packs", "packs"],
    ]) {
      await checkPage(browser, origin, route, tablet, label + "-tablet");
      await checkPage(browser, origin, route, phone, label + "-phone", { capture: true });
    }
    await checkAuthenticatedGroupProgress(browser, origin);
    const page = await browser.newPage();
    const response = await page.goto(origin + "/admin");
    assert.ok([401, 403, 302].includes(response.status()), "Admin page should block unauthenticated requests; got " + response.status());
    for (const route of ["/adminrules", "/adminrules.html", "/adminupdates", "/adminupdates.html", "/adminsupport", "/adminsupport.html"]) {
      const guarded = await page.goto(origin + route);
      assert.ok([401, 403, 302].includes(guarded.status()),
        "Rules editor must block unauthenticated requests at " + route + "; got " + guarded.status());
    }
    console.log("PASS", "admin access denied without a valid production session");
    await page.close();
    console.log("STAGING UI BROWSER SMOKE PASSED");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error("STAGING UI BROWSER SMOKE FAILED:", error.stack); process.exitCode = 1; });
