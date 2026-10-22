/* Hollow Valley Skin Studio workspace. All server writes require explicit actions. */
(function () {
  'use strict';
  const Core = window.HVSkinStudioCore;
  const HDS = window.HDS;
  if (!Core || !HDS) return;
  const $ = (id) => document.getElementById(id);
  const api = (path, options) => HDS.api(path, options);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const editor = new Core.Editor();
  const invalidInputs = new Map();
  let me = { loggedIn: false, user: null };
  let context = { readOnly: true, reason: 'Checking studio permissions…', capabilities: {} };
  let species = [];
  let presets = [];
  let shop = [];
  let shopSettings = {};
  let parked = [];
  let parkedFetching = false;
  let parkedLoaded = false;
  let collectionLoaded = false;
  let collectionError = null;
  let shopError = null;
  let busy = false;
  let draftCandidate = null;
  let draftTimer = null;
  let storageWarned = false;
  let wearState = null;
  let wearError = null;
  let wearTimer = null;
  let wearFetching = false;
  let wearPollingSince = 0;
  let importPreview = null;
  let createAttempt = null;
  let activeTab = 'editor';
  const operationKeys = new Map();
  const steamId = () => me.loggedIn && me.user?.steam_id ? String(me.user.steam_id) : null;
  const signedIn = () => Boolean(steamId());
  const requestKey = (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const canWrite = (capability = 'save') => Boolean(signedIn() && context.readOnly === false && context.capabilities?.[capability] === true && shopSettings.systemEnabled !== false);
  const canWear = () => canWrite('wear') && shopSettings.liveWearEnabled !== false;
  const displaySpecies = (value) => {
    if (Core.canonicalSpecies(value) === 'universal') return 'All species';
    return species.find((entry) => Core.canonicalSpecies(entry.id) === Core.canonicalSpecies(value))?.name || String(value || 'Unknown species');
  };
  const readonlyReason = () => context.reason || 'This preview protects the live skin collection. Saving, purchases and game actions are unavailable here.';

  function announce(message, kind = 'info') {
    const host = $('hv-studio-alert');
    if (!host) return;
    host.hidden = !message;
    host.dataset.kind = kind;
    host.textContent = message || '';
  }
  function guardWrite(capability = 'save') {
    if (!signedIn()) { announce('Sign in with Steam to use your saved collection and game actions.', 'warning'); return false; }
    if (context.readOnly !== false) { announce(readonlyReason(), 'warning'); return false; }
    if (!canWrite(capability)) { announce('This action is currently unavailable. Your saved skins have not changed.', 'warning'); return false; }
    return true;
  }
  function setValue(id, value, force = false) {
    const element = $(id);
    if (!element) return;
    const next = String(value ?? '');
    if ((force || document.activeElement !== element) && element.value !== next) element.value = next;
  }
  function setText(id, value) { if ($(id)) $(id).textContent = value; }
  function setDisabled(id, disabled, reason = '') {
    const element = $(id);
    if (!element) return;
    element.disabled = Boolean(disabled);
    if (reason) element.title = reason;
    else element.removeAttribute('title');
  }
  function bind(id, event, fn) { $(id)?.addEventListener(event, fn); }
  function button(label, action, id, { primary = false, disabled = false } = {}) {
    return `<button type="button" class="hv-button ${primary ? 'hv-button-primary' : 'hv-button-quiet'}" data-action="${action}" data-id="${escape(id)}" ${disabled ? 'disabled' : ''}>${escape(label)}</button>`;
  }
  function setBusy(value) {
    busy = value;
    renderEditor();
    renderCollection();
    renderShop();
    renderWear();
    renderImport();
  }
  function switchTab(name) {
    if (!['editor', 'collection', 'shop', 'import'].includes(name)) return;
    activeTab = name;
    document.querySelectorAll('[data-studio-tab]').forEach((tab) => {
      const active = tab.dataset.studioTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-studio-panel]').forEach((panel) => {
      const active = panel.dataset.studioPanel === name;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    if (name === 'editor') window.dispatchEvent(new Event('resize'));
  }
  function confirmLeave() {
    if (createAttempt) return window.confirm('An earlier save has not been confirmed and may already be in your collection. Leave this design and discard its retry recovery? Check your collection before creating it again.');
    if (!editor.dirty && !invalidInputs.size) return true;
    return window.confirm('Discard your unsaved changes and open another design? Your saved skins will stay unchanged.');
  }
  function buildColors() {
    const row = (field) => `<div class="hv-color-row" data-color-row="${field.key}">
      <div class="hv-color-name"><label for="hv-color-hex-${field.key}">${escape(field.label)}</label><small class="hv-color-note">${escape(field.note)}</small></div>
      <input id="hv-color-picker-${field.key}" class="hv-color-swatch" type="color" value="${field.hex}" aria-label="${escape(field.label)} colour picker">
      <input id="hv-color-hex-${field.key}" class="hv-color-hex" type="text" maxlength="7" value="${field.hex}" spellcheck="false" autocapitalize="characters" autocomplete="off" inputmode="text" aria-label="${escape(field.label)} hexadecimal colour" aria-describedby="hv-colour-help">
    </div>`;
    if ($('hv-editor-colors')) $('hv-editor-colors').innerHTML = `<div class="hv-color-group">${Core.COLORS.filter((f) => f.primary).map(row).join('')}</div><details class="hv-extra-colors"><summary>Teeth, mouth &amp; claws</summary><p class="hv-color-note">These native channels are preserved when importing a seven-colour code.</p>${Core.COLORS.filter((f) => !f.primary).map(row).join('')}</details><p id="hv-colour-help" class="hv-color-note">Use six hex digits. Colours you do not edit retain their exact saved values.</p>`;
    for (const field of Core.COLORS) {
      bind(`hv-color-picker-${field.key}`, 'input', (event) => {
        invalidInputs.delete(`hv-color-hex-${field.key}`);
        $( `hv-color-hex-${field.key}`)?.removeAttribute('aria-invalid');
        change((doc) => Core.setColor(doc, field.key, event.target.value), `color:${field.key}`);
      });
      bind(`hv-color-picker-${field.key}`, 'change', () => editor.finishGroup());
      bind(`hv-color-hex-${field.key}`, 'input', (event) => {
        try {
          const normalized = Core.normalizeHex(event.target.value);
          invalidInputs.delete(event.target.id);
          event.target.removeAttribute('aria-invalid');
          event.target.setCustomValidity('');
          change((doc) => Core.setColor(doc, field.key, normalized), `color:${field.key}`);
        } catch (error) {
          invalidInputs.set(event.target.id, error.message);
          event.target.setAttribute('aria-invalid', 'true');
          event.target.setCustomValidity(error.message);
          renderEditor();
        }
      });
      bind(`hv-color-hex-${field.key}`, 'change', (event) => {
        editor.finishGroup();
        if (!invalidInputs.has(event.target.id)) event.target.value = Core.colorToHex(editor.document.skin[field.key]);
      });
    }
  }
  function speciesOptions(selected, includeUniversal = true) {
    const options = species.map((entry) => ({ value: entry.id, name: entry.name || entry.id }));
    if (includeUniversal) options.unshift({ value: 'Universal', name: 'Universal · all species' });
    if (selected && !options.some((entry) => Core.canonicalSpecies(entry.value) === Core.canonicalSpecies(selected))) options.push({ value: selected, name: `${selected} · saved species` });
    return options.map((entry) => `<option value="${escape(Core.canonicalSpecies(entry.value) === Core.canonicalSpecies(selected) ? selected : entry.value)}">${escape(entry.name)}</option>`).join('');
  }
  function renderSpecies() {
    const doc = editor.document;
    if ($('hv-editor-species')) {
      $('hv-editor-species').innerHTML = speciesOptions(doc.species);
      $('hv-editor-species').value = doc.species;
    }
    if ($('hv-editor-preview-species')) {
      const chosen = Core.canonicalSpecies(doc.species) === 'universal' ? doc.previewSpecies : doc.species;
      $('hv-editor-preview-species').innerHTML = speciesOptions(chosen, false);
      $('hv-editor-preview-species').value = chosen;
    }
    for (const id of ['hv-collection-species', 'hv-shop-species']) {
      if (!$(id)) continue;
      const current = $(id).value;
      const savedSpecies = [...new Set(presets.map((preset) => String(preset.species || '')))].filter(Boolean);
      const extras = savedSpecies.filter((item) => Core.canonicalSpecies(item) !== 'universal' && !species.some((entry) => Core.canonicalSpecies(entry.id) === Core.canonicalSpecies(item)));
      $(id).innerHTML = '<option value="">All species</option><option value="Universal">Universal only</option>' + speciesOptions('', false) + extras.map((item) => `<option value="${escape(item)}">${escape(item)}</option>`).join('');
      $(id).value = current;
    }
  }
  function renderPreview() {
    const doc = editor.document;
    const previewSpecies = Core.canonicalSpecies(doc.species) === 'universal' ? doc.previewSpecies : doc.species;
    const detail = { name: doc.name.trim() || 'Untitled skin', species: previewSpecies || 'tyrannosaurus', sex: doc.sex, skin: Object.fromEntries(Core.COLOR_KEYS.map((key) => [key, Core.colorToHex(doc.skin[key])])) };
    window.__HV_STUDIO_PREVIEW = detail;
    document.dispatchEvent(new CustomEvent('hds:skin-preview-change', { detail }));
    setText('hv-current-name', detail.name);
    setText('hv-current-species', displaySpecies(previewSpecies));
    const swatches = Core.COLORS.filter((field) => field.primary).map((field) => `<span class="hv-palette-item" title="${escape(field.label)}"><span class="hv-palette-swatch" style="--swatch:${detail.skin[field.key]};background:${detail.skin[field.key]}" aria-label="${escape(field.label)} ${detail.skin[field.key]}"></span><code class="hv-palette-hex">${detail.skin[field.key]}</code></span>`).join('');
    if ($('hv-editor-palette')) $('hv-editor-palette').innerHTML = swatches;
  }
  function renderEditor(force = false) {
    const doc = editor.document;
    setValue('hv-editor-name', doc.name, force);
    setValue('hv-editor-description', doc.description, force);
    setValue('hv-editor-sex', doc.sex, force);
    const fieldMap = { 'hv-editor-pattern': 'patternIndex', 'hv-editor-theme': 'themeIndex', 'hv-editor-variation': 'skinVariation' };
    for (const [id, key] of Object.entries(fieldMap)) setValue(id, doc.skin[key], force);
    for (const field of Core.COLORS) {
      setValue(`hv-color-picker-${field.key}`, Core.colorToHex(doc.skin[field.key]), force);
      if (!invalidInputs.has(`hv-color-hex-${field.key}`) || force) setValue(`hv-color-hex-${field.key}`, Core.colorToHex(doc.skin[field.key]), force);
    }
    const mode = doc.mode === 'view' ? 'Collection preview' : doc.source?.exclusive && doc.source?.granted && !doc.permissions.creator ? 'Personal exclusive edit' : doc.presetId ? 'Editing saved skin' : doc.mode === 'import' ? 'Imported draft' : doc.mode === 'copy' ? 'New copy' : 'New design';
    setText('hv-editor-mode', mode);
    const saveStatus = invalidInputs.size ? 'Fix the highlighted values before saving' : busy ? 'Working…' : editor.dirty ? 'Unsaved changes' : doc.presetId ? 'Saved to your collection' : 'Ready to create';
    setText('hv-editor-status', signedIn() ? saveStatus : `${saveStatus} · Sign in with Steam to save.`);
    if ($('hv-editor-status')) $('hv-editor-status').dataset.dirty = String(editor.dirty);
    setText('hv-save-design', doc.presetId ? 'Save changes' : 'Save new skin');
    setText('hv-editor-cost', 'Creating and editing studio designs is free.');
    const reason = context.readOnly ? readonlyReason() : !signedIn() ? 'Sign in with Steam to save.' : doc.mode === 'view' ? 'This skin is available to preview and wear.' : '';
    setDisabled('hv-save-design', busy || !canWrite() || !doc.permissions.editable || invalidInputs.size > 0 || (Boolean(doc.presetId) && !editor.dirty), reason);
    setDisabled('hv-save-copy', busy || !canWrite() || !doc.presetId || !doc.permissions.copyable || invalidInputs.size > 0, doc.permissions.copyable ? reason : 'Exclusive and unlocked skins cannot be copied.');
    if ($('hv-save-copy')) $('hv-save-copy').hidden = !doc.presetId || !doc.permissions.copyable;
    setDisabled('hv-undo', busy || !editor.undoStack.length);
    setDisabled('hv-redo', busy || !editor.redoStack.length);
    setDisabled('hv-revert', busy || (!editor.dirty && !invalidInputs.size));
    setDisabled('hv-new-design', busy);
    for (const id of ['hv-editor-name', 'hv-editor-description', 'hv-editor-species', ...Object.keys(fieldMap), ...Core.COLORS.flatMap((field) => [`hv-color-picker-${field.key}`, `hv-color-hex-${field.key}`])]) setDisabled(id, busy || !doc.permissions.editable);
    setDisabled('hv-editor-preview-species', busy || Core.canonicalSpecies(doc.species) !== 'universal');
    setDisabled('hv-editor-sex', busy);
    setDisabled('hv-parked-slot', busy || context.readOnly !== false || !signedIn(), context.readOnly ? readonlyReason() : '');
    if ($('hv-editor-share')) {
      const share = me.user?.is_admin && !doc.source?.exclusive && !doc.source?.granted ? doc.source?.share_code : null;
      $('hv-editor-share').hidden = !share;
      $('hv-editor-share').textContent = share ? `Share code: ${share}` : '';
    }
    if ($('hv-preview-banner')) {
      $('hv-preview-banner').hidden = context.readOnly === false;
      $('hv-preview-banner').textContent = readonlyReason();
    }
    renderPreview();
  }
  function clearInvalid() {
    invalidInputs.clear();
    document.querySelectorAll('[aria-invalid="true"]').forEach((input) => { input.removeAttribute('aria-invalid'); input.setCustomValidity?.(''); });
  }
  function change(transform, group = null) {
    if (busy) return;
    try {
      if (editor.update(transform, group)) { renderEditor(); scheduleDraft(); }
    } catch (error) { announce(error.message, 'error'); }
  }
  function openDocument(doc, baseline) {
    clearInvalid();
    editor.open(doc, baseline);
    createAttempt = null;
    renderSpecies(); renderEditor(true);
    switchTab('editor');
    scheduleDraft();
  }
  function clearDraft() {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(Core.draftKey(steamId())); } catch {}
    draftCandidate = null;
    if ($('hv-draft-banner')) $('hv-draft-banner').hidden = true;
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    if (draftCandidate) return;
    draftTimer = setTimeout(() => {
      try {
        if (editor.dirty || createAttempt) localStorage.setItem(Core.draftKey(steamId()), Core.serializeDraft(editor, steamId(), new Date().toISOString(), createAttempt));
        else localStorage.removeItem(Core.draftKey(steamId()));
      } catch {
        if (!storageWarned) { announce('This browser could not save a local draft. Keep this tab open until you save your design.', 'warning'); storageWarned = true; }
      }
    }, 350);
  }
  function detectDraft() {
    try { draftCandidate = localStorage.getItem(Core.draftKey(steamId())); } catch { draftCandidate = null; }
    if ($('hv-draft-banner')) $('hv-draft-banner').hidden = !draftCandidate;
  }

  function card(preset, location) {
    const rights = Core.presetPermissions(preset, steamId());
    const owned = location === 'collection' || Boolean(preset.owned || preset.isPremium || rights.creator || preset.exclusive && preset.granted);
    const tags = [preset.exclusive ? 'Exclusive' : rights.creator ? 'Your design' : owned ? 'Unlocked' : `${Number(preset.price || 0).toLocaleString()} VC`];
    if (Core.canonicalSpecies(preset.species) === 'universal') tags.push('Universal');
    if (preset.grantCustomized) tags.push('Personal edit');
    const actions = [button(rights.editable && owned ? 'Open in studio' : 'Preview', 'open', preset.id, { disabled: busy })];
    if (owned && signedIn()) {
      actions.push(button('Wear live', 'wear', preset.id, { primary: true, disabled: busy || !canWear() }));
      actions.push(button('Apply to parked', 'parked', preset.id, { disabled: busy || !canWrite() || shopSettings.applyEnabled === false }));
    } else if (location === 'shop') actions.push(button(`Unlock · ${Number(preset.price || 0).toLocaleString()} VC`, 'buy', preset.id, { primary: true, disabled: busy || !canWrite('buy') }));
    const art = Core.COLORS.filter((field) => field.primary).map((field) => `<span style="background:${Core.colorToHex(preset.skin?.[field.key])}" title="${escape(field.label)} ${Core.colorToHex(preset.skin?.[field.key])}"></span>`).join('');
    return `<article class="hv-skin-card" data-preset-id="${escape(preset.id)}"><div class="hv-skin-art" aria-label="Saved colour palette">${art}</div><div class="hv-skin-card-body"><div class="hv-skin-card-meta"><span>${escape(displaySpecies(preset.species))}</span>${tags.map((tag) => `<span class="hv-tag">${escape(tag)}</span>`).join('')}</div><h3>${escape(preset.name || 'Untitled skin')}</h3><p>${escape(String(preset.description || '').replace(/^\[External Library:[^\]]+\]\s*/, '') || 'Saved Hollow Valley skin.')}</p><div class="hv-skin-actions">${actions.join('')}</div></div></article>`;
  }
  function renderCollection() {
    const grid = $('hv-collection-grid');
    if (!grid) return;
    if (!signedIn()) { grid.innerHTML = '<div class="hv-empty-state"><h3>Your collection is linked to Steam</h3><p>Sign in to load your existing designs, unlocked skins and exclusive grants.</p><a class="hv-button hv-button-primary" href="/auth/steam">Sign in with Steam</a></div>'; setText('hv-collection-count', ''); return; }
    if (collectionError) { grid.innerHTML = `<div class="hv-empty-state"><h3>Collection unavailable</h3><p>${escape(collectionError)}</p><p>Your saved skins have not been changed. Use Refresh to try again.</p></div>`; return; }
    if (!collectionLoaded) { grid.innerHTML = '<div class="hv-empty-state">Loading your existing skins…</div>'; return; }
    const filtered = Core.filterPresets(presets, { search: $('hv-collection-search')?.value, species: $('hv-collection-species')?.value, type: ({ owned: 'created', purchased: 'unlocked' }[$('hv-collection-type')?.value] || $('hv-collection-type')?.value), steamId: steamId() });
    setText('hv-collection-count', String(presets.length));
    if ($('hv-collection-count')) $('hv-collection-count').title = `${filtered.length} of ${presets.length} skins`;
    grid.innerHTML = filtered.length ? filtered.map((preset) => card(preset, 'collection')).join('') : `<div class="hv-empty-state"><h3>${presets.length ? 'No skins match these filters' : 'Your collection is ready'}</h3><p>${presets.length ? 'Try another name, species or type.' : 'Create a skin or unlock one from the shop to add it here.'}</p></div>`;
  }
  function renderShop() {
    const grid = $('hv-shop-grid');
    if (!grid) return;
    if (shopError) { grid.innerHTML = `<div class="hv-empty-state"><h3>Shop unavailable</h3><p>${escape(shopError)}</p></div>`; return; }
    const wanted = $('hv-shop-species')?.value;
    const filtered = shop.filter((preset) => !wanted || Core.canonicalSpecies(preset.species) === Core.canonicalSpecies(wanted) || Core.canonicalSpecies(preset.species) === 'universal' && Core.canonicalSpecies(wanted) !== 'universal');
    grid.innerHTML = filtered.length ? filtered.map((preset) => card(preset, 'shop')).join('') : '<div class="hv-empty-state"><h3>No published skins in this selection</h3><p>Try another species or check back for new designs.</p></div>';
  }
  async function loadCollection() {
    if (!signedIn()) { renderCollection(); return; }
    try {
      const result = await api('/api/skins/mine');
      if (!Array.isArray(result?.presets)) throw new Error('The collection response was incomplete. Your saved skins have not been removed.');
      presets = result.presets;
      collectionLoaded = true; collectionError = null;
      renderSpecies();
    } catch (error) { collectionError = error.message; }
    renderCollection();
  }
  async function loadShop() {
    try {
      const result = await api('/api/skins');
      if (!Array.isArray(result?.skins)) throw new Error('The shop response was incomplete. Refresh to try again.');
      shop = result.skins;
      shopSettings = result || {}; shopError = null;
    } catch (error) { shopError = error.message; }
    renderShop(); renderEditor();
  }
  async function loadParked() {
    if (!signedIn() || context.readOnly !== false || parkedFetching) return;
    parkedFetching = true;
    const select = $('hv-parked-slot');
    try {
      const result = await api('/api/mydinos');
      parked = Array.isArray(result) ? result : [];
      parkedLoaded = true;
      if (select) select.innerHTML = '<option value="">Choose a parked dinosaur</option>' + parked.map((dino) => {
        const slot = dino.slot || dino.name || '';
        return `<option value="${escape(slot)}">${escape(displaySpecies(dino.species || dino.speciesId || 'Unknown'))} · ${escape(slot)}</option>`;
      }).join('');
    } catch {
      parked = [];
      if (select) select.innerHTML = '<option value="">Parked dinosaurs unavailable; refresh to retry</option>';
    } finally { parkedFetching = false; }
  }
  function lookupPreset(id) { return presets.find((preset) => String(preset.id) === String(id)) || shop.find((preset) => String(preset.id) === String(id)); }
  async function onCardAction(event) {
    const target = event.target.closest('button[data-action]');
    if (!target || target.disabled || busy) return;
    const preset = lookupPreset(target.dataset.id);
    if (!preset) return announce('This skin is no longer listed. Refresh your collection.', 'warning');
    if (target.dataset.action === 'open') {
      if (!confirmLeave()) return;
      clearDraft();
      openDocument(Core.fromPreset(preset, steamId(), { previewSpecies: editor.document.previewSpecies, sex: editor.document.sex }));
      announce(Core.presetPermissions(preset, steamId()).editable ? (preset.exclusive && preset.granted && String(preset.owner_steam_id) !== steamId() ? 'Editing your personal exclusive version. Other players’ versions remain unchanged.' : 'Your saved skin is open. Changes are applied only when you choose Save changes.') : 'Previewing the original skin. Saved designs and ownership stay unchanged.', 'info');
      return;
    }
    if (target.dataset.action === 'wear') return wearPreset(preset);
    if (target.dataset.action === 'parked') return applyParked(preset);
    if (target.dataset.action === 'buy') return purchase(preset);
  }
  async function saveDesign(copy = false) {
    if (busy || !guardWrite()) return;
    if (invalidInputs.size) return announce('Correct the highlighted values before saving.', 'warning');
    const doc = editor.document;
    if (copy && (!doc.permissions.copyable || !doc.presetId)) return announce('This skin cannot be copied.', 'warning');
    let body;
    try { body = Core.validateDocument(doc); } catch (error) { return announce(error.message, 'warning'); }
    if (copy) body.name = `${body.name} copy`.slice(0, 60);
    const updating = Boolean(doc.presetId && !copy);
    if (updating && doc.permissions.creator && (doc.source?.published || doc.source?.exclusive) && !window.confirm('This updates the shared original. Players who use this original will receive the new values when they next apply it. Save changes to the original skin?')) return;
    if (!updating) {
      const signature = JSON.stringify(body);
      if (!createAttempt || createAttempt.signature !== signature) createAttempt = { signature, key: requestKey('studio-create'), copy };
      // Persist before the request: a lost response must not duplicate the skin after reload.
      try { localStorage.setItem(Core.draftKey(steamId()), Core.serializeDraft(editor, steamId(), new Date().toISOString(), createAttempt)); } catch {}
      body.idempotencyKey = createAttempt.key;
    }
    setBusy(true);
    try {
      const result = await api(updating ? `/api/skins/${encodeURIComponent(doc.presetId)}` : '/api/skins/studio', { method: updating ? 'PUT' : 'POST', body: JSON.stringify(body) });
      if (!result?.preset?.id) throw new Error('The server response did not include the saved skin. Refresh your collection before retrying.');
      const previousSource = copy ? null : doc.source;
      // New creations cannot inherit exclusive flags or identity from their source.
      editor.open(Core.fromPreset({ ...(previousSource || {}), ...result.preset }, steamId(), { previewSpecies: doc.previewSpecies, sex: doc.sex }));
      createAttempt = null; clearDraft();
      renderSpecies(); renderEditor(true);
      announce(updating ? `Saved changes to ${result.preset.name || doc.name}.` : `Saved ${result.preset.name || body.name} to your collection.`, 'success');
      await Promise.all([loadCollection(), loadShop()]);
    } catch (error) { announce(`Could not confirm the save: ${error.message} Your draft is still open.`, 'error'); scheduleDraft(); }
    finally { setBusy(false); }
  }
  async function purchase(preset) {
    if (!guardWrite('buy') || busy) return;
    const amount = Number(preset.price || 0);
    if (!window.confirm(`Unlock “${preset.name}” for ${amount.toLocaleString()} Valley Coin?`)) return;
    const op = `buy:${preset.id}`;
    if (!operationKeys.has(op)) operationKeys.set(op, requestKey('studio-buy'));
    setBusy(true);
    try {
      const result = await api(`/api/skins/${encodeURIComponent(preset.id)}/buy`, { method: 'POST', body: JSON.stringify({ idempotencyKey: operationKeys.get(op) }) });
      operationKeys.delete(op);
      announce(`Unlocked ${preset.name}.${Number.isFinite(Number(result.wallet?.balance)) ? ` Balance: ${Number(result.wallet.balance).toLocaleString()} VC.` : ''}`, 'success');
      await Promise.all([loadCollection(), loadShop()]);
    } catch (error) { announce(error.message, 'error'); }
    finally { setBusy(false); }
  }
  async function wearPreset(preset) {
    if (!guardWrite('wear') || busy) return;
    if (!canWear()) return announce('Wear Live is currently unavailable. Your saved skin is still in your collection.', 'warning');
    if (!window.confirm(`Send “${preset.name}” to your current live dinosaur? The game will verify species compatibility before applying it.`)) return;
    setBusy(true);
    try {
      const result = await api(`/api/skins/${encodeURIComponent(preset.id)}/wear`, { method: 'POST', body: '{}' });
      announce(result.confirmed ? 'The game bridge verified the skin values. Check the status card for reconnect persistence and confirm the appearance in game.' : result.message || 'Request queued. Waiting for game confirmation.', result.confirmed ? 'success' : 'info');
      wearPollingSince = Date.now();
      await loadWear();
    } catch (error) { announce(`The Wear Live request could not be confirmed: ${error.message} Check its status before sending another request.`, 'error'); await loadWear(); }
    finally { setBusy(false); }
  }
  async function applyParked(preset) {
    if (!guardWrite() || busy) return;
    const slot = $('hv-parked-slot')?.value;
    if (!slot) { switchTab('collection'); $('hv-parked-slot')?.focus(); return announce('Choose a parked dinosaur above your collection, then choose Apply to parked.', 'warning'); }
    const dinosaur = parked.find((entry) => String(entry.slot || entry.name || '') === slot);
    const speciesName = dinosaur?.species || dinosaur?.speciesId;
    if (!dinosaur || !speciesName) return announce('The selected parked dinosaur could not be verified. Refresh your collection before applying.', 'warning');
    if (!Core.speciesCompatible(preset.species, speciesName)) return announce(`This skin is for ${displaySpecies(preset.species)}, but the selected dinosaur is ${displaySpecies(speciesName)}.`, 'warning');
    if (!window.confirm(`Apply “${preset.name}” to your parked ${displaySpecies(speciesName)} in slot ${slot}?`)) return;
    setBusy(true);
    try {
      await api(`/api/skins/${encodeURIComponent(preset.id)}/apply`, { method: 'POST', body: JSON.stringify({ slot }) });
      announce('The skin was saved to the parked dinosaur. It will use those values when redeemed.', 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally { setBusy(false); }
  }

  function renderWear() {
    const card = $('hv-wear-card');
    if (card) card.hidden = !signedIn() || context.readOnly !== false || (!wearState?.latestJob && !wearState?.assignment && !wearError);
    const presentation = Core.wearPresentation(wearState, wearError);
    setText('hv-wear-title', presentation.title);
    const job = wearState?.latestJob;
    const name = job?.presetId ? lookupPreset(job.presetId)?.name : null;
    setText('hv-wear-detail', `${name ? `${name}. ` : ''}${presentation.detail}`);
    if (card) card.dataset.status = presentation.kind;
    if ($('hv-wear-retry')) $('hv-wear-retry').hidden = !presentation.retry;
    if ($('hv-wear-reset')) $('hv-wear-reset').hidden = !presentation.reset;
    setDisabled('hv-wear-retry', busy || !canWear());
    setDisabled('hv-wear-reset', busy || !canWrite('wear'));
    setDisabled('hv-wear-refresh', wearFetching);
  }
  function scheduleWearPoll() {
    clearTimeout(wearTimer);
    const presentation = Core.wearPresentation(wearState);
    if (!signedIn() || context.readOnly !== false || document.hidden || !presentation.pending) return;
    if (!wearPollingSince) wearPollingSince = Date.now();
    if (Date.now() - wearPollingSince > 120000) {
      if (!wearError) setText('hv-wear-detail', 'The game has not confirmed this request yet. Automatic checking has paused; use Refresh status when you are ready.');
      return;
    }
    wearTimer = setTimeout(loadWear, wearError ? 10000 : 4000);
  }
  async function loadWear() {
    if (!signedIn() || context.readOnly !== false || wearFetching) return;
    wearFetching = true; renderWear();
    try { wearState = await api('/api/skins/wear-state'); wearError = null; }
    catch (error) { wearError = error.message; }
    finally { wearFetching = false; renderWear(); scheduleWearPoll(); }
  }
  async function manageWear(action) {
    if (busy || !guardWrite('wear')) return;
    const state = Core.wearPresentation(wearState, wearError);
    if (action === 'retry' && !state.retry || action === 'reset' && !state.reset) return;
    if (action === 'reset' && !window.confirm('Reset this failed request? Your last verified skin assignment will stay unchanged.')) return;
    setBusy(true);
    try {
      const result = await api(`/api/skins/wear-${action}`, { method: 'POST', body: '{}' });
      announce(action === 'reset' ? 'The failed request was reset. Your last verified assignment was kept.' : result.confirmed ? 'The game bridge verified the retry.' : result.message || 'Retry queued. Waiting for game confirmation.', result.confirmed || action === 'reset' ? 'success' : 'info');
      wearPollingSince = Date.now(); await loadWear();
    } catch (error) { announce(error.message, 'error'); await loadWear(); }
    finally { setBusy(false); }
  }

  function renderImport() {
    setDisabled('hv-import-code', busy);
    const summary = $('hv-import-summary');
    if (summary && importPreview) {
      const result = importPreview.result;
      summary.textContent = importPreview.kind === 'hv' ? `${result.preset.name} · ${displaySpecies(result.preset.species)}. Import adds an allowed copy to your collection.` : `${result.sourceLabel || 'External skin'} · ${result.importedColorCount || 'Supported'} colour channels${result.speciesCode ? ` · source ${result.speciesCode}` : ''}. Compatibility stays ${displaySpecies(importPreview.species)}. ${(result.warnings || []).join(' ')}`;
    }
    setDisabled('hv-import-preview', busy || !String($('hv-import-code')?.value || '').trim());
    setDisabled('hv-import-load', busy || importPreview?.kind !== 'external');
    setDisabled('hv-import-claim', busy || importPreview?.kind !== 'hv' || !canWrite());
    if ($('hv-import-load')) $('hv-import-load').hidden = importPreview?.kind !== 'external';
    if ($('hv-import-claim')) $('hv-import-claim').hidden = importPreview?.kind !== 'hv';
  }
  async function previewImport() {
    if (busy) return;
    const raw = String($('hv-import-code')?.value || '').trim();
    if (!raw) return announce('Paste a Hollow Valley code, FNF code or supported JSON first.', 'warning');
    if (raw.length > 100000) return announce('This import is too large. Import a single skin at a time.', 'warning');
    if (!/^HV-[A-F\d]{5}-[A-F\d]{5}$/i.test(raw) && !signedIn()) return announce('Sign in with Steam to parse an external skin code.', 'warning');
    if (editor.document.source && !Core.presetPermissions(editor.document.source, steamId()).copyable) return announce('Start a new design before importing another palette. Exclusive and unlocked skins cannot be used as the source of a copy.', 'warning');
    setBusy(true); importPreview = null;
    try {
      if (/^HV-[A-F\d]{5}-[A-F\d]{5}$/i.test(raw)) {
        const result = await api(`/api/skins/share/${encodeURIComponent(raw)}`);
        if (!result?.preset || result.preset.exclusive || result.preset.granted) throw new Error('This skin is not available for shared import.');
        importPreview = { kind: 'hv', result, code: raw };
      } else {
        const result = await api('/api/skins/external/preview', { method: 'POST', body: JSON.stringify({ rawCode: raw, baseSkin: Core.clone(editor.document.skin) }) });
        importPreview = { kind: 'external', result, species: editor.document.species, previewSpecies: editor.document.previewSpecies };
      }
      announce('Import checked. Review the result, then choose what to do next.', 'info');
    } catch (error) { setText('hv-import-summary', error.message); announce(error.message, 'error'); }
    finally { setBusy(false); }
  }
  function loadExternalDraft() {
    if (busy || importPreview?.kind !== 'external' || !confirmLeave()) return;
    const imported = importPreview;
    clearDraft();
    const draft = Core.fromImport(imported.result, { name: 'Imported skin', species: imported.species, previewSpecies: imported.previewSpecies });
    // Mark the imported design unsaved and eligible for local recovery.
    openDocument(draft, Core.createDocument());
    announce('Imported into a new draft. Existing saved skins are unchanged. Name and review it before saving.', 'success');
  }
  async function claimImport() {
    if (busy || importPreview?.kind !== 'hv' || !guardWrite()) return;
    const key = `import:${importPreview.code}`;
    if (!operationKeys.has(key)) operationKeys.set(key, requestKey('studio-import'));
    setBusy(true);
    try {
      const result = await api('/api/skins/import', { method: 'POST', body: JSON.stringify({ shareCode: importPreview.code, idempotencyKey: operationKeys.get(key) }) });
      operationKeys.delete(key);
      await loadCollection();
      switchTab('collection');
      announce(`Imported ${result.preset?.name || 'skin'} into your collection.`, 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally { setBusy(false); }
  }
  function wire() {
    document.querySelectorAll('[data-studio-tab]').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.studioTab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = [...document.querySelectorAll('[data-studio-tab]')];
        const index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); switchTab(tabs[next].dataset.studioTab); tabs[next].focus();
      });
    });
    for (const [id, field] of Object.entries({ 'hv-editor-name': 'name', 'hv-editor-description': 'description' })) {
      bind(id, 'input', (event) => change((doc) => Core.setField(doc, field, event.target.value), field));
      bind(id, 'change', () => editor.finishGroup());
    }
    bind('hv-editor-species', 'change', (event) => { change((doc) => Core.setField(doc, 'species', event.target.value)); renderSpecies(); });
    bind('hv-editor-preview-species', 'change', (event) => change((doc) => Core.setField(doc, 'previewSpecies', event.target.value)));
    bind('hv-editor-sex', 'change', (event) => change((doc) => Core.setField(doc, 'sex', event.target.value)));
    for (const [id, key] of Object.entries({ 'hv-editor-pattern': 'patternIndex', 'hv-editor-theme': 'themeIndex', 'hv-editor-variation': 'skinVariation' })) {
      bind(id, 'input', (event) => {
        try {
          const next = Core.setIndex(editor.document, key, event.target.value);
          invalidInputs.delete(id); event.target.removeAttribute('aria-invalid'); event.target.setCustomValidity('');
          change(() => next, key);
        } catch (error) { invalidInputs.set(id, error.message); event.target.setAttribute('aria-invalid', 'true'); event.target.setCustomValidity(error.message); renderEditor(); }
      });
      bind(id, 'change', () => editor.finishGroup());
    }
    bind('hv-new-design', 'click', () => { if (busy || !confirmLeave()) return; clearDraft(); openDocument(Core.createDocument()); announce('New design ready. Your saved collection is unchanged.'); });
    bind('hv-save-design', 'click', () => saveDesign(false));
    bind('hv-save-copy', 'click', () => saveDesign(true));
    bind('hv-undo', 'click', () => { if (busy) return; clearInvalid(); editor.undo(); renderSpecies(); renderEditor(true); scheduleDraft(); });
    bind('hv-redo', 'click', () => { if (busy) return; clearInvalid(); editor.redo(); renderSpecies(); renderEditor(true); scheduleDraft(); });
    bind('hv-revert', 'click', () => { if (busy || !confirmLeave()) return; clearInvalid(); editor.revert(); renderSpecies(); renderEditor(true); clearDraft(); });
    bind('hv-draft-restore', 'click', () => {
      if (!draftCandidate || busy) return;
      if (!confirmLeave()) return;
      try {
        const restored = Core.restoreDraft(draftCandidate, steamId(), presets);
        draftCandidate = null;
        if ($('hv-draft-banner')) $('hv-draft-banner').hidden = true;
        openDocument(restored.document, restored.baseline);
        createAttempt = restored.createAttempt;
        scheduleDraft();
        announce(restored.remoteChanged ? 'Draft restored. This skin also changed on the server after your draft began; review carefully before saving over it.' : 'Draft restored for this account. Review your changes before saving.', restored.remoteChanged ? 'warning' : 'success');
      } catch (error) { announce(`Could not restore this draft: ${error.message}`, 'error'); }
    });
    bind('hv-draft-discard', 'click', () => { clearDraft(); scheduleDraft(); announce('The local draft was discarded. Saved skins were not changed.'); });
    for (const id of ['hv-collection-search', 'hv-collection-species', 'hv-collection-type']) bind(id, id.endsWith('search') ? 'input' : 'change', renderCollection);
    bind('hv-shop-species', 'change', renderShop);
    bind('hv-collection-refresh', 'click', async () => { await Promise.all([loadCollection(), loadParked(), loadWear()]); });
    bind('hv-shop-refresh', 'click', loadShop);
    bind('hv-parked-slot', 'focus', () => { if (!parkedLoaded) loadParked(); });
    bind('hv-collection-grid', 'click', onCardAction);
    bind('hv-shop-grid', 'click', onCardAction);
    bind('hv-wear-refresh', 'click', () => { wearPollingSince = Date.now(); loadWear(); });
    bind('hv-wear-retry', 'click', () => manageWear('retry'));
    bind('hv-wear-reset', 'click', () => manageWear('reset'));
    bind('hv-import-code', 'input', () => { importPreview = null; setText('hv-import-summary', 'Preview the code before importing.'); renderImport(); });
    bind('hv-import-preview', 'click', previewImport);
    bind('hv-import-load', 'click', loadExternalDraft);
    bind('hv-import-claim', 'click', claimImport);
    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || activeTab !== 'editor' || busy || event.target.closest('input, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault(); clearInvalid();
      if (key === 'y' || event.shiftKey) editor.redo(); else editor.undo();
      renderSpecies(); renderEditor(true); scheduleDraft();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(wearTimer); else scheduleWearPoll(); });
    window.addEventListener('beforeunload', (event) => { if (editor.dirty || invalidInputs.size || createAttempt) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('pagehide', () => { clearTimeout(wearTimer); if ((editor.dirty || createAttempt) && !draftCandidate) { try { localStorage.setItem(Core.draftKey(steamId()), Core.serializeDraft(editor, steamId(), new Date().toISOString(), createAttempt)); } catch {} } });
  }
  async function init() {
    buildColors(); wire(); switchTab('editor'); renderSpecies(); renderEditor(); renderImport();
    const results = await Promise.allSettled([HDS.loadMe(), api('/api/species'), api('/api/skins/studio-context')]);
    if (results[0].status === 'fulfilled') me = results[0].value || me;
    if (results[1].status === 'fulfilled') {
      const entries = Array.isArray(results[1].value) ? results[1].value : [];
      const combined = [...entries, ...Object.values(window.HV_SKIN_MODELS || {}).map((model) => ({ id: model.key, name: model.displayName }))];
      const seen = new Set();
      species = combined.filter((entry) => { const key = Core.canonicalSpecies(entry?.id); if (!key || entry.releasedInEvrima === false || key === 'universal' || seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    } else {
      species = Object.values(window.HV_SKIN_MODELS || {}).map((model) => ({ id: model.key, name: model.displayName }));
      announce('The species list is unavailable. Preview species from the local model catalogue are still available.', 'warning');
    }
    if (results[2].status === 'fulfilled' && typeof results[2].value?.readOnly === 'boolean') context = results[2].value;
    else context = { readOnly: true, reason: 'Studio permissions could not be checked. You can design locally; saving and game actions stay disabled until this page reconnects.', capabilities: {} };
    renderSpecies(); renderEditor(true); renderCollection(); detectDraft();
    if ($('hv-admin-tools')) $('hv-admin-tools').hidden = !Boolean(me.user?.is_admin);
    await Promise.allSettled([loadCollection(), loadShop(), loadWear()]);
    renderEditor(); renderImport();
    document.dispatchEvent(new CustomEvent('hv:skin-studio-ready', { detail: { readOnly: context.readOnly, signedIn: signedIn() } }));
  }
  init().catch((error) => announce(`The studio could not finish loading: ${error.message}. Your saved skins are unchanged.`, 'error'));
})();
