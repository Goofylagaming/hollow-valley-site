(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';
  const consoleRoot = document.getElementById('admin-console');
  const anchor = document.querySelector('.backup-panel') || document.querySelector('.server-health-panel') || document.querySelector('.rcon-panel');
  if (!consoleRoot || !anchor) return;

  const panel = document.createElement('article');
  panel.className = 'automation-panel admin-restore-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><small>DINOSTORAGE</small><h3>Admin restore JSON</h3></div>
      <span class="panel-pill" id="admin-restore-health">Checking</span>
    </div>
    <div class="admin-restore-grid">
      <form id="admin-restore-form" class="admin-restore-form" autocomplete="off">
        <label for="admin-restore-input">RESTORE JSON</label>
        <textarea id="admin-restore-input" rows="18" spellcheck="false" placeholder='Paste a DinoStorage/admin restore JSON object here…' required></textarea>
        <label class="admin-restore-toggle">
          <input id="admin-restore-full-nutrients" type="checkbox">
          <span><b>Full Carb / Protein / Lipid</b><small>Adds "fullNutrients": true and fills the three normal diet nutrients during restore.</small></span>
        </label>
        <button class="small-button" type="submit">Generate validated JSON</button>
        <div class="automation-notice" id="admin-restore-status" hidden></div>
      </form>
      <div class="admin-restore-output">
        <div class="admin-restore-output-head">
          <div><small>VALIDATED OUTPUT</small><b id="admin-restore-output-label">No JSON generated yet</b></div>
          <button class="small-button subtle-button" id="admin-restore-copy" type="button" disabled>Copy JSON</button>
        </div>
        <pre id="admin-restore-json">Paste a restore payload on the left. Generating JSON does not upload a file or restore a dinosaur.</pre>
        <div class="admin-restore-upload-box">
          <small>OPTIONAL SLOT UPLOAD</small>
          <p id="admin-restore-upload-help">Checking admin restore upload safety…</p>
          <div class="admin-restore-target-grid">
            <label>STEAM ID<input id="admin-restore-steam" type="text" inputmode="numeric" maxlength="17" placeholder="17-digit Steam ID"></label>
            <label>SLOT<input id="admin-restore-slot" type="text" maxlength="80" placeholder="admin_restore_trike"></label>
          </div>
          <button class="small-button" id="admin-restore-upload" type="button" disabled>Upload to DinoStorage slot</button>
          <small>No automatic redeem is performed. Existing slots are never overwritten.</small>
        </div>
      </div>
    </div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const input = document.getElementById('admin-restore-input');
  const toggle = document.getElementById('admin-restore-full-nutrients');
  const output = document.getElementById('admin-restore-json');
  const outputLabel = document.getElementById('admin-restore-output-label');
  const status = document.getElementById('admin-restore-status');
  const copyButton = document.getElementById('admin-restore-copy');
  const uploadButton = document.getElementById('admin-restore-upload');
  const steamInput = document.getElementById('admin-restore-steam');
  const slotInput = document.getElementById('admin-restore-slot');
  const uploadHelp = document.getElementById('admin-restore-upload-help');
  const health = document.getElementById('admin-restore-health');
  let uploadState = { writeEnabled: false, ftpConfigured: false };

  async function adminFetch(url, options = {}) {
    const adminToken = token();
    if (!adminToken) throw new Error('Operator token required');
    return fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${adminToken}`,
        ...(options.headers || {}),
      },
    });
  }

  function syncUploadButton() {
    uploadButton.disabled = !output.dataset.generated || !uploadState.writeEnabled || !uploadState.ftpConfigured;
  }

  function renderUploadState(state = {}) {
    uploadState = state;
    if (!state.writeEnabled) {
      health.textContent = 'Uploads locked';
      uploadHelp.textContent = 'JSON building is available. FTP slot uploads are locked by ADMIN_RESTORE_WRITE_ENABLED=false.';
    } else if (!state.ftpConfigured) {
      health.textContent = 'FTP setup needed';
      uploadHelp.textContent = state.ftpError || 'Direct slot upload is unavailable on the BinaryLane HTTP-pull architecture.';
    } else {
      health.textContent = 'Upload enabled';
      uploadHelp.textContent = 'Controlled upload is enabled. The selected slot must not already exist.';
    }
    syncUploadButton();
  }

  async function refreshState() {
    if (!token() || consoleRoot.hidden) return;
    try {
      const response = await adminFetch('/api/admin/dinostorage/admin-restore');
      if (!response.ok) throw new Error(`Admin restore status failed (${response.status})`);
      const payload = await response.json();
      renderUploadState(payload.adminRestore || {});
    } catch (error) {
      health.textContent = 'Unavailable';
      uploadHelp.textContent = error.message;
      uploadState = { writeEnabled: false, ftpConfigured: false };
      syncUploadButton();
    }
  }

  function syncVisibility() {
    panel.hidden = !token() || consoleRoot.hidden;
    if (!panel.hidden) refreshState();
  }

  document.getElementById('admin-restore-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = 'Validating restore JSON…';
    copyButton.disabled = true;
    uploadButton.disabled = true;

    try {
      const response = await adminFetch('/api/admin/dinostorage/admin-restore-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restore: input.value,
          fullNutrients: toggle.checked,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Restore JSON validation failed (${response.status})`);

      output.textContent = payload.restore.json;
      output.dataset.generated = payload.restore.json;
      outputLabel.textContent = payload.restore.fullNutrients ? 'Validated · full nutrients' : 'Validated · stored nutrients';
      if (!slotInput.value && payload.restore.state?.slot) slotInput.value = payload.restore.state.slot;
      copyButton.disabled = false;
      syncUploadButton();
      status.textContent = payload.restore.fullNutrients
        ? 'Validated. Carb, Protein and Lipid will be filled to full on restore.'
        : 'Validated. Existing nutrient values will be restored normally.';
    } catch (error) {
      output.dataset.generated = '';
      outputLabel.textContent = 'Validation failed';
      status.classList.add('error');
      status.textContent = error.message;
      syncUploadButton();
    }
  });

  copyButton.addEventListener('click', async () => {
    const value = output.dataset.generated || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      status.hidden = false;
      status.classList.remove('error');
      status.textContent = 'Validated restore JSON copied.';
    } catch {
      status.hidden = false;
      status.classList.add('error');
      status.textContent = 'Copy failed. Select the JSON output manually.';
    }
  });

  uploadButton.addEventListener('click', async () => {
    const generated = output.dataset.generated || '';
    if (!generated) return;

    uploadButton.disabled = true;
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = 'Uploading validated JSON to the DinoStorage slot…';
    try {
      const response = await adminFetch('/api/admin/dinostorage/admin-restore/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steamId: steamInput.value,
          slot: slotInput.value,
          restore: generated,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Admin restore upload failed (${response.status})`);
      status.textContent = `Uploaded ${payload.upload.fileName}. No redeem command was sent.`;
      await refreshState();
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message;
    } finally {
      syncUploadButton();
    }
  });

  const observer = new MutationObserver(syncVisibility);
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  syncVisibility();
  setInterval(refreshState, 60_000);
})();
