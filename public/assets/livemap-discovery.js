(() => {
  const { api, loadMe } = window.HDS;
  const get = id => document.getElementById(id);
  const status = get('discovery-status');
  let settings, writable = false, busy = false;
  const post = (path, body) => api('/api/discovery' + path, { method: 'POST', body: JSON.stringify(body) });
  function controls() {
    get('discovery-optin').disabled = busy || !writable;
    get('discovery-save').disabled = busy || !writable;
    get('discovery-delete').disabled = busy || !writable;
    get('discovery-refresh').disabled = busy;
  }
  async function refresh() {
    settings = await api('/api/discovery/settings');
    get('discovery-optin').checked = settings.enabled;
    const data = await api('/api/discovery/points');
    const layer = get('tracker-discoveries');
    layer.replaceChildren();
    for (const point of data.points) {
      const left = (point.y - data.bounds.minY) / (data.bounds.maxY - data.bounds.minY);
      const top = (point.x - data.bounds.minX) / (data.bounds.maxX - data.bounds.minX);
      if (![left, top].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) continue;
      const marker = document.createElement('span');
      marker.className = 'poi water'; marker.style.left = `${left * 100}%`; marker.style.top = `${top * 100}%`;
      const label = document.createElement('span'); label.className = 'poi-label'; label.textContent = point.name;
      marker.append(label); layer.append(marker);
    }
    status.textContent = `${data.points.length} of ${data.total} locations discovered. ${settings.enabled ? 'Discovery recording is on.' : 'Discovery recording is off.'}${writable ? '' : ' This preview is read-only.'}`;
  }
  async function action(operation) {
    if (busy) return;
    busy = true; controls();
    try { await operation(); await refresh(); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; controls(); }
  }
  get('discovery-mode').addEventListener('change', event => document.body.classList.toggle('discovery-mode', event.target.checked));
  get('discovery-save').addEventListener('click', () => {
    if (writable) action(() => post('/settings', { enabled: get('discovery-optin').checked, expectedRevision: settings.revision }));
  });
  get('discovery-delete').addEventListener('click', () => {
    if (writable && confirm('Clear all discovery progress and stop recording? This cannot be undone.')) action(() => post('/delete', { expectedRevision: settings.revision }));
  });
  get('discovery-refresh').addEventListener('click', () => action(async () => {}));
  (async () => {
    try {
      const capability = await api('/api/discovery/capabilities');
      if (!capability.enabled || !(await loadMe())?.user?.steam_id) return;
      writable = !capability.readOnly;
      get('discovery-controls').hidden = false;
      await refresh(); controls();
    } catch (error) { status.textContent = error.message; }
  })();
})();
