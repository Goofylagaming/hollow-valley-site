const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/assets/skin-studio-core');

const OWNER = '76561198000000101';
const PLAYER = '76561198000000102';
function fixture(overrides = {}) {
  const skin = Core.defaultSkin();
  skin.body = { r: 0.123456789, g: 0.7654321, b: 0.00391731, a: 0.3726198, nativeAnnotation: 'retain' };
  skin.nativeFutureField = { data: ['keep', 5.271] };
  skin.patternIndex = 37;
  skin.themeIndex = 19;
  skin.skinVariation = 53;
  return { id: 'existing-skin-001', owner_steam_id: OWNER, species: 'Tyrannosaurus', name: 'Original skin', description: '[External Library:Fangs & Ferns] Original provenance.', skin, ...overrides };
}

test('renaming a legacy skin retains exact native floats, alpha, indices and provenance', () => {
  const source = fixture();
  const document = Core.setField(Core.fromPreset(source, OWNER), 'name', 'Renamed skin');
  const payload = Core.validateDocument(document);
  assert.deepEqual(payload.skin, source.skin);
  assert.equal(payload.description, source.description);
  assert.equal(payload.species, 'Tyrannosaurus');
  assert.equal(document.presetId, source.id);
  assert.equal(document.mode, 'edit');
});

test('changing one hex colour preserves every untouched channel and the edited alpha', () => {
  const source = fixture();
  const document = Core.setColor(Core.fromPreset(source, OWNER), 'body', '#10aF00');
  const expected = Core.clone(source.skin);
  expected.body = { ...source.skin.body, r: 16 / 255, g: 175 / 255, b: 0 };
  assert.deepEqual(Core.validateDocument(document).skin, expected);
  assert.equal(source.skin.body.r, 0.123456789);
  assert.equal(Core.colorToHex(document.skin.body), '#10AF00');
});

