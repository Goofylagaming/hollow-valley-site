/* Explicit, read-only player investigation. Private content stays in page memory. */
(() => {
  'use strict';
  const {api} = window.HDS, $ = id => document.getElementById(id);
  let actor = null, locked = false, epoch = 0, generation = 0, pending = null;
  const node = (tag,text) => { const value = document.createElement(tag); value.textContent = text; return value; };
  const time = value => new Date(value).toLocaleString('en-AU', {timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'}) + ' AEST';
  function clear() {
    generation++; pending?.abort(); pending = null;
    $('incident-player-results').replaceChildren();
  }
  function lock(message) {
    locked = true; epoch++; clear();
    $('incident-records').replaceChildren(); $('incident-search').value = ''; $('incident-player-id').value = ''; $('incident-player-time').value = '';
    $('incident-content').hidden = true; $('incident-guard').hidden = false; $('incident-guard').textContent = message;
    $('incident-player-load').disabled = true;
  }
  async function check(expected) {
    if (locked) throw Error('Reload incident history.');
    let me;
    try { me = await api('/api/me', {cache:'no-store'}); }
    catch { lock('Admin access could not be verified. Reload this page.'); throw Error('Unverified access'); }
    if (locked) throw Error('Access changed');
    if (!me?.loggedIn || !me.user?.is_admin || !Number.isSafeInteger(me.user.id) || !/^\d{17}$/.test(me.user.steam_id || '')) {
      lock('Current linked admin access is required. Reload this page.'); throw Error('Admin access required');
    }
    const binding = me.user.id + ':' + me.user.steam_id;
    if ((actor && actor !== binding) || (expected && expected !== binding)) {
      lock('The admin account changed. Reload this page.'); throw Error('Account changed');
    }
    actor = binding; return {binding,epoch};
  }
  const valid = ticket => !locked && ticket?.binding === actor && ticket.epoch === epoch;
  function render(result, query) {
    if (result.version !== 1 || result.query?.steamId !== query.steamId || result.query?.occurredAt !== query.occurredAt || result.complete !== false || result.associationOnly !== true || !Array.isArray(result.events) || result.events.length > 200 || !Array.isArray(result.partialSources)) throw Error('Invalid investigation response');
    const panel = $('incident-player-results'); panel.replaceChildren();
    panel.append(node('h3','Player incident context'), node('p','Player '+query.steamId+' · '+time(result.windowStart)+' — '+time(result.windowEnd)),
      node('p','Time and player matches are context, not proof. This is a bounded recent-history search, not a complete record. No report or moderation decision was changed.'));
    if (result.partialSources.length) panel.append(node('p','Unavailable sources: '+result.partialSources.join(', ')+'.'));
    if (result.hasMoreUnloaded) panel.append(node('p','Results or source history are limited; additional matching records may be missing.'));
    panel.append(node('p','Operator audits and requests search only their newest 200 and 100 entries. Chat searches at most 500 retained messages. Combat and chat each return at most 50 matches; the combined view shows at most 200.'));
    if (!result.events.length) panel.append(node('p','No matching retained records were returned. This does not establish that nothing happened.'));
    const list = node('ol',''); list.className = 'hv-incident-context-events';
    for (const event of result.events) {
      const row = node('li','');
      row.append(node('strong',time(event.at)+' · '+event.source),node('p',event.category+' · '+event.action+' · '+event.status));
      if (event.source === 'chat') { row.append(node('p',event.text),node('small','Channel: '+event.channel+(event.redacted?' · Some text masked.':''))); }
      else if (event.source === 'combat') row.append(node('p','Selected player: '+event.playerRole+'. Other player identity and location are withheld.'));
      else { if (event.actorName || event.actorSteamId) row.append(node('p','Operator: '+(event.actorName || event.actorSteamId))); row.append(node('small','Reference: '+(event.reference || event.id))); }
      list.append(row);
    }
    panel.append(list);
  }
  async function investigate(event) {
    event.preventDefault(); clear(); const current = generation, controller = new AbortController(); pending = controller;
    const button = $('incident-player-load'); button.disabled = true;
    const date = new Date($('incident-player-time').value);
    const query = {steamId:$('incident-player-id').value.trim(),occurredAt:Number.isFinite(date.getTime())?date.toISOString():''};
    $('incident-player-results').append(node('p','Loading private player context…'));
    let ticket;
    try {
      ticket = await check(actor);
      if (current !== generation || controller.signal.aborted) return;
      const result = await api('/api/admin-incidents/player-context?'+new URLSearchParams(query), {cache:'no-store',headers:{'X-Incident-Reviewer':ticket.binding},signal:controller.signal});
      await check(ticket.binding);
      if (current !== generation || controller.signal.aborted || !valid(ticket)) return;
      if (result.reviewerBinding !== ticket.binding) throw Error('Account changed');
      render(result,query);
    } catch (error) {
      if (locked || current !== generation || controller.signal.aborted) return;
      try { await check(ticket?.binding || actor); } catch { return; }
      if (current === generation && valid(ticket)) $('incident-player-results').replaceChildren(node('p',error.status === 400 ? 'Check the player ID and approximate incident time. Supported times are within the last 90 days.' : error.status === 503 ? 'Player incident context is currently disabled.' : 'Player incident context could not be loaded. Retry explicitly when the sources are available.'));
    } finally { if (current === generation) {pending = null; button.disabled = locked;} }
  }
  async function initialize() {
    try {
      const ticket = await check();
      const caps = await api('/api/admin-incidents/player-context-capabilities',{cache:'no-store'}); await check(ticket.binding);
      if (!valid(ticket)) return;
      if (caps.reviewerBinding !== ticket.binding) { lock('The admin account changed. Reload this page.'); return; }
      $('incident-player-form').hidden = caps.enabled !== true;
      $('incident-player-disabled').hidden = caps.enabled === true;
      $('incident-player-disabled').textContent = 'Player incident context is not enabled.';
    } catch { if (!locked) $('incident-player-disabled').textContent = 'Player context availability could not be verified.'; }
  }
  $('incident-player-form').addEventListener('submit',investigate);
  $('incident-player-hide').addEventListener('click',() => {clear();$('incident-player-load').disabled = locked;});
  async function focus() {
    if (!actor || locked) return;
    epoch++; $('incident-content').hidden = true; clear(); $('incident-player-load').disabled = false; $('incident-records').replaceChildren();
    $('incident-feedback').textContent = 'Search records again to reload private history.';
    try { const ticket = await check(actor); if (valid(ticket) && !document.hidden) $('incident-content').hidden = false; } catch {}
  }
  document.addEventListener('visibilitychange',() => {if (document.hidden) {epoch++;clear();$('incident-content').hidden=true;$('incident-records').replaceChildren();} else focus();});
  window.addEventListener('focus',focus);
  setInterval(() => {if (actor && !locked && !document.hidden) check(actor).catch(()=>{});},15000);
  window.HVIncidentContext = {check,valid,lock};
  initialize();
})();
