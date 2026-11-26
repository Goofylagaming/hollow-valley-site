'use strict';
(() => {
  const el = (id) => document.getElementById(id);
  const pending = new Map();
  let signedIn = false;
  let selectedGame = 'trivia';

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

  function renderGames() {
    const cards = GAME_CARDS.map((game) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'arcade-card arcade-game-card';
      card.dataset.game = game.id;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-pressed', String(game.id === selectedGame));
      card.append(node('strong', game.name), node('span', game.summary));
      card.addEventListener('click', () => {
        selectedGame = game.id;
        for (const other of el('arcade-games').querySelectorAll('.arcade-game-card')) {
          other.setAttribute('aria-pressed', String(other.dataset.game === selectedGame));
        }
      });
      return card;
    });
    el('arcade-games').replaceChildren(...cards);
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
  }

  let current;
  async function refresh() {
    current = await api('');
    signedIn = true;
    el('arcade-signed-out').hidden = true;
    el('arcade-content').hidden = false;
    el('progress').textContent = `Level ${current.level} / 100 · ${current.xp.toLocaleString('en-AU')} XP · ${current.balance.toLocaleString('en-AU')} VC`;
    el('xp').value = current.level === 100 ? 500 : current.xp % 500;
    el('xp').max = current.xpPerLevel || 500;
    el('plays').textContent = `${current.playsRemaining} free plays remaining today`;
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
    el('play').disabled = true;
    try {
      const round = await act('/start', { game: selectedGame }, '/api/valley-arcade');
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
