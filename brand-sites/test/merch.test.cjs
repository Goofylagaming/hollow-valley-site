"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../merch");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("Book 1 stays the only upcoming product while an existing Chromie Hoodie is linked", () => {
  assert.match(html, /<html lang="en-AU">/);
  assert.match(html, /Primalbound Adventures/);
  assert.match(html, /All other product development is paused/);
  assert.match(html, /Books 2–5, new hoodies/);
  assert.match(html, /new merchandise development on hold/);
  assert.match(html, /10 real Book 1 customer orders/);
  assert.match(html, /Book 1 is not yet for sale/);
  const cards = html.match(/<article class="product-card"/g) || [];
  assert.equal(cards.length, 2, "Exactly Book 1 and the existing Chromie Hoodie are displayed");
  assert.match(html, /Hollow Valley Chromie Hoodie/);
  assert.match(html, /Price and availability on Fourthwall/);
  assert.ok(html.includes('chromie-hoodie-front-back.webp'));
  assert.match(html, /Hollow Valley Chromie black hoodie shown from the front and back/);
  assert.doesNotMatch(html, /class="chromie-graphic"/);
  const asset = fs.readFileSync(path.join(root,"assets","chromie-hoodie-front-back.webp"));
  assert.equal(asset.subarray(0,4).toString("ascii"),"RIFF");
  assert.equal(asset.subarray(8,12).toString("ascii"),"WEBP");
  assert.ok(asset.length>4000);
  assert.ok(html.includes('href="https://hvs-e-commerce-shop.fourthwall.com/en-aud/products/hollow-valley-chromie-hoodie"'), "Direct hoodie link must be exact");
  assert.equal((html.match(/class="preview-only">Preview only/g) || []).length, 1);
  assert.doesNotMatch(html, /class="catalogue-tools"/);
  assert.equal((html.match(/data-category="hollow"/g) || []).length, 1, "Only the existing Chromie hoodie is included");
  assert.doesNotMatch(html, /data-category="studio"|data-category="everyday"/);
  assert.doesNotMatch(html, /Hollow Valley Isle Graphic Tee|Dinosaur Hoodie|Travel Organisation Accessories/);
});

test("Shop does not fake checkout, products, paid orders or customer details", () => {
  assert.match(html, /https:\/\/hvs-e-commerce-shop\.fourthwall\.com\//);
  assert.doesNotMatch(html, /<form[^>]+action=|href="[^"]*checkout|buy now|add to cart/i);
  assert.doesNotMatch(html, /<input[^>]+type="password"|<iframe/i);
  const hosts = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(x => new URL(x[1]).hostname);
  const allowed = new Set(["hvs-e-commerce-shop.fourthwall.com", "primalboundgame.com", "hollowvalleyisle.com"]);
  for (const hostname of hosts) assert.ok(allowed.has(hostname), "Unexpected external domain: " + hostname);
});

test("Mobile accessibility, static safety and year script", () => {
  assert.match(css, /@media\(max-width:530px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /\.focus-panel/);
  assert.match(css, /\.product-external/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /class="skip-link"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  new vm.Script(js);
  const year = {textContent:""};
  const document = {getElementById(id) {
    assert.equal(id,"year", "No hidden commerce/filter DOM access permitted");
    return year;
  }};
  vm.runInNewContext(js, {document,Date});
  assert.match(year.textContent, /^\d{4}$/);
});
