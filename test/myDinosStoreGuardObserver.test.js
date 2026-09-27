const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("stored-dino highlighting settles after its own DOM mutations", () => {
  const callbacks = [];
  const queue = [];
  const observers = new Map();
  let status = null;
  let label = null;

  const activeCard = { id: "active" };
  const storageGrid = {
    id: "storage",
    querySelector(selector) { return selector === ".storage-dino-card" ? card : null; },
  };
  function notify(target) {
    const observer = observers.get(target);
    if (observer) queue.push(observer);
  }
  function element(className, owner) {
    return {
      className,
      style: {},
      dataset: {},
      textContent: "",
      remove() {
        if (className === "hv-parked-status") status = null;
        if (className === "hv-parked-match-label") label = null;
        notify(owner);
      },
    };
  }
  const tag = {
    value: "LIVE IN GAME",
    get textContent() { return this.value; },
    set textContent(value) { this.value = value; notify(activeCard); },
  };
  const banner = {
    style: {}, dataset: {},
    querySelector(selector) {
      if (selector === ".active-tag") return tag;
      if (selector === ".hv-parked-status") return status;
      return null;
    },
    querySelectorAll(selector) { return selector === ".hv-parked-status" && status ? [status] : []; },
    appendChild(node) { status = node; notify(activeCard); },
  };
  const card = {
    style: {}, dataset: {},
    querySelector(selector) { return selector === ".hv-parked-match-label" ? label : null; },
    querySelectorAll(selector) { return selector === ".hv-parked-match-label" && label ? [label] : []; },
    prepend(node) { label = node; notify(storageGrid); },
  };
  const slotAction = { dataset: { slot: "stored1" }, closest() { return card; } };
  const document = {
    addEventListener() {},
    getElementById(id) { return { "active-character-card": activeCard, "storage-grid": storageGrid }[id] || null; },
    querySelector(selector) { return selector === "#active-character-card .active-char-banner" ? banner : null; },
    querySelectorAll(selector) {
      if (selector === "[data-hv-parked-match='true']") return [banner, card].filter((node) => node.dataset.hvParkedMatch === "true");
      if (selector === "#storage-grid [data-slot]") return [slotAction];
      return [];
    },
    createElement(className) { return element(className, className === "div" ? activeCard : storageGrid); },
  };
  const context = {
    document,
    window: { HDS: { api: async () => ({}) }, location: { replace() {}, reload() {} } },
    sessionStorage: { getItem() { return null; } },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(target) { observers.set(target, this.callback); } },
    queueMicrotask(callback) { queue.push(callback); },
    activeCharacter: { species: "Triceratops", growth: 0.5, gender: "Male", isPrime: false },
    storedDinos: [{ slot: "stored1", species: "Triceratops", growth: 0.5, gender: "Male", isPrime: false }],
  };
  const script = fs.readFileSync(path.join(__dirname, "../public/assets/mydinos-store-guard.js"), "utf8");
  vm.runInNewContext(script, context);

  while (queue.length && callbacks.length < 20) {
    const callback = queue.shift();
    callbacks.push(callback);
    callback();
  }
  assert.equal(queue.length, 0, "highlight mutations must stop triggering further changes");
  assert.ok(callbacks.length <= 4);
  assert.equal(tag.textContent, "ALREADY STORED / PARKED");
  assert.equal(status?.textContent, "✓ STORE DISABLED — DINO IS ALREADY PARKED");
  assert.equal(label?.textContent, "CURRENT PARKED DINO");
});
