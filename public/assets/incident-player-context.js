/* Explicit, read-only player investigation. Private content stays in page memory. */
(() => {
  'use strict';
  const {api} = window.HDS, $ = id => document.getElementById(id);
  let actor = null, locked = false, epoch = 0, generation = 0, pending = null;
  let reportState = null, reportGeneration = 0, reportPending = null;
  const fragment = new URLSearchParams(location.hash.slice(1)), linkedReport = fragment.get('report');
  const validReportLink = linkedReport && fragment.getAll('report').length === 1 && [...fragment.keys()].every(key => key === 'report') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linkedReport);
  const node = (tag,text) => { const value = document.createElement(tag); value.textContent = text; return value; };
  const time = value => new Date(value).toLocaleString('en-AU', {timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'}) + ' AEST';
  function clear() {
    generation++; pending?.abort(); pending = null;
    $('incident-player-results').replaceChildren();
    $('incident-player-load').disabled = locked;
    $('incident-report-load').disabled = locked || !reportState?.canInvestigate;
  }
  function clearReport(message = 'Reload saved report details before investigating.') {
    reportGeneration++; reportPending?.abort(); reportPending = null; reportState = null;
    $('incident-report-details').replaceChildren(); $('incident-report-participant').replaceChildren();
    $('incident-report-form').hidden = true; $('incident-report-load').disabled = true;
    $('incident-report-status').textContent = message;
  }
  function lock(message) {
    locked = true; epoch++; clear(); clearReport();
    $('incident-records').replaceChildren(); $('incident-search').value = ''; $('incident-player-id').value = ''; $('incident-player-time').value = '';
    $('incident-content').hidden = true; $('incident-guard').hidden = false; $('incident-guard').textContent = message;
    $('incident-player-load').disabled = true;
    $('incident-report-reload').disabled = true;
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
    if (result.disabledSources?.length) panel.append(node('p','Disabled sources: '+result.disabledSources.join(', ')+'.'));
    if (result.hasMoreUnloaded) panel.append(node('p','Results or source history are limited; additional matching records may be missing.'));
    panel.append(node('p',result.operationMode==='retained-window' ? 'Operator audits and requests search retained rows in this player/time window, returning up to 50 timestamp markers each. Associations use current saved identity fields; prior metadata and intermediate status changes may be missing. Markers do not verify execution in the game.' : result.operationMode==='history-disabled' ? 'Retained operation history was disabled during this read. Its records are withheld.' : 'Operator audits and requests search only their newest 200 and 100 entries.'));
    panel.append(node('p','Chat searches at most 500 retained messages. Combat and chat each return at most 50 matches; the combined view shows at most 200.'));
    panel.append(node('p','The optional official marketplace source returns up to 50 stored order timestamps. A current order update is not a complete status history, and a fulfillment timestamp does not verify delivery in the game.'));
    panel.append(node('p','The optional peer marketplace source returns up to 50 stored listing timestamps. Buyer matches use only the listing’s current saved buyer; older reservations may be missing. Sale timestamps do not verify game delivery.'));
    if (!result.events.length) panel.append(node('p','No matching retained records were returned. This does not establish that nothing happened.'));
    const list = node('ol',''); list.className = 'hv-incident-context-events';
    for (const event of result.events) {
      const row = node('li','');
      row.append(node('strong',time(event.at)+' · '+event.source),node('p',event.category+' · '+event.action+' · '+event.status));
      if (event.source === 'chat') { row.append(node('p',event.text),node('small','Channel: '+event.channel+(event.redacted?' · Some text masked.':''))); }
      else if (event.source === 'combat') row.append(node('p','Selected player: '+event.playerRole+'. Other player identity and location are withheld.'));
      else if (event.source === 'peer-marketplace') row.append(node('p','Selected player: '+event.participantRole+'. Other trader identity is withheld.'),node('small','Listing reference: '+event.reference));
      else if (event.associations === 'current-stored-identities') row.append(node('p','Current saved association: '+({actor:'Operator',target:'Target player','actor-and-target':'Operator and target',player:'Player'}[event.selectedRole]||'Unknown')+'.'),node('small','Record reference: '+event.reference));
      else { if (event.actorName || event.actorSteamId) row.append(node('p','Operator: '+(event.actorName || event.actorSteamId))); row.append(node('small','Reference: '+(event.reference || event.id))); }
      list.append(row);
    }
    panel.append(list);
  }
  async function investigate(event) {
    const fromReport = event.currentTarget.id === 'incident-report-form', saved = reportState;
    const role = $('incident-report-participant').value;
    if (fromReport && (!saved?.canInvestigate || !saved.participants.some(value => value.role === role))) {event.preventDefault();return;}
    event.preventDefault(); clear(); const current = generation, controller = new AbortController(); pending = controller;
    const button = $(fromReport ? 'incident-report-load' : 'incident-player-load'); button.disabled = true;
    const date = new Date($('incident-player-time').value);
    const query = fromReport ? {steamId:saved.participants.find(value => value.role === role).steamId,occurredAt:saved.occurredAt} : {steamId:$('incident-player-id').value.trim(),occurredAt:Number.isFinite(date.getTime())?date.toISOString():''};
    $('incident-player-results').append(node('p','Loading private player context…'));
    let ticket;
    try {
      ticket = await check(actor);
      if (current !== generation || controller.signal.aborted) return;
      const path = fromReport ? '/api/admin-incidents/reports/'+encodeURIComponent(saved.id)+'/context?'+new URLSearchParams({role,fingerprint:saved.fingerprint}) : '/api/admin-incidents/player-context?'+new URLSearchParams(query);
      const result = await api(path, {cache:'no-store',headers:{'X-Incident-Reviewer':ticket.binding},signal:controller.signal});
      await check(ticket.binding);
      if (current !== generation || controller.signal.aborted || !valid(ticket)) return;
      if (result.reviewerBinding !== ticket.binding) throw Error('Account changed');
      if (fromReport && (reportState !== saved || result.report?.id !== saved.id || result.report?.fingerprint !== saved.fingerprint || result.report?.role !== role)) throw Object.assign(Error('Report changed'),{status:409});
      render(result,query);
      if (fromReport) $('incident-player-results').prepend(node('p','Saved report '+saved.id+' · '+(role === 'reported' ? 'Reported player' : 'Reporter')+' · Participants and time are taken from the saved report.'));
    } catch (error) {
      if (locked || current !== generation || controller.signal.aborted) return;
      try { await check(ticket?.binding || actor); } catch { return; }
      if (current === generation && valid(ticket)) {
        if (fromReport && [404,409].includes(error.status)) clearReport('The saved report changed, is unavailable or has no usable participant/time. Reload its details.');
        $('incident-player-results').replaceChildren(node('p',fromReport && [404,409].includes(error.status) ? 'Saved report context is unavailable. Reload the report details before investigating again.' : error.status === 400 ? 'Check the player ID and approximate incident time. Supported times are within the last 90 days.' : error.status === 503 ? 'Player incident context is currently disabled.' : 'Player incident context could not be loaded. Retry explicitly when the sources are available.'));
      }
    } finally { if (current === generation) {pending = null; button.disabled = locked || (fromReport && !reportState?.canInvestigate);} }
  }
  async function loadReport() {
    clear(); clearReport('Loading saved report details…'); $('incident-player-load').disabled = locked;
    if (!validReportLink || locked) return;
    const current = reportGeneration, controller = new AbortController(); reportPending = controller;
    try {
      const ticket = await check(actor);
      if (current !== reportGeneration || controller.signal.aborted) return;
      const result = await api('/api/admin-incidents/reports/'+encodeURIComponent(linkedReport),{cache:'no-store',headers:{'X-Incident-Reviewer':ticket.binding},signal:controller.signal});
      await check(ticket.binding);
      if (!valid(ticket) || current !== reportGeneration || controller.signal.aborted) return;
      const saved = result.report;
      if (result.version !== 1 || result.reviewerBinding !== ticket.binding || saved?.id !== linkedReport || typeof saved.canInvestigate !== 'boolean' || !/^[a-f0-9]{64}$/.test(saved.fingerprint) || !Array.isArray(saved.participants) || saved.participants.length < 1 || saved.participants.length > 2 || saved.participants.some(value => !['reporter','reported'].includes(value.role) || !/^\d{17}$/.test(value.steamId))) throw Error('Invalid saved report');
      reportState = saved; $('incident-report-details').append(node('p','Report reference: '+saved.id),node('p',saved.occurredAt ? 'Saved approximate incident time: '+time(saved.occurredAt) : 'No approximate incident time is saved.'));
      const select = $('incident-report-participant');
      for (const participant of saved.participants) {
        const label = participant.role === 'reported' ? 'Reported player' : 'Reporter';
        $('incident-report-details').append(node('p',label+': '+participant.steamId));
        const option = node('option',label);option.value = participant.role;select.append(option);
      }
      select.value = saved.participants.some(value => value.role === 'reported') ? 'reported' : 'reporter';
      $('incident-report-form').hidden = !saved.canInvestigate; $('incident-report-load').disabled = !saved.canInvestigate;
      $('incident-report-status').textContent = saved.canInvestigate ? 'Choose a saved participant, then select Investigate saved report to load context.' : saved.reason === 'time-required' ? 'This report needs a saved approximate incident time before report-linked investigation is possible.' : 'This report’s saved time is outside the supported source window.';
    } catch (error) {
      if (controller.signal.aborted || locked || current !== reportGeneration) return;
      try {await check(actor);} catch {return;}
      if (current === reportGeneration) clearReport(error.status === 503 ? 'Player incident context is currently disabled.' : 'Saved report details could not be loaded. Reload them when available.');
    } finally {if (current === reportGeneration) reportPending = null;}
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
      if (linkedReport) {
        $('incident-report-section').hidden = false;
        $('incident-report-section').after($('incident-player-results'));
        $('incident-manual-search').open = false;
        $('incident-manual-search').querySelector('summary').textContent = 'Search a different player and time';
        if (!validReportLink) clearReport('This saved report link is invalid. Open the report again from the private queue.');
        else if (caps.enabled === true) await loadReport();
        else clearReport('Player incident context is currently disabled.');
        $('incident-report-reload').disabled = !validReportLink || caps.enabled !== true;
      }
    } catch { if (!locked) $('incident-player-disabled').textContent = 'Player context availability could not be verified.'; }
  }
  $('incident-player-form').addEventListener('submit',investigate);
  $('incident-report-form').addEventListener('submit',investigate);
  $('incident-report-reload').addEventListener('click',loadReport);
  $('incident-report-participant').addEventListener('change',() => {clear();$('incident-report-load').disabled=locked || !reportState?.canInvestigate;});
  $('incident-report-hide').addEventListener('click',() => {clear();$('incident-report-load').disabled=locked || !reportState?.canInvestigate;});
  $('incident-player-hide').addEventListener('click',() => {clear();$('incident-player-load').disabled = locked;});
  async function focus() {
    if (!actor || locked) return;
    epoch++; $('incident-content').hidden = true; clear(); clearReport(); $('incident-player-load').disabled = false; $('incident-records').replaceChildren();
    $('incident-feedback').textContent = 'Search records again to reload private history.';
    try { const ticket = await check(actor); if (valid(ticket) && !document.hidden) $('incident-content').hidden = false; } catch {}
  }
  document.addEventListener('visibilitychange',() => {if (document.hidden) {epoch++;clear();clearReport();$('incident-content').hidden=true;$('incident-records').replaceChildren();} else focus();});
  window.addEventListener('hashchange',() => {clear();clearReport();location.reload();});
  window.addEventListener('focus',focus);
  setInterval(() => {if (actor && !locked && !document.hidden) check(actor).catch(()=>{});},15000);
  window.HVIncidentContext = {check,valid,lock};
  initialize();
})();
