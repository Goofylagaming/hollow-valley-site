(() => {
  'use strict';
  const { api } = window.HDS, $ = id => document.getElementById(id), base = '/api/season-track';
  let actor = null, caps = {}, catalog = [], next = null, selected = null, model = null, review = null, busy = false, epoch = 0;
  const message = text => { $('season-status').textContent = text; };
  const identity = me => me?.loggedIn && Number.isSafeInteger(me.user?.id) && /^\d{17}$/.test(me.user?.steam_id || '') ? `${me.user.id}:${me.user.steam_id}` : null;
  const definition = () => model?.progress?.season?.definition;
  const achievementTitle = id => ({ 'quest-1':'First quest', 'quest-25':'25 quests', 'quest-100':'100 quests', 'event-1':'First paid event confirmation', 'event-10':'10 paid event confirmations', 'event-25':'25 paid event confirmations', 'nested-adult':'Verified nested adulthood', 'life-survival-10h':'Ten observed hours on one dinosaur', 'combat-species-5':'Recorded kills across five species', 'territory-victory':'Verified Territory capture participation', 'first-level':'Reach level 2', 'level-10':'Reach level 10', 'level-25':'Reach level 25', 'level-50':'Reach level 50', 'level-100':'Reach level 100', 'playtime-1h':'One verified hour', 'playtime-25h':'25 verified hours', 'playtime-100h':'100 verified hours', 'playtime-250h':'250 verified hours', 'playtime-500h':'500 verified hours' }[id] || 'Achievement');
  const achievementRules = points => points.awards.map(award => `${award.id==='prime-observed'?'First recorded Prime observation':achievementTitle(award.id)}: ${award.xp.toLocaleString('en-AU')} season XP`).join('; ');
  const primeTiming = points => points.awards.some(award=>award.id==='prime-observed') ? ' Prime points use the first recorded Prime observation, including a dinosaur first seen already Prime. This does not establish when or how Prime was attained.' : '';
  const progressionTiming = points => (points.awards.some(award => award.id==='first-level'||award.id.startsWith('level-')) ? ' Level milestones use the original activity date behind the XP grant that crossed the level threshold.' : '') +
    (points.awards.some(award => award.id.startsWith('playtime-')) ? ' Playtime milestones use numbered five-minute intervals from observed play, not unobserved time.' : '');
  const canWrite = () => actor && !caps.readOnly && (caps.enabled || caps.managementAvailable);
  const joinOpen = () => caps.enabled && model?.progress?.season?.state === 'published' &&
    model.serverTime >= Date.parse(definition()?.startsAt) && model.serverTime < Date.parse(definition()?.endsAt);
  function clear() {
    actor = null; catalog = []; next = null; selected = null; model = null; review = null;
    $('season-catalog').replaceChildren(); $('season-tiers').replaceChildren();
    for (const id of ['season-title','season-dates','season-retention','season-achievement-rules','season-participation','season-points','season-evidence','season-review-text']) $(id).textContent = '';
  }
  function render() {
    $('season-track').hidden = !caps.enabled && !caps.managementAvailable;
    $('season-preview').textContent = caps.readOnly ? 'This preview is read-only.' : '';
    $('season-refresh').disabled = busy;
    $('season-more').hidden = !next;
    $('season-more').disabled = busy || Boolean(review);
    const list = $('season-catalog'); list.replaceChildren();
    for (const item of catalog) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'small-button';
      button.textContent = item.definition.title; button.setAttribute('aria-pressed', String(item.definition.id === selected));
      button.disabled = busy || Boolean(review);
      button.addEventListener('click', () => run(async token => { selected = item.definition.id; model = null; await loadModel(token); }));
      list.append(button);
    }
    $('season-details').hidden = !model;
    const def = definition();
    if (def) {
      const date = value => new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });
      $('season-title').textContent = def.title;
      $('season-dates').textContent = `${date(def.startsAt)} to ${date(def.endsAt)} Brisbane time. Delayed activity receipts accepted until ${date(def.settlesAt)}.`;
      $('season-retention').textContent = def.retainUntil ? `Your season participation, copied progress and saved requests expire ${date(def.retainUntil)} Brisbane time. Permanent XP stays separate.` : 'These older rules have no automatic expiry date. You can delete your participation and copied progress.';
      $('season-achievement-rules').hidden = !def.achievementPoints;
      $('season-achievement-rules').textContent = def.achievementPoints ? 'Reviewed achievement points: ' + achievementRules(def.achievementPoints) + '. Qualifying activity dates count; a later badge unlock does not move earlier activity into this season.' + progressionTiming(def.achievementPoints) + primeTiming(def.achievementPoints) : '';
      $('season-participation').textContent = model.progress.retentionExpired ? 'Personal participation records have expired.' : model.participating ? (caps.enabled ? 'You have joined this season.' : 'Season tracking is paused. You can delete your participation.') : 'You have not joined this season.';
      $('season-points').textContent = model.progress.retentionExpired ? 'Personal progress has expired.' : `${model.progress.xp.toLocaleString('en-AU')} season XP · ${model.progress.tier} of ${def.tiers.length} milestones reached.` + (def.achievementPoints ? ` ${(model.progress.achievementXp || 0).toLocaleString('en-AU')} XP comes from reviewed achievements.` : '');
      $('season-evidence').textContent = model.progress.retentionExpired ? 'The retention period has ended. Personal season progress is no longer available.' : model.progress.evidenceUnavailable ? 'Some earlier activity is no longer supported by its source evidence and is excluded.' :
        model.progress.pending ? 'New receipts have not all been checked. Update saved progress to check the next batch.' : 'All currently available receipts have been checked. Milestones do not grant rewards.';
      const tiers = $('season-tiers'); tiers.replaceChildren();
      def.tiers.forEach((tier, index) => {
        const row = document.createElement('p'); row.textContent = `${index < model.progress.tier ? '✓ ' : ''}${tier.title} · ${tier.xp.toLocaleString('en-AU')} XP`; tiers.append(row);
      });
    }
    $('season-sync').disabled = busy || Boolean(review) || !canWrite() || !caps.enabled || !model?.participating;
    $('season-choice').textContent = model?.participating ? 'Review deleting season participation' : 'Review joining';
    $('season-choice').disabled = busy || Boolean(review) || !canWrite() || !model || (!model.participating && !joinOpen());
    $('season-review').hidden = !review;
    if (review) {
      const sources = review.sources.map(source => ({ playtime: 'playing, counted at the end of each observed XP interval', quest: 'quests, counted when completed', event: 'paid event attendance, counted when staff confirm it' }[source.source])).join('; ') || 'the reviewed achievements below';
      $('season-review-text').textContent = (review.body.selected ?
        `Join ${review.title} for free. Count new eligible XP after you join from ${sources}. Earlier activity does not count. Season milestones issue no rewards. Your account’s season choice, copied XP evidence and saved-request history are retained; you can delete participation and its copied progress. Permanent XP and minimal request history remain.` :
        `Delete your participation and copied progress for ${review.title}. Rejoining starts fresh. Permanent XP, existing quest rewards and minimal request history remain.`) +
        (review.achievementPoints ? ` Additional seasonal achievement points: ${achievementRules(review.achievementPoints)}. Only qualifying source dates after joining count; these points never add permanent XP or coin rewards.` + progressionTiming(review.achievementPoints) + primeTiming(review.achievementPoints) : '') +
        (review.retainUntil ? ` Participation, copied progress and saved requests expire ${new Date(review.retainUntil).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} Brisbane time.` : '') +
        (review.uncertain ? ' The reply was not confirmed. Refresh or explicitly retry this saved request.' : review.body.expectedRevision !== model?.revision ? ' Your choice changed elsewhere. Cancel and review the latest state.' : '');
    }
    $('season-confirm').textContent = review?.uncertain ? 'Retry saved season request' : 'Confirm season choice';
    $('season-confirm').disabled = busy || !review || !canWrite() || review.actor !== actor ||
      (review.body.selected && !caps.enabled) || (!review.uncertain && review.body.expectedRevision !== model?.revision);
    $('season-cancel').disabled = busy;
  }
  async function loadModel(token) {
    if (!selected || !actor) return;
    const who = actor, result = await api(`${base}/${encodeURIComponent(selected)}`, { cache: 'no-store' });
    const checked = identity(await api('/api/me', { cache: 'no-store' }));
    if (token !== epoch) return;
    if (checked !== who) { clear(); message('Your account changed. Refresh to continue.'); return; }
    if (!result?.progress?.season?.definition || result.progress.season.definition.id !== selected || !Number.isSafeInteger(result.revision)) throw new Error('Incomplete season response');
    model = result;
  }
  async function read(token, more = false) {
    const [cap, me] = await Promise.all([api(base + '/capabilities', { cache: 'no-store' }), api('/api/me', { cache: 'no-store' })]);
    if (token !== epoch) return;
    caps = cap; const who = identity(me);
    if (!caps.enabled && !caps.managementAvailable) { clear(); return; }
    if (who !== actor) { clear(); actor = who; }
    if (!actor) { clear(); message('Sign in with Steam to view seasons.'); return; }
    const page = await api(base + '/catalog' + (more && next ? '?before=' + next : ''), { cache: 'no-store' });
    const checked = identity(await api('/api/me', { cache: 'no-store' }));
    if (token !== epoch) return;
    if (checked !== who) { clear(); message('Your account changed. Refresh to continue.'); return; }
    if (!Array.isArray(page.items)) throw new Error('Incomplete season catalog');
    const oldSelected = selected;
    // Preserve a selected historical page during a refresh, while reloading its
    // private state separately. The server revalidates the exact digest on writes.
    catalog = more ? [...catalog, ...page.items.filter(item => !catalog.some(old => old.definition.id === item.definition.id))] : page.items;
    next = page.next;
    selected = oldSelected || catalog[0]?.definition.id || null;
    await loadModel(token);
    if (token === epoch && actor) message(!catalog.length ? 'No reviewed seasons are available yet.' : !caps.enabled ? 'Season tracking is paused. Existing participants can delete their season data.' : 'Participation is free and optional. No season rewards are enabled.');
  }
  async function run(fn) {
    if (busy) return;
    busy = true; const token = ++epoch; render();
    try { await fn(token); }
    catch (error) { if (token === epoch) { clear(); message(error.status === 401 ? 'Sign in with Steam to continue.' : 'Season progress is unavailable. Refresh to try again.'); } }
    finally { if (token === epoch) { busy = false; render(); } }
  }
  $('season-refresh').addEventListener('click', () => run(read));
  $('season-more').addEventListener('click', () => run(token => read(token, true)));
  $('season-choice').addEventListener('click', () => {
    if (busy || review || !model || !canWrite() || (!model.participating && !joinOpen())) return;
    review = { actor, title: definition().title, sources: definition().sources, retainUntil: definition().retainUntil, achievementPoints: definition().achievementPoints, uncertain: false,
      body: { id: selected, selected: !model.participating, expectedRevision: model.revision, seasonDigest: model.progress.season.digest, requestKey: crypto.randomUUID() } };
    render();
  });
  $('season-cancel').addEventListener('click', () => { if (!busy) { review = null; render(); } });
  $('season-confirm').addEventListener('click', () => run(async token => {
    const saved = review;
    if (!saved || !canWrite()) return;
    const who = identity(await api('/api/me', { cache: 'no-store' }));
    if (who !== saved.actor) { clear(); message('Your account changed. Refresh to continue.'); return; }
    caps = await api(base + '/capabilities', { cache: 'no-store' });
    if (!canWrite() || (saved.body.selected && !caps.enabled)) { message('This choice is unavailable while paused or read-only.'); return; }
    try {
      const result = await api(base + '/participation', { method: 'POST', body: JSON.stringify(saved.body) });
      if (!result?.current || !Number.isSafeInteger(result.current.revision)) throw new Error('Incomplete participation response');
      await read(token); if (actor !== saved.actor) return;
      review = null; message(result.current.participating ? 'You have joined this season. New eligible activity can count.' : 'Season participation and copied progress have been deleted.');
    } catch (error) {
      const uncertain = !error.status || error.status >= 500;
      if (uncertain) { saved.uncertain = true; review = saved; } else review = null;
      try { await read(token); }
      catch (readError) {
        if (!uncertain || [401,403].includes(readError.status)) throw readError;
        model = null; message('The reply and refresh were not confirmed. Refresh to recover your choice.'); return;
      }
      message(uncertain ? 'The reply was not confirmed. Refresh or retry the saved request.' : error.status === 409 ? 'Your participation changed. Review the current choice again.' : error.message);
    }
  }));
  $('season-sync').addEventListener('click', () => run(async token => {
    if (!model?.participating || !caps.enabled || !canWrite()) return;
    const who = actor;
    if (identity(await api('/api/me', { cache: 'no-store' })) !== who) { clear(); message('Your account changed. Refresh to continue.'); return; }
    // One bounded update per click; no automatic POST retries or background loops.
    await api(base + '/sync', { method: 'POST', body: JSON.stringify({ id: selected, expectedRevision: model.revision, seasonDigest: model.progress.season.digest }) });
    await read(token);
  }));
  const refresh = () => run(read);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('focus', refresh);
  void refresh();
})();
