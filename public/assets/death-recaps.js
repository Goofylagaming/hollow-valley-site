(() => {
  const { api } = window.HDS;
  const get = id => document.getElementById(id);
  const status = get('recap-status');
  let generation = 0, controller = null, binding = null, busy = false, expires = 0;
  function clear(message) {
    generation++; controller?.abort(); controller = null; binding = null; busy = false; expires = 0;
    get('recap-list').replaceChildren(); get('recap-refresh').disabled = false;
    if (message) status.textContent = message;
  }
  async function identity(epoch) {
    const me = await api('/api/me', { signal: controller?.signal });
    if (epoch !== generation) throw Error('View changed');
    if (!me.loggedIn || !Number.isSafeInteger(me.user?.id) || !/^\d{17}$/.test(me.user?.steam_id || '')) throw Object.assign(Error('Sign in with a linked Steam account to view your recaps.'), { status: 401 });
    return me.user.id + ':' + me.user.steam_id;
  }
  function node(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }
  async function refresh() {
    if (busy) return;
    clear(); const epoch = generation; controller = new AbortController(); busy = true;
    get('recap-refresh').disabled = true;
    status.textContent = 'Checking your recorded events…';
    try {
      const capability = await api('/api/death-recaps/capabilities', { signal: controller.signal });
      if (epoch !== generation) return;
      if (!capability.enabled) { get('recap-account').hidden = true; status.textContent = 'Death recaps are not open yet.'; return; }
      binding = await identity(epoch);
      get('recap-signin').hidden = true; get('recap-account').hidden = false;
      const anchor = performance.now();
      const data = await api('/api/death-recaps', { signal: controller.signal, headers: { 'X-Death-Recap-Actor': binding } });
      if (epoch !== generation) return;
      if (data.actorBinding !== binding || await identity(epoch) !== binding) throw Object.assign(Error('Your account changed. Refresh before viewing death recaps.'), { status: 403 });
      if (epoch !== generation) return;
      if (performance.now() - anchor >= 120000) throw Error('The recap response expired. Refresh to try again.');
      const list = document.createDocumentFragment();
      for (const recap of data.recaps) {
        const article = document.createElement('article');
        article.append(node('h2', new Date(recap.occurredAt).toLocaleString()));
        const details = document.createElement('dl');
        const fields = [
          ['Attacker', recap.attackerName || 'Unknown'],
          ['Your species', recap.victimSpecies || 'Unknown'],
          ['Attacker species', recap.attackerSpecies || 'Unknown'],
          ['Growth', recap.growth == null ? 'Unknown' : String(recap.growth)],
          ['Location', recap.location || 'Unknown'],
          ['Recorded combat location', recap.eventLocation ? `Lat ${(recap.eventLocation.x / 1000).toFixed(1)}, Long ${(recap.eventLocation.y / 1000).toFixed(1)}` : 'Unknown'],
          ['Dinosaur age', recap.dinosaurAge == null ? 'Unknown' : String(recap.dinosaurAge)],
          ['Survival time', recap.survivalSeconds == null ? 'Unknown' : `${recap.survivalSeconds} seconds`]
        ];
        for (const [label, value] of fields) details.append(node('dt', label), node('dd', value));
        article.append(details);
        article.append(node('h3','Recent recorded combat'));
        article.append(node('p','Up to 10 recorded events involving your account in the preceding 10 minutes.'));
        const timeline = document.createElement('ul');
        for (const event of recap.recentCombat || []) timeline.append(node('li',`${event.type === 'kill' ? 'Kill' : 'Death'} recorded · ${new Date(event.occurredAt).toLocaleString()}`));
        if (!timeline.childElementCount) timeline.append(node('li','No other matching combat records.'));
        article.append(timeline); list.append(article);
      }
      if (!data.recaps.length) list.append(node('p', 'No eligible death records are available yet.'));
      get('recap-list').replaceChildren(list); expires = anchor + 120000;
      status.textContent = 'Showing your recorded events. Unknown values were absent from the event evidence.';
    } catch (error) {
      if (epoch !== generation) return;
      clear(error.message);
      if (error.status === 401) { get('recap-signin').hidden = false; get('recap-account').hidden = true; }
    } finally { if (epoch === generation) { busy = false; get('recap-refresh').disabled = false; } }
  }
  get('recap-refresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear('Private death recaps cleared. Refresh when you return.'); });
  window.addEventListener('focus', () => { if (binding || busy) clear('Refresh death recaps for your current account.'); });
  const expiryTimer = setInterval(() => { if (expires && performance.now() >= expires) clear('This private recap view expired. Refresh to view your records.'); }, 1000);
  const identityTimer = setInterval(async () => {
    if (!binding || busy || document.hidden) return;
    const epoch = generation, expected = binding;
    try { if (await identity(epoch) !== expected && epoch === generation) clear('Your account changed. Refresh death recaps.'); }
    catch { if (epoch === generation) clear('Your account could not be verified. Refresh death recaps.'); }
  }, 30000);
  window.addEventListener('pagehide', () => { clearInterval(expiryTimer); clearInterval(identityTimer); clear(); });
  void refresh();
})();
