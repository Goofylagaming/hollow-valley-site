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

test("catalogue is a non-transactional preview with verified external destinations", () => {
  assert.match(html, /<html lang="en-AU">/);
  assert.match(html, /This is a preview catalogue/);
  assert.match(html, /none of the preview cards above is a purchase listing/);
  assert.match(html, /https:\/\/hvs-e-commerce-shop\.fourthwall\.com\//);
  const cards = html.match(/<article class="product-card"/g) || [];
  assert.equal(cards.length, 6);
  const filters = html.match(/<button class="filter[^"]*" type="button" data-category=/g) || [];
  assert.equal(filters.length, 5);
  assert.equal((html.match(/class="preview-only">Preview only/g) || []).length, 6);
  assert.doesNotMatch(html, /<form[^>]+action=|href="[^"]*checkout|buy now|add to cart/i);
  const external = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((x) => new URL(x[1]).hostname);
  const allowed = new Set(["hvs-e-commerce-shop.fourthwall.com", "primalboundgame.com", "hollowvalleyisle.com"]);
  for (const host of external) assert.ok(allowed.has(host), "unexpected external link: " + host);
});

test("styling is self-contained, mobile-responsive and reduced-motion aware", () => {
  assert.match(css, /@media\(max-width:530px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /class="skip-link"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  new vm.Script(js);
});

test("collection filters, search, and reset operate correctly", () => {
  function el(dataset = {}, textContent = "") {
    const listeners = {};
    return {
      dataset, textContent, hidden: false, value: "",
      listeners,
      classList: {toggle() {}},
      setAttribute() {},
      focus() {},
      addEventListener(type, fn) { listeners[type] = fn; }
    };
  }
  const categories = ["all", "primalbound", "hollow", "studio", "everyday"];
  const buttons = categories.map((category) => el({category}));
  const cards = [
    el({category:"primalbound",search:"dinosaur book"},"Book"),
    el({category:"primalbound",search:"dinosaur hoodie"},"Hoodie"),
    el({category:"primalbound",search:"sticker"},"Sticker"),
    el({category:"hollow",search:"isle t-shirt"},"Isle Tee"),
    el({category:"studio",search:"engraved board"},"Board"),
    el({category:"everyday",search:"travel organiser"},"Travel")
  ];
  const search = el();
  const counter = el();
  const empty = el();
  const clear = el();
  const year = el();
  const jump = el({jumpCategory:"primalbound"});
  const document = {
    querySelectorAll(selector) {
      if (selector === ".filter[data-category]") return buttons;
      if (selector === ".product-card[data-category]") return cards;
      if (selector === "[data-jump-category]") return [jump];
      throw new Error("unknown selector " + selector);
    },
    getElementById(id) {
      return {
        "product-search":search,"result-count":counter,"empty-results":empty,
        "clear-filters":clear,"year":year
      }[id];
    }
  };
  vm.runInNewContext(js, {document, Date});
  assert.equal(counter.textContent,"Showing 6 previews");
  buttons[2].listeners.click();
  assert.equal(counter.textContent,"Showing 1 preview");
  assert.equal(cards.filter((x) => !x.hidden).length,1);
  search.value="not-a-real-product";
  search.listeners.input();
  assert.equal(counter.textContent,"Showing 0 previews");
  assert.equal(empty.hidden,false);
  clear.listeners.click();
  assert.equal(counter.textContent,"Showing 6 previews");
  assert.equal(empty.hidden,true);
  jump.listeners.click();
  assert.equal(counter.textContent,"Showing 3 previews");
});