test('strict HEX conversion preserves pure black and rejects incomplete/malformed values', () => {
  assert.deepEqual(Core.hexToColor('000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.equal(Core.normalizeHex(' a1b2c3 '), '#A1B2C3');
  for (const invalid of ['#FFF', '#12345', '#1234567', 'GG1234', '', null, '#12 3456', 'rgb(1,2,3)']) assert.throws(() => Core.normalizeHex(invalid));
});

test('external import always creates a fresh draft after editing an existing skin', () => {
  const editor = new Core.Editor(Core.fromPreset(fixture(), OWNER));
  const parsed = { sourceLabel: 'Fangs & Ferns', skin: Core.defaultSkin() };
  editor.open(Core.fromImport(parsed, { name: 'Imported palette', species: 'Universal' }), Core.createDocument());
  assert.equal(editor.document.presetId, null);
  assert.equal(editor.document.mode, 'import');
  assert.equal(editor.document.source, null);
  assert.equal(editor.document.species, 'Universal');
  assert.equal(editor.dirty, true);
});

test('a successful save stays attached to its existing ID for subsequent saves', () => {
  const source = fixture();
  const editor = new Core.Editor(Core.fromPreset(source, OWNER));
  editor.update((doc) => Core.setField(doc, 'name', 'First edit'));
  editor.markSaved({ ...source, ...Core.payload(editor.document) }, OWNER);
  assert.equal(editor.dirty, false);
  editor.update((doc) => Core.setField(doc, 'name', 'Second edit'));
  assert.equal(editor.document.presetId, source.id);
  assert.equal(editor.document.mode, 'edit');
  assert.equal(editor.dirty, true);
});

test('new documents and explicit copies do not retain an old update target', () => {
  const source = fixture();
  assert.equal(Core.createDocument().presetId, null);
  const copied = Core.fromPreset(source, OWNER, { copy: true });
  assert.equal(copied.presetId, null);
  assert.equal(copied.mode, 'copy');
  assert.deepEqual(copied.skin, source.skin);
  assert.equal(source.name, 'Original skin');
});

test('exclusive grantee can edit their personal version but cannot copy it', () => {
  const source = fixture({ exclusive: true, granted: true });
  const document = Core.fromPreset(source, PLAYER);
  assert.equal(document.mode, 'edit');
  assert.equal(document.presetId, source.id);
  assert.equal(document.permissions.editable, true);
  assert.equal(document.permissions.copyable, false);
  assert.throws(() => Core.fromPreset(source, PLAYER, { copy: true }), /cannot be copied/);
  assert.throws(() => Core.fromPreset(source, OWNER, { copy: true }), /cannot be copied/);
});

test('purchased skin cannot be edited or turned into a creator copy', () => {
  const source = fixture({ owned: true });
  const document = Core.fromPreset(source, PLAYER);
  assert.equal(document.mode, 'view');
  assert.equal(document.permissions.editable, false);
  assert.throws(() => Core.setColor(document, 'body', '#FFFFFF'), /cannot be edited/);
  assert.throws(() => Core.fromPreset(source, PLAYER, { copy: true }), /cannot be copied/);
  assert.equal(Core.setField(document, 'sex', 'female').sex, 'female');
});

test('undo and redo restore full precision rather than a HEX reconstruction', () => {
  const original = Core.fromPreset(fixture(), OWNER);
  const editor = new Core.Editor(original);
  editor.update((doc) => Core.setColor(doc, 'body', '#000000'));
  const edited = Core.clone(editor.document);
  assert.equal(editor.dirty, true);
  editor.undo();
  assert.deepEqual(editor.document, original);
  assert.equal(editor.dirty, false);
  editor.redo();
  assert.deepEqual(editor.document, edited);
  editor.revert();
  assert.deepEqual(editor.document, original);
});

test('typing coalesces within a field and a new edit invalidates redo', () => {
  const editor = new Core.Editor();
  editor.update((doc) => Core.setField(doc, 'name', 'A'), 'name');
  editor.update((doc) => Core.setField(doc, 'name', 'Ash'), 'name');
  assert.equal(editor.undoStack.length, 1);
  editor.finishGroup();
  editor.update((doc) => Core.setField(doc, 'description', 'Moss'));
  editor.undo();
  editor.update((doc) => Core.setField(doc, 'description', 'Stone'));
  assert.equal(editor.redoStack.length, 0);
});

test('preview species and sex do not alter saved compatibility or dirty state', () => {
  const editor = new Core.Editor(Core.fromPreset(fixture({ species: 'Universal' }), OWNER));
  editor.update((doc) => Core.setField(doc, 'previewSpecies', 'stegosaurus'));
  editor.update((doc) => Core.setField(doc, 'sex', 'female'));
  assert.equal(editor.document.species, 'Universal');
  assert.equal(editor.dirty, false);
});

test('indices reject NaN, fractions, empty values and out-of-range values', () => {
  const document = Core.fromPreset(fixture(), OWNER);
  for (const value of ['', '  ', NaN, Infinity, -1, 65536, 1.5]) assert.throws(() => Core.setIndex(document, 'patternIndex', value));
  assert.equal(Core.setIndex(document, 'patternIndex', '65535').skin.patternIndex, 65535);
});

test('parked compatibility is case-insensitive and Universal is explicit', () => {
  assert.equal(Core.speciesCompatible('Tyrannosaurus', 'tyrannosaurus'), true);
  assert.equal(Core.speciesCompatible('universal', 'Triceratops'), true);
  assert.equal(Core.speciesCompatible('Tyrannosaurus', 'Triceratops'), false);
  assert.equal(Core.speciesCompatible('', 'Triceratops'), false);
});

test('collection filters distinguish creator, exclusive, unlocked and universal skins', () => {
  const own = fixture();
  const exclusive = fixture({ id: 'exclusive', owner_steam_id: PLAYER, exclusive: true, granted: true });
  const unlocked = fixture({ id: 'unlocked', owner_steam_id: PLAYER, name: 'Ocean skin', species: 'Universal' });
  const rows = [own, exclusive, unlocked];
  assert.deepEqual(Core.filterPresets(rows, { type: 'created', steamId: OWNER }).map((p) => p.id), [own.id]);
  assert.deepEqual(Core.filterPresets(rows, { type: 'unlocked', steamId: OWNER }).map((p) => p.id), ['unlocked']);
  assert.deepEqual(Core.filterPresets(rows, { type: 'exclusive' }).map((p) => p.id), ['exclusive']);
  assert.deepEqual(Core.filterPresets(rows, { search: 'ocean', species: 'universal' }).map((p) => p.id), ['unlocked']);
});

test('local drafts are scoped to the Steam identity and require explicit restoration', () => {
  const source = fixture();
  const editor = new Core.Editor(Core.fromPreset(source, OWNER));
  editor.update((doc) => Core.setField(doc, 'name', 'Unfinished edit'));
  const raw = Core.serializeDraft(editor, OWNER, '2026-10-21T00:00:00Z');
  assert.notEqual(Core.draftKey(OWNER), Core.draftKey(PLAYER));
  assert.notEqual(Core.draftKey(OWNER), Core.draftKey(null));
  assert.throws(() => Core.restoreDraft(raw, PLAYER, [source]), /different account/);
  const restored = Core.restoreDraft(raw, OWNER, [source]);
  assert.equal(restored.document.name, 'Unfinished edit');
  assert.deepEqual(restored.document.skin, source.skin);
  assert.equal(restored.remoteChanged, false);
});

test('draft restore recalculates access instead of trusting local saved permissions', () => {
  const source = fixture({ exclusive: true, granted: true });
  const editor = new Core.Editor(Core.fromPreset(source, PLAYER));
  editor.update((doc) => Core.setField(doc, 'name', 'My exclusive version'));
  const raw = Core.serializeDraft(editor, PLAYER);
  assert.throws(() => Core.restoreDraft(raw, PLAYER, []), /no longer available/);
  assert.throws(() => Core.restoreDraft(raw, PLAYER, [{ ...source, granted: false }]), /can no longer edit/);
});

test('draft restore detects remote changes and keeps the current server skin as baseline', () => {
  const source = fixture();
  const editor = new Core.Editor(Core.fromPreset(source, OWNER));
  editor.update((doc) => Core.setField(doc, 'name', 'Local edit'));
  const remote = { ...source, name: 'Changed elsewhere' };
  const restored = Core.restoreDraft(Core.serializeDraft(editor, OWNER), OWNER, [remote]);
  assert.equal(restored.remoteChanged, true);
  assert.equal(restored.document.name, 'Local edit');
  assert.equal(restored.baseline.name, 'Changed elsewhere');
});

test('partially named drafts can be restored without inventing a saved name', () => {
  const editor = new Core.Editor(Core.fromPreset(fixture(), OWNER));
  editor.update((doc) => Core.setField(doc, 'name', ''));
  assert.equal(Core.restoreDraft(Core.serializeDraft(editor, OWNER), OWNER, [fixture()]).document.name, '');
  const newEditor = new Core.Editor();
  newEditor.update((doc) => Core.setColor(doc, 'body', '#000000'));
  const restored = Core.restoreDraft(Core.serializeDraft(newEditor, null), null);
  assert.equal(restored.document.name, '');
  assert.equal(Core.colorToHex(restored.document.skin.body), '#000000');
});

test('queued and awaiting confirmation never imply a verified application', () => {
  for (const status of ['queued', 'awaiting_confirmation', 'dispatched']) {
    const display = Core.wearPresentation({ latestJob: { status } });
    assert.equal(display.kind, 'pending');
    assert.equal(display.pending, true);
    assert.equal(display.retry, false);
    assert.match(display.detail, /not been verified/);
  }
});

test('status transport failure never fabricates a failed game request', () => {
  const result = Core.wearPresentation({ latestJob: { id: 'job', status: 'queued' } }, 'Network offline');
  assert.equal(result.kind, 'unavailable');
  assert.equal(result.retry, false);
  assert.equal(result.reset, false);
  assert.equal(result.title, 'Status unavailable');
});

test('verified request without active assignment does not imply reconnect persistence', () => {
  const previous = Core.wearPresentation({ latestJob: { status: 'verified' }, assignment: null });
  assert.equal(previous.title, 'Previous application verified');
  assert.match(previous.detail, /no reconnect restore is armed/);
  const armed = Core.wearPresentation({ latestJob: { status: 'verified' }, assignment: { id: 'life' } });
  assert.match(armed.detail, /armed reconnect restore/);
  assert.match(armed.detail, /confirm its appearance/);
});

test('uncertain create request key survives account-scoped draft recovery', () => {
  const editor = new Core.Editor();
  editor.update((doc) => Core.setField(doc, 'name', 'Awaiting save'));
  const attempt = { signature: JSON.stringify(Core.validateDocument(editor.document)), key: 'studio-create:kept-request-001', copy: false };
  const restored = Core.restoreDraft(Core.serializeDraft(editor, OWNER, null, attempt), OWNER);
  assert.deepEqual(restored.createAttempt, attempt);
});

test('an uncertain copy request is recovered only for the unchanged eligible source', () => {
  const source = fixture();
  const editor = new Core.Editor(Core.fromPreset(source, OWNER));
  const body = Core.validateDocument(editor.document);
  body.name += ' copy';
  const attempt = { signature: JSON.stringify(body), key: 'studio-create:kept-copy-001', copy: true };
  const raw = Core.serializeDraft(editor, OWNER, null, attempt);
  assert.deepEqual(Core.restoreDraft(raw, OWNER, [source]).createAttempt, attempt);
  const altered = JSON.parse(raw);
  altered.document.name = 'Changed after uncertainty';
  assert.equal(Core.restoreDraft(JSON.stringify(altered), OWNER, [source]).createAttempt, null);
});
