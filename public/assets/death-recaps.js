(() => {
  const { api, loadMe } = window.HDS;
  const get = id => document.getElementById(id);
  const status = get('recap-status');
  function node(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }
  async function refresh() {
    get('recap-refresh').disabled = true;
    try {
      const data = await api('/api/death-recaps');
      const list = get('recap-list');
      list.replaceChildren();
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
          ['Dinosaur age', recap.dinosaurAge == null ? 'Unknown' : String(recap.dinosaurAge)],
          ['Survival time', recap.survivalSeconds == null ? 'Unknown' : `${recap.survivalSeconds} seconds`]
        ];
        for (const [label, value] of fields) details.append(node('dt', label), node('dd', value));
        article.append(details); list.append(article);
      }
      if (!data.recaps.length) list.append(node('p', 'No eligible death records are available yet.'));
      status.textContent = 'Showing your recorded events. Unknown values were absent from the event evidence.';
    } catch (error) {
      get('recap-list').replaceChildren();
      status.textContent = error.message;
    } finally { get('recap-refresh').disabled = false; }
  }
  get('recap-refresh').addEventListener('click', refresh);
  (async () => {
    try {
      const capability = await api('/api/death-recaps/capabilities');
      if (!capability.enabled) { status.textContent = 'Death recaps are not open yet.'; return; }
      if (!(await loadMe())?.user?.steam_id) { get('recap-signin').hidden = false; status.textContent = 'Sign in to continue.'; return; }
      get('recap-account').hidden = false;
      await refresh();
    } catch (error) { status.textContent = error.message; }
  })();
})();
