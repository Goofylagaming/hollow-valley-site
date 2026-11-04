const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../public/assets/skin-studio-core');
const pack = require('../public/assets/premium-skin-drafts.json');
const original = require('../public/assets/hollow-valley-skin-pack.json');

test('three premium palettes use exactly the supported native fields and default indices', () => {
  assert.deepEqual(pack.skins.map(x => x.name), ['Ashfall', 'Moonlit Marsh', 'Valley Royalty']);
  assert.notEqual(pack.id, original.id);
  for (const entry of pack.skins) {
    assert.deepEqual(Object.keys(entry.colors).sort(), [...core.COLOR_KEYS].sort());
    const skin = Object.fromEntries(core.COLOR_KEYS.map(key => [key, core.hexToColor(entry.colors[key])]));
    for (const key of core.INDEX_KEYS) {
      assert.equal(entry[key], 0);
      skin[key] = entry[key];
    }
    const payload = core.validateDocument(core.createDocument({ name: entry.name, description: entry.description, species: pack.species, skin }));
    assert.deepEqual(Object.keys(payload.skin).sort(), [...core.COLOR_KEYS, ...core.INDEX_KEYS].sort());
    assert.match(payload.description, /UNVERIFIED DRAFT/);
  }
});

function element() {
  return { children: [], style: {}, textContent: '', append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; } };
}

test('preview renders all 30 labelled swatches with only one static read and no player-data access', async () => {
  const nodes = { status: element(), drafts: element() };
  const calls = [];
  const before = JSON.stringify(pack);
  const script = fs.readFileSync(path.join(__dirname, '../public/assets/premium-skin-preview.js'), 'utf8');
  await vm.runInNewContext(script, {
    window: { HVSkinStudioCore: core },
    document: { getElementById: id => nodes[id], createElement: element },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => pack }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/assets/premium-skin-drafts.json');
  assert.equal(calls[0].options.method, undefined);
  assert.equal(nodes.drafts.children.length, 3);
  for (const [i, card] of nodes.drafts.children.entries()) {
    assert.equal(card.children[0].textContent, pack.skins[i].name);
    assert.equal(card.children[2].children.length, 10);
    for (const figure of card.children[2].children) assert.match(figure.children[1].textContent, /#[0-9A-F]{6}$/);
  }
  assert.match(nodes.status.textContent, /not been verified/);
  assert.equal(JSON.stringify(pack), before);
});

test('preview fails visibly without partial cards when the draft file is unavailable', async () => {
  const nodes = { status: element(), drafts: element() };
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/premium-skin-preview.js'), 'utf8'), {
    document: { getElementById: id => nodes[id] },
    fetch: async () => ({ ok: false, status: 503 }),
  });
  assert.match(nodes.status.textContent, /unavailable \(503\)/);
  assert.equal(nodes.drafts.children.length, 0);
});

test('existing pack importer accepts the drafts and only creates new unpublished records on explicit import', async () => {
  const nodes = new Map();
  const calls = [];
  const get = id => {
    if (id === 'hv-pack-tools') return null;
    if (!nodes.has(id)) nodes.set(id, { ...element(), handlers: {}, parentElement: { insertBefore() {} },
      addEventListener(name, handler) { this.handlers[name] = handler; }, click() {} });
    return nodes.get(id);
  };
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/hollow-valley-skin-pack.js'), 'utf8'), {
    window: { HDS: { api: async (url, options) => calls.push({ url, options }) } },
    document: { readyState: 'complete', getElementById: get, createElement: element },
  });
  await get('hv-pack-file').handlers.change({ target: { files: [{ size: 4000, text: async () => JSON.stringify(pack) }] } });
  assert.equal(calls.length, 0, 'loading a pack must not import it');
  await get('hv-pack-import').handlers.click();
  assert.equal(calls.length, 3);
  for (const [i, call] of calls.entries()) {
    assert.equal(call.url, '/api/skins/studio');
    assert.equal(call.options.method, 'POST');
    const payload = JSON.parse(call.options.body);
    assert.equal(payload.name, pack.skins[i].name);
    assert.equal(payload.idempotencyKey, `hv-pack:${pack.id}:v1:${i}`);
    assert.deepEqual(Object.keys(payload).sort(), ['description', 'idempotencyKey', 'name', 'skin', 'species']);
    core.validateDocument(core.createDocument(payload));
  }
});
