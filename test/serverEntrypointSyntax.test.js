"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("Hollow Valley website and automation entrypoints parse before deployment", () => {
  for (const file of ["server/index.js", "automation-platform/src/index.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file);
  }
});

test("website preserves public routes and declares PAGE_ROUTES only once", () => {
  const source = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const declarations = [...source.matchAll(/\bconst\s+PAGE_ROUTES\s*=\s*(\[[^\]]*\]);/g)];
  assert.equal(declarations.length, 1, "PAGE_ROUTES must be declared exactly once");
  const paths = JSON.parse(declarations[0][1]);
  for (const page of ["livemap", "wallet", "marketplace", "events", "reports", "help", "rules", "packs", "updates", "support", "community", "recruitment", "activity", "status"]) {
    assert.ok(paths.includes(page), `Missing public route: ${page}`);
  }
});
