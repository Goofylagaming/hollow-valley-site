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
      <span class="panel-pill">Builder only</span>
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
          <div><small>VALIDATED OUTPUT</small><b>No JSON generated yet</b></div>
          <button class="small-button subtle-button" id="admin-restore-copy" type="button" disabled>Copy JSON</button>
        </div>
        <pre id="admin-restore-json">Paste a restore payload on the left. This tool only generates JSON; it does not upload a file or restore a dinosaur.</pre>
      </div>
    </div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const input = document.getElementById('admin-restore-input');
  const toggle = document.getElementById('admin-restore-full-nutrients');
  const output = document.getElementById('admin-restore-json');
  const status = document.getElementById('admin-restore-status');
  const copyButton = document.getElementById('admin-restore-copy');

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

  function syncVisibility() {
    panel.hidden = !token() || consoleRoot.hidden;
  }

  document.getElementById('admin-restore-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = 'Validating restore JSON…';
    copyButton.disabled = true;

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
      copyButton.disabled = false;
      status.textContent = payload.restore.fullNutrients
        ? 'Validated. Carb, Protein and Lipid will be filled to full on restore.'
        : 'Validated. Existing nutrient values will be restored normally.';
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message;
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

  const observer = new MutationObserver(syncVisibility);
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  syncVisibility();
})();
