/* Hollow Valley Studio: lossless editor state, independent of the browser and database. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVSkinStudioCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLORS = Object.freeze([
    { key: 'maleDisplay', label: 'Male display', hex: '#A6732B', note: 'Display and dominant pattern', primary: true },
    { key: 'markings', label: 'Markings', hex: '#232713', note: 'Pattern and markings', primary: true },
    { key: 'body', label: 'Body', hex: '#6F7652', note: 'Main body colour', primary: true },
    { key: 'flank', label: 'Flank', hex: '#59613D', note: 'Sides and flanks', primary: true },
    { key: 'underbelly', label: 'Underbelly', hex: '#B7AE8D', note: 'Belly and throat', primary: true },
    { key: 'detail1', label: 'Detail', hex: '#9C7B46', note: 'Crest and accents', primary: true },
    { key: 'eyes', label: 'Eyes', hex: '#B7FF35', note: 'Eye colour', primary: true },
    { key: 'teeth', label: 'Teeth', hex: '#DED6B8', note: 'Extended native channel', primary: false },
    { key: 'mouth', label: 'Mouth', hex: '#6D2E34', note: 'Extended native channel', primary: false },
    { key: 'claws', label: 'Claws', hex: '#28251E', note: 'Extended native channel', primary: false },
  ].map(Object.freeze));
  const COLOR_KEYS = Object.freeze(COLORS.map((field) => field.key));
  const INDEX_KEYS = Object.freeze(['patternIndex', 'themeIndex', 'skinVariation']);
  const DRAFT_VERSION = 1;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function normalizeHex(value) {
    const hex = String(value ?? '').trim();
    if (!/^#?[a-f\d]{6}$/i.test(hex)) throw new Error('Enter six hexadecimal digits, for example #6F7652.');
    return `#${hex.replace(/^#/, '').toUpperCase()}`;
  }
  function hexToColor(value, original = {}) {
    const hex = normalizeHex(value).slice(1);
    return {
      ...clone(original),
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: Number.isFinite(original?.a) ? original.a : 1,
    };
  }
  function colorToHex(value) {
    const part = (channel) => {
      const n = Number(value?.[channel]);
      return Math.round(Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)) * 255).toString(16).padStart(2, '0');
    };
    return `#${part('r')}${part('g')}${part('b')}`.toUpperCase();
  }
  function defaultSkin() {
    return { ...Object.fromEntries(COLORS.map((field) => [field.key, hexToColor(field.hex)])), patternIndex: 0, themeIndex: 0, skinVariation: 0 };
  }
  function canonicalSpecies(value) { return String(value || '').trim().toLowerCase(); }
  function speciesCompatible(presetSpecies, dinosaurSpecies) {
    const a = canonicalSpecies(presetSpecies);
    const b = canonicalSpecies(dinosaurSpecies);
    return a === 'universal' || Boolean(a && b && a === b);
  }
  function createDocument(values = {}) {
    return {
      presetId: null, mode: 'new', name: '', description: '', species: 'Universal',
      previewSpecies: 'tyrannosaurus', sex: 'male', skin: defaultSkin(),
      source: null, permissions: { editable: true, copyable: true },
      ...clone(values),
    };
  }
  function presetPermissions(preset, steamId) {
    const creator = Boolean(steamId && String(preset?.owner_steam_id) === String(steamId));
    return {
      creator,
      editable: creator || Boolean(preset?.exclusive && preset?.granted),
      copyable: creator && !preset?.exclusive && !preset?.granted,
    };
  }
  function fromPreset(preset, steamId, { copy = false, previewSpecies = 'tyrannosaurus', sex = 'male' } = {}) {
    if (!preset?.id || !preset.skin || typeof preset.skin !== 'object' || Array.isArray(preset.skin)) throw new Error('This skin has no editable colour data. Refresh your collection and try again.');
    const permissions = presetPermissions(preset, steamId);
    if (copy && !permissions.copyable) throw new Error('This skin cannot be copied. Exclusive and unlocked skins keep their existing ownership.');
    return createDocument({
      presetId: copy ? null : String(preset.id),
      mode: copy ? 'copy' : permissions.editable ? 'edit' : 'view',
      name: copy ? `${preset.name || 'Untitled skin'} copy`.slice(0, 60) : String(preset.name || ''),
      description: String(preset.description || ''), species: String(preset.species || 'Universal'),
      skin: clone(preset.skin), source: clone(preset),
      previewSpecies: canonicalSpecies(preset.species) === 'universal' ? previewSpecies : String(preset.species),
      sex,
      permissions: copy ? { creator: true, editable: true, copyable: true } : permissions,
    });
  }
  function fromImport(parsed, values = {}) {
    if (!parsed?.skin || typeof parsed.skin !== 'object' || Array.isArray(parsed.skin)) throw new Error('The import did not contain a skin palette.');
    return createDocument({
      ...clone(values), presetId: null, mode: 'import', skin: clone(parsed.skin), source: null,
      permissions: { creator: true, editable: true, copyable: true },
      description: values.description ?? `Imported from ${parsed.sourceLabel || 'external code'}.`,
    });
  }
  function requireEditable(document) {
    if (!document?.permissions?.editable) throw new Error('This unlocked skin can be previewed and worn, but its original design cannot be edited.');
  }
  function setField(document, field, value) {
    if (!['name', 'description', 'species', 'previewSpecies', 'sex'].includes(field)) throw new Error('Unknown design setting.');
    if (!['previewSpecies', 'sex'].includes(field)) requireEditable(document);
    const output = clone(document);
    if (field === 'sex') output.sex = value === 'female' ? 'female' : 'male';
    else output[field] = String(value ?? '');
    return output;
  }
  function setColor(document, key, value) {
    requireEditable(document);
    if (!COLOR_KEYS.includes(key)) throw new Error('Unknown skin colour zone.');
    const output = clone(document);
    output.skin[key] = hexToColor(value, output.skin[key] || {});
    return output;
  }
  function setIndex(document, key, value) {
    requireEditable(document);
    const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);
    if (!INDEX_KEYS.includes(key) || !Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Native values must be whole numbers from 0 to 65535.');
    const output = clone(document);
    output.skin[key] = n;
    return output;
  }
  function payload(document) {
    return { species: document.species, name: document.name, description: document.description, skin: clone(document.skin) };
  }
  function validateDocument(document) {
    requireEditable(document);
    if (String(document.name || '').trim().length < 2 || String(document.name || '').trim().length > 60) throw new Error('Give your skin a name between 2 and 60 characters.');
    if (String(document.description || '').length > 240) throw new Error('Keep the description within 240 characters.');
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(document.species || '').trim())) throw new Error('Choose a valid species compatibility.');
    for (const key of COLOR_KEYS) {
      for (const channel of ['r', 'g', 'b', 'a']) {
        const n = document.skin?.[key]?.[channel];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${COLORS.find((x) => x.key === key).label} has an invalid ${channel.toUpperCase()} channel. Load the original skin again before saving.`);
      }
    }
    for (const key of INDEX_KEYS) {
      const n = document.skin?.[key];
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Native values must be whole numbers from 0 to 65535.');
    }
    return payload(document);
  }
  function filterPresets(presets, { search = '', species = '', type = '', steamId = '' } = {}) {
    const query = String(search).trim().toLowerCase();
    return (Array.isArray(presets) ? presets : []).filter((preset) => {
      if (query && ![preset.name, preset.description, preset.species].some((v) => String(v || '').toLowerCase().includes(query))) return false;
      if (species && canonicalSpecies(preset.species) !== canonicalSpecies(species)) return false;
      if (type === 'exclusive' && !preset.exclusive) return false;
      if (type === 'universal' && canonicalSpecies(preset.species) !== 'universal') return false;
      if (type === 'created' && String(preset.owner_steam_id) !== String(steamId)) return false;
      if (type === 'unlocked' && (preset.exclusive || String(preset.owner_steam_id) === String(steamId))) return false;
      return true;
    });
  }
  function draftKey(steamId) {
    return `hv:skin-studio:v${DRAFT_VERSION}:draft:${/^\d{17}$/.test(String(steamId || '')) ? steamId : 'guest'}`;
  }
  function serializeDraft(editor, steamId, updatedAt, createAttempt = null) {
    return JSON.stringify({ version: DRAFT_VERSION, steamId: steamId || null, updatedAt: updatedAt || null, document: clone(editor.document), baseline: clone(editor.baseline), createAttempt: clone(createAttempt) });
  }
  function restoreCreateAttempt(attempt, document) {
    if (!attempt || !/^[A-Za-z0-9:_-]{8,160}$/.test(String(attempt.key || ''))) return null;
    if (attempt.copy ? !document.presetId || !document.permissions.copyable : Boolean(document.presetId)) return null;
    const body = payload(document);
    if (attempt.copy) body.name = `${body.name} copy`.slice(0, 60);
    if (attempt.signature !== JSON.stringify(body)) return null;
    return { key: attempt.key, signature: attempt.signature, copy: Boolean(attempt.copy) };
  }
  function restoreDraft(raw, steamId, presets = []) {
    if (typeof raw !== 'string' || raw.length > 500000) throw new Error('The saved draft is invalid.');
    const data = JSON.parse(raw);
    if (data.version !== DRAFT_VERSION || (data.steamId || null) !== (steamId || null)) throw new Error('That draft belongs to a different account.');
    const doc = data.document;
    if (!doc || !doc.skin || typeof doc.skin !== 'object' || Array.isArray(doc.skin)) throw new Error('The saved draft has no valid palette.');
    // Never trust persisted permissions; rederive them from the current collection.
    if (doc.presetId) {
      const current = presets.find((preset) => String(preset.id) === String(doc.presetId));
      if (!current) throw new Error('The original skin is no longer available to this account. Refresh your collection before restoring.');
      const verified = fromPreset(current, steamId, { previewSpecies: doc.previewSpecies, sex: doc.sex });
      if (!verified.permissions.editable) throw new Error('This account can no longer edit the original skin.');
      const restored = { ...verified, ...payload(doc), previewSpecies: doc.previewSpecies || verified.previewSpecies, sex: doc.sex === 'female' ? 'female' : 'male' };
      validateDocument({ ...restored, name: String(restored.name || '').trim().length >= 2 ? restored.name : 'Draft skin' });
      // Current server data is the baseline, so a changed remote design is never silently treated as saved.
      return { document: restored, baseline: verified, remoteChanged: data.baseline ? !same(payload(data.baseline), payload(verified)) : false, createAttempt: restoreCreateAttempt(data.createAttempt, restored) };
    }
    if (doc.source?.exclusive || doc.source?.granted) throw new Error('An exclusive skin cannot be restored as a copy.');
    const restored = createDocument({ ...payload(doc), mode: ['new', 'copy', 'import'].includes(doc.mode) ? doc.mode : 'new', previewSpecies: doc.previewSpecies || 'tyrannosaurus', sex: doc.sex === 'female' ? 'female' : 'male' });
    // Empty names are valid while drafting; validate colours independently using a temporary name.
    validateDocument({ ...restored, name: restored.name.trim().length >= 2 ? restored.name : 'Draft skin' });
    return { document: restored, baseline: createDocument(), remoteChanged: false, createAttempt: restoreCreateAttempt(data.createAttempt, restored) };
  }
  function wearPresentation(state, transportError = null) {
    if (transportError) return { kind: 'unavailable', title: 'Status unavailable', detail: `The latest game status could not be checked. ${transportError}`, pending: false, retry: false, reset: false };
    const job = state?.latestJob;
    if (!job && state?.assignment) return { kind: 'verified', title: 'Reconnect restore is armed', detail: 'A verified skin assignment is active for this dinosaur life. Check the dinosaur in game to confirm its appearance.', pending: false, retry: false, reset: false };
    if (!job) return { kind: 'idle', title: 'No Wear Live request', detail: 'Choose a saved skin to send it to your live dinosaur.', pending: false, retry: false, reset: false };
    const pending = ['queued', 'awaiting_confirmation', 'pending', 'dispatched'].includes(job.status);
    if (pending) return { kind: 'pending', title: job.status === 'queued' ? 'Queued for the game' : 'Waiting for game confirmation', detail: 'The request has been accepted. Application and reconnect persistence have not been verified yet.', pending: true, retry: false, reset: false };
    if (job.status === 'verified') return { kind: 'verified', title: state.assignment ? 'Verified by the game' : 'Previous application verified', detail: state.assignment ? 'The game bridge verified the saved values and armed reconnect restore for this dinosaur life. Check your dinosaur in game to confirm its appearance.' : 'That request was verified, but no reconnect restore is armed now. The dinosaur life or its saved identity may have changed.', pending: false, retry: false, reset: false };
    if (job.status === 'failed') return { kind: 'failed', title: 'Game application failed', detail: job.error || 'The game could not complete this request.', pending: false, retry: true, reset: Boolean(job.id) };
    return { kind: 'unknown', title: String(job.status || 'Pending'), detail: job.error || 'Refresh to check the latest game response.', pending: false, retry: false, reset: false };
  }

  class Editor {
    constructor(document = createDocument()) { this.open(document); }
    open(document, baseline = document) {
      this.document = clone(document); this.baseline = clone(baseline); this.undoStack = []; this.redoStack = []; this.group = null;
      return this.document;
    }
    update(transform, group = null) {
      const next = transform(clone(this.document));
      if (same(next, this.document)) return false;
      if (!group || this.group !== group) {
        this.undoStack.push(clone(this.document));
        if (this.undoStack.length > 60) this.undoStack.shift();
      }
      this.document = clone(next); this.redoStack = []; this.group = group;
      return true;
    }
    finishGroup() { this.group = null; }
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(clone(this.document)); this.document = this.undoStack.pop(); this.group = null; return true;
    }
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(clone(this.document)); this.document = this.redoStack.pop(); this.group = null; return true;
    }
    revert() { return this.open(this.baseline); }
    get dirty() { return !same(payload(this.document), payload(this.baseline)); }
    markSaved(preset, steamId) {
      const doc = fromPreset({ ...this.document.source, ...clone(preset) }, steamId, { previewSpecies: this.document.previewSpecies, sex: this.document.sex });
      return this.open(doc);
    }
  }

  return Object.freeze({ COLORS, COLOR_KEYS, INDEX_KEYS, DRAFT_VERSION, clone, normalizeHex, hexToColor, colorToHex, defaultSkin, canonicalSpecies, speciesCompatible, createDocument, presetPermissions, fromPreset, fromImport, setField, setColor, setIndex, payload, validateDocument, filterPresets, draftKey, serializeDraft, restoreDraft, wearPresentation, Editor });
});
