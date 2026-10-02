const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("CommandBridge routes dino_grant into DinoStorage", () => {
  const source = read("server-mods/CommandBridge/Scripts/main.lua");
  assert.match(source, /dino_grant\s*=\s*"grant"/);
  assert.match(source, /MOD_VERSION = "v006\.6"/);
});

test("DinoStorage marketplace grant is local, idempotent and order-marked", () => {
  const source = read("server-mods/DinoStorage/Scripts/main.lua");
  assert.match(source, /MOD_VERSION = "v008"/);
  assert.match(source, /verb == "grant"/);
  assert.match(source, /writeMarketplaceGrant/);
  assert.match(source, /marketplacePurchase/);
  assert.match(source, /marketplace slot already exists for this order/);
  assert.match(source, /target slot contains another dinosaur/);
  assert.match(source, /"hunger": 9999\.0/);
  assert.match(source, /"food": 9999\.0/);
  assert.match(source, /"carbValue":9999\.0/);
  assert.match(source, /"proteinValue":9999\.0/);
  assert.match(source, /"lipidValue":9999\.0/);
});
