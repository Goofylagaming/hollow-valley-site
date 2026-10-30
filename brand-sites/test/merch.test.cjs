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

test("Book 1 is the sole featured product and others are explicitly on hold", () => {
  assert.match(html, /<html lang="en-AU">/);
  assert.match(html, /Primalbound Adventures/);
  assert.match(html, /All other product development is paused/);
  assert.match(html, /Books 2–5, hoodies/);
  assert.match(html, /10 genuine customer orders/);
  assert.match(html, /Book 1 is not yet for sale/);
  const cards = html.match(/<article class="product-card"/g) || [];
  assert.equal(cards.length, 1, "Only Book 1 is permitted in the product grid");
  assert.equal((html.match(/class="preview-only">Preview only/g) || []).length, 1);
  assert.doesNotMatch(html, /class="catalogue-tools"/);
  assert.doesNotMatch(html, /data-category="hollow"|data-category="studio"|data-category="everyday"/);
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
