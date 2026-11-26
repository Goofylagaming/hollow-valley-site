'use strict';
(() => {
  const el = (id) => document.getElementById(id);
  const pending = new Map();
  let signedIn = false;
  let selectedGame = null;

  /**
   * Lobby game cards. PR 2 adds Higher/Lower, Memory Match and Reaction by
   * appending entries. Each id is sent to the server as the game name.
   * The server writes the challenge and the score. Do not send either from here.
   */
  const GAME_CARDS = [
    { id: 'trivia', name: 'Dino Trivia', summary: 'Hollow Valley and Evrima questions. Pick the right answer.' },
    { id: 'daily-puzzle', name: 'Daily Puzzle', summary: 'Finish today’s track pattern. Everyone gets the same puzzle.' },
    { id: 'guess-the-dino', name: 'Guess the Dino', summary: 'Read the clue and name the dinosaur.' },
  ];
  GAME_CARDS.push(
    { id: 'higher-lower', name: 'Higher or Lower', summary: 'Guess the next track count. The server keeps the draw.' },
    { id: 'memory-match', name: 'Memory Match', summary: 'Flip one card at a time. Matches stay face up.' },
    { id: 'reaction', name: 'Reaction', summary: 'Wait for GO, then tap. Under 120 ms does not count.' },
  );

  async function api(path, body, base = '/api/arcade') {
    const response = await fetch(base + path, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : {});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const error = new Error('Sign in with Steam to play Valley Arcade.');
      error.status = 401;
      throw error;
    }
    if (!response.ok) throw new Error(data.error || 'Valley Arcade is not open right now.');
    return data;
  }

  async function act(name, payload = {}, base = '/api/arcade') {
    const identity = base + name + JSON.stringify(payload);
    if (!pending.has(identity)) pending.set(identity, crypto.randomUUID());
    const result = await api(name, { ...payload, requestKey: pending.get(identity) }, base);
    pending.delete(identity);
    return result;
  }

  const status = (message) => { el('arcade-status').textContent = message; };

  function node(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  function button(text, action) {
    const control = node('button', text);
    control.type = 'button';
    control.addEventListener('click', async () => {
      control.disabled = true;
      try {
        await action();
        await refresh();
      } catch (error) {
        if (error.status === 401) showSignedOut();
        status(error.message);
      } finally {
        control.disabled = false;
      }
    });
    return control;
  }

  function iconFor(id) {
    return {
      trivia: '?',
      'daily-puzzle': '#',
      'guess-the-dino': 'D',
      'higher-lower': 'H',
      'memory-match': 'M',
      reaction: 'R',
    }[id] || '✦';
  }

  function accountLabel(name) {
    const value = String(name || '').replace(/\s+/g, ' ').trim();
    if (!value || /\d{17}/.test(value)) return 'Player';
    return value;
  }

  function showAccount(name) {
    const signin = el('arcade-signin');
    const account = el('arcade-account');
    if (signin) signin.hidden = true;
    if (account) {
      account.hidden = false;
      account.textContent = accountLabel(name);
    }
  }

  function syncPressed() {
    for (const button of document.querySelectorAll('.arcade-row[data-game]')) {
      button.setAttribute('aria-pressed', String(button.dataset.game === selectedGame));
    }
  }

  function openGame(id) {
    const game = GAME_CARDS.find((entry) => entry.id === id);
    if (!game) return;
    if (selectedGame && selectedGame !== id && window.HollowValleyArcadeGames && window.HollowValleyArcadeGames.stop) {
      window.HollowValleyArcadeGames.stop();
      el('question').textContent = '';
      el('answers').replaceChildren();
    }
    selectedGame = id;
    syncPressed();
    const stage = el('arcade-stage');
    if (stage) stage.hidden = false;
    const title = el('arcade-stage-title');
    if (title) title.textContent = game.name;
    const panel = el('arcade-how-panel');
    if (panel) panel.textContent = game.summary;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (stage && stage.scrollIntoView) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  }

  function gameButton(game) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'arcade-row';
    card.dataset.game = game.id;
    card.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('span');
    icon.className = 'arcade-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = iconFor(game.id);
    const copy = document.createElement('span');
    copy.className = 'arcade-row-copy';
    copy.append(node('strong', game.name), node('small', game.summary));
    card.append(icon, copy);
    card.addEventListener('click', () => {
      openGame(game.id);
      const play = el('play');
      if (play) play.focus();
    });
    return card;
  }

  function renderRail() {
    const nav = el('arcade-rail-games');
    if (!nav) return;
    nav.replaceChildren(...GAME_CARDS.map((game) => gameButton(game)));
  }

  function renderGames() {
    const cards = GAME_CARDS.map((game) => {
      const article = document.createElement('article');
      article.className = 'arcade-card arcade-game-card';
      article.setAttribute('role', 'listitem');
      const how = document.createElement('button');
      how.type = 'button';
      how.className = 'arcade-how';
      how.textContent = 'How it works';
      const panelId = 'arcade-card-how-' + game.id;
      how.setAttribute('aria-expanded', 'false');
      how.setAttribute('aria-controls', panelId);
      const panel = document.createElement('p');
      panel.id = panelId;
      panel.className = 'arcade-how-copy';
      panel.hidden = true;
      panel.textContent = game.summary;
      how.addEventListener('click', () => {
        const shown = panel.hidden;
        panel.hidden = !shown;
        how.setAttribute('aria-expanded', String(shown));
      });
      article.append(gameButton(game), how, panel);
      return article;
    });
    el('arcade-games').replaceChildren(...cards);
    syncPressed();
  }

  /**
   * PR 2 crate animation hook. Records the friendly crate name on the hidden
   * stage. The stage stays hidden until that work reveals it.
   */
  function noteCrateOpen(family) {
    const stage = el('arcade-crate-stage');
    if (!stage) return;
    stage.dataset.family = String(family || '');
    stage.dataset.label = arcadeFamilyName(family);
  }

  function oddsList(rows) {
    const list = document.createElement('ul');
    list.className = 'arcade-odds';
    for (const row of rows || []) list.append(node('li', arcadeOddsLine(row, rows)));
    return list;
  }

  function showSignedOut() {
    signedIn = false;
    el('arcade-signed-out').hidden = false;
    el('arcade-content').hidden = true;
    el('play').disabled = false;
    const board = el('arcade-leaderboard');
    if (board) board.hidden = true;
    const signin = el('arcade-signin');
    const account = el('arcade-account');
    if (signin) signin.hidden = false;
    if (account) account.hidden = true;
    const coins = el('arcade-coins');
    const level = el('arcade-level');
    if (coins) coins.textContent = '—';
    if (level) level.textContent = 'Level —';
    el('plays').textContent = 'Sign in to see plays left today';
    el('xp').value = 0;
  }

  let current;
  async function refresh() {
    current = await api('');
    signedIn = true;
    el('arcade-signed-out').hidden = true;
    el('arcade-content').hidden = false;
    el('progress').textContent = `Level ${current.level} / 100 · ${current.xp.toLocaleString('en-AU')} XP · ${current.balance.toLocaleString('en-AU')} VC`;
    const coins = el('arcade-coins');
    const level = el('arcade-level');
    if (coins) coins.textContent = current.balance.toLocaleString('en-AU');
    if (level) level.textContent = `Level ${current.level}`;
    el('xp').max = current.xpPerLevel || 500;
    const xpValue = current.level === 100 ? 500 : current.xp % 500;
    if (window.HollowValleyArcadeFx && window.HollowValleyArcadeFx.animateXp) window.HollowValleyArcadeFx.animateXp(el('xp'), xpValue);
    else el('xp').value = xpValue;
    el('plays').textContent = `${current.playsRemaining} plays left today`;
    if (window.HDS && window.HDS.loadMe) {
      window.HDS.loadMe().then((me) => {
        if (signedIn) showAccount(me && me.user && me.user.username);
      }).catch(() => { if (signedIn) showAccount(''); });
    } else showAccount('');
    el('daily').disabled = current.dailyClaimed;
    el('daily').textContent = current.dailyClaimed ? 'Daily reward claimed' : 'Claim daily XP + fragment';
    el('play').disabled = current.playsRemaining === 0;

    const crates = (current.crates || []).map((crate) => {
      const card = document.createElement('article');
      card.className = 'arcade-card';
      card.append(
        node('h3', arcadeFamilyName(crate.family)),
        oddsList(crate.odds),
        button('Open earned crate', async () => {
          noteCrateOpen(crate.family);
          const result = await act('/open', { crateId: crate.id });
          if (window.HollowValleyArcadeFx && window.HollowValleyArcadeFx.celebrateCrate) {
            await window.HollowValleyArcadeFx.celebrateCrate(result);
          }
          status(`Collected: ${arcadeRewardName(result.reward)}`);
        }),
      );
      return card;
    });
    el('crates').replaceChildren(...crates);
    if (!crates.length) el('crates').append(node('p', 'No unopened crates yet. Complete challenges or collect fragments.'));

    el('catalog').replaceChildren(...(current.catalog || []).map((entry) => {
      const count = (current.fragments || []).find((fragment) => fragment.family === entry.family)?.quantity || 0;
      const cost = current.fragmentCosts[entry.family];
      const card = document.createElement('article');
      card.className = 'arcade-card';
      const craft = button('Combine fragments', async () => {
        await act('/craft', { family: entry.family });
        status(`${arcadeFamilyName(entry.family)} added.`);
      });
      craft.disabled = count < cost;
      card.append(
        node('h3', arcadeFamilyName(entry.family)),
        node('p', `${count} / ${cost} fragments`),
        oddsList(entry.odds),
        craft,
      );
      return card;
    }));

    const entitlements = (current.entitlements || []).map((entry) => {
      const delivery = (current.deliveries || []).find((item) => item.entitlement_id === entry.id);
      const text = arcadeEntitlementLine(entry, delivery || (current.deliveryEnabled ? { message: 'Queued for automatic Dino Storage delivery' } : { message: 'Delivery is paused. This reward stays yours.' }));
      return node('li', text);
    });
    el('entitlements').replaceChildren(...entitlements);
    if (!entitlements.length) el('entitlements').append(node('li', 'No dinosaur rewards yet.'));

    el('history').replaceChildren(...(current.history || []).map((entry) => node(
      'li',
      arcadeHistoryLine(entry, new Date(entry.opened_at).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })),
    )));
    if (window.HollowValleyArcadeLeaderboard) window.HollowValleyArcadeLeaderboard.refresh(true);
  }

  el('daily').addEventListener('click', async () => {
    el('daily').disabled = true;
    try {
      await act('/daily');
      await refresh();
      status('Daily reward collected.');
    } catch (error) {
      if (error.status === 401) showSignedOut();
      status(error.message);
      el('daily').disabled = false;
    }
  });

  el('play').addEventListener('click', async () => {
    if (!signedIn) {
      status('Sign in with Steam to play Valley Arcade.');
      el('arcade-signin').focus();
      return;
    }
    const gameId = selectedGame || 'trivia';
    if (!selectedGame || el('arcade-stage').hidden) openGame(gameId);
    el('play').disabled = true;
    try {
      if (window.HollowValleyArcadeGames && window.HollowValleyArcadeGames.handles(gameId)) {
        await window.HollowValleyArcadeGames.play(gameId);
        return;
      }
      const round = await act('/start', { game: gameId }, '/api/valley-arcade');
      el('question').textContent = round.prompt;
      el('answers').replaceChildren(...(round.choices || []).map((choice) => button(choice, async () => {
        const result = await api('/answer', { id: round.id, choice }, '/api/valley-arcade');
        el('answers').replaceChildren();
        el('question').textContent = '';
        status(result.score ? `Challenge complete · ${result.payout} VC plus XP and a fragment` : 'No correct answer this time. Your owned rewards are safe.');
      })));
    } catch (error) {
      if (error.status === 401) showSignedOut();
      status(error.message);
      el('play').disabled = false;
    }
  });

  const howButton = el('arcade-how');
  if (howButton) {
    howButton.addEventListener('click', () => {
      const panel = el('arcade-how-panel');
      const open = panel.hidden;
      panel.hidden = !open;
      howButton.setAttribute('aria-expanded', String(open));
    });
  }

  window.HollowValleyArcade = { refresh, status };
  renderRail();
  renderGames();
  refresh()
    .then(() => status('Ready to play.'))
    .catch((error) => {
      if (error.status === 401) {
        showSignedOut();
        status('Sign in with Steam to play Valley Arcade.');
        return;
      }
      status(error.message);
    });
})();
