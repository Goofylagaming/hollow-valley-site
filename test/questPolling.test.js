const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('quests refresh, preserve filters, pause hidden tabs, and retain data on failure', async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, innerHTML: '', textContent: '', querySelectorAll: () => [] });
    return elements.get(id);
  };
  let calls = 0;
  let fail = false;
  let release;
  let interval;
  let visibility;
  const document = {
    hidden: false, getElementById: element, querySelector: element,
    addEventListener: (_name, fn) => { visibility = fn; },
  };
  const context = vm.createContext({
    document,
    window: { HDS: {
      escapeHtml: String,
      loadMe: async () => ({ loggedIn: true }),
      api: async (_url, options) => {
        calls++;
        assert.equal(options.cache, 'no-store');
        if (release) await new Promise((resolve) => { release = resolve; });
        if (fail) throw new Error('temporary failure');
        return { trackingEnabled: true, quests: [], challenges: [] };
      },
    } },
    setInterval: (fn, ms) => { assert.equal(ms, 30000); interval = fn; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/assets/quests.js'), 'utf8'), context);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  vm.runInContext('selectedQuestFilter = "weekly"', context);
  await interval();
  assert.match(element('quest-list').innerHTML, /data-quest-filter="weekly" aria-pressed="true"/);
  document.hidden = true;
  await interval();
  assert.equal(calls, 2);
  document.hidden = false;
  visibility();
  await new Promise(setImmediate);
  assert.equal(calls, 3);
  const lastBoard = element('quest-list').innerHTML;
  fail = true;
  await interval();
  assert.equal(element('quest-list').innerHTML, lastBoard);
  assert.match(element('.quest-section-intro').textContent, /refresh failed/);
  fail = false;
  release = true;
  const pending = interval();
  await new Promise(setImmediate);
  await interval();
  assert.equal(calls, 5);
  release();
  await pending;
});
