"use strict";
// Higher/Lower, Memory Match and Reaction. The server owns the board, the go-time and the score.
(() => {
  const GAMES = [
    { id: "higher-lower", label: "Higher or Lower", detail: "Guess the next track count. The server keeps the draw." },
    { id: "memory-match", label: "Memory Match", detail: "Flip one card at a time. Matches stay face up." },
    { id: "reaction", label: "Reaction", detail: "Wait for GO, then tap. Under 120 ms does not count." }
  ];
  const keys = new Map();
  let epoch = 0;
  let switchTicket = 0;
  let activeId = null;
  let keyHandler = null;

  function handles(id) { return GAMES.some(game => game.id === id); }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function clearKeys() {
    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
  function bindKeys(fn) {
    clearKeys();
    keyHandler = event => {
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      fn(event);
    };
    document.addEventListener("keydown", keyHandler);
  }
  function status(message) {
    if (window.HollowValleyArcade && window.HollowValleyArcade.status) window.HollowValleyArcade.status(message);
  }
  async function post(path, body) {
    const response = await fetch("/api/valley-arcade" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Arcade unavailable. Sign in and try again when the arcade is open.");
    return data;
  }
  async function startGame(game) {
    const identity = "start:" + game;
    if (!keys.has(identity)) keys.set(identity, crypto.randomUUID());
    const round = await post("/start", { game, requestKey: keys.get(identity) });
    keys.delete(identity);
    return round;
  }
  function stage() {
    return document.getElementById("answers");
  }
  function showPrompt(text) {
    const question = document.getElementById("question");
    if (question) question.textContent = text || "";
  }
  function describe(result) {
    if (result.score) {
      const time = result.reactionMs != null ? " · " + result.reactionMs + " ms" : "";
      return "Challenge complete · " + result.payout + " VC plus XP and a fragment" + time;
    }
    if (result.tooFast) return "Too fast to count. Reactions under 120 ms are rejected.";
    if (result.early) return "Too early. Wait for GO.";
    if (result.tooSlow || result.expired) return "Too slow. That round has closed.";
    return "No correct answer this time. Your owned rewards are safe.";
  }
  async function finish(result, host, stillCurrent) {
    const current = () => typeof stillCurrent !== "function" || stillCurrent();
    if (!current()) return;
    clearKeys();
    showPrompt("");
    window.HollowValleyArcadeFx && window.HollowValleyArcadeFx.playResult(result);
    const line = document.createElement("p");
    line.textContent = describe(result);
    if (current() && host) host.replaceChildren(line);
    status(line.textContent);
    if (window.HollowValleyArcade && window.HollowValleyArcade.refresh) await window.HollowValleyArcade.refresh();
  }
  async function playHigher(round) {
    const host = stage();
    if (!host) return;
    showPrompt(round.prompt || "Higher or lower?");
    const prompt = document.createElement("p");
    prompt.className = "arcade-hint";
    prompt.textContent = "Keyboard: H or Arrow Up for Higher, L or Arrow Down for Lower.";
    const row = document.createElement("div");
    row.className = "arcade-choice-row";
    let done = false;
    async function choose(choice) {
      if (done || round.id !== activeId) return;
      done = true;
      row.querySelectorAll("button").forEach(button => { button.disabled = true; });
      try { await finish(await post("/answer", { id: round.id, choice }), host); }
      catch (error) {
        done = false;
        row.querySelectorAll("button").forEach(button => { button.disabled = false; });
        status(error.message);
      }
    }
    for (const choice of round.choices || ["Higher", "Lower"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "arcade-choice";
      button.textContent = choice;
      button.addEventListener("click", () => choose(choice));
      row.append(button);
    }
    host.replaceChildren(row, prompt);
    bindKeys(event => {
      const key = event.key.toLowerCase();
      if (key === "h" || event.key === "ArrowUp") { event.preventDefault(); choose("Higher"); }
      if (key === "l" || event.key === "ArrowDown") { event.preventDefault(); choose("Lower"); }
    });
  }
  function paintCard(button, symbol, faceUp) {
    button.textContent = faceUp ? symbol : button.dataset.position;
    button.classList.toggle("is-up", faceUp);
    button.setAttribute("aria-label", faceUp ? "Card " + button.dataset.position + ", " + symbol : "Card " + button.dataset.position + ", face down");
  }
  async function playMemory(round) {
    const host = stage();
    if (!host) return;
    showPrompt(round.prompt || "Find the matching pairs.");
    const grid = document.createElement("div");
    grid.className = "arcade-memory";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Memory cards");
    const count = round.cardCount || (round.choices ? round.choices.length : 6);
    const buttons = [];
    let busy = false;
    async function flip(button) {
      if (busy || button.disabled || round.id !== activeId) return;
      busy = true;
      try {
        const result = await post("/flip", { id: round.id, position: Number(button.dataset.position) });
        window.HollowValleyArcadeFx && window.HollowValleyArcadeFx.playFlip();
        paintCard(button, result.symbol, true);
        if (result.pair && result.mismatch) {
          const other = buttons[result.pair.position - 1];
          if (other) paintCard(other, result.pair.symbol, true);
          await sleep(700);
          if (round.id === activeId) {
            paintCard(button, "", false);
            if (other && !other.disabled) paintCard(other, "", false);
          }
        }
        if (result.matched) {
          button.disabled = true;
          const other = result.pair ? buttons[result.pair.position - 1] : null;
          if (other) { paintCard(other, result.pair.symbol, true); other.disabled = true; }
        }
        if (result.complete || result.expired || result.duplicate) await finish(result, host);
      } catch (error) { status(error.message); }
      finally { busy = false; }
    }
    for (let position = 1; position <= count; position++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "arcade-memory-card";
      button.dataset.position = String(position);
      paintCard(button, "", false);
      button.addEventListener("click", () => flip(button));
      buttons.push(button);
      grid.append(button);
    }
    grid.addEventListener("keydown", event => {
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const columns = 3;
      let next = index;
      if (event.key === "ArrowRight") next = Math.min(buttons.length - 1, index + 1);
      else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
      else if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + columns);
      else if (event.key === "ArrowUp") next = Math.max(0, index - columns);
      else return;
      event.preventDefault();
      buttons[next].focus();
    });
    const hint = document.createElement("p");
    hint.className = "arcade-hint";
    hint.textContent = "Tap a card or use the arrow keys, then Enter.";
    host.replaceChildren(grid, hint);
    buttons[0].focus();
  }
  async function playReaction(round) {
    const mine = epoch;
    const host = stage();
    if (!host) return;
    const readout = document.createElement("p");
    readout.className = "arcade-countdown";
    readout.setAttribute("aria-live", "assertive");
    readout.textContent = "Get ready";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "arcade-go";
    go.textContent = "Wait";
    go.setAttribute("aria-label", "Reaction pad. Wait for GO.");
    const hint = document.createElement("p");
    hint.className = "arcade-hint";
    hint.textContent = "Click, tap, Space or Enter when the pad says GO.";
    host.replaceChildren(readout, go, hint);
    let token = null;
    let done = false;
    let release = () => {};
    const settled = new Promise(resolve => { release = resolve; });
    function stillMine() { return mine === epoch && round.id === activeId; }
    async function recover(message, fromTap) {
      if (!stillMine() || (!fromTap && done)) return;
      clearKeys();
      if (!fromTap && (done || !stillMine())) return;
      if (message) {
        status(message);
        const line = document.createElement("p");
        line.textContent = message;
        host.replaceChildren(line);
      }
      let refreshed = false;
      try {
        if (window.HollowValleyArcade && window.HollowValleyArcade.refresh) {
          await window.HollowValleyArcade.refresh();
          refreshed = true;
        }
      } catch (error) {
        status(error.message);
      }
      if (!refreshed) {
        const play = document.getElementById("play");
        if (play) play.disabled = false;
      }
    }
    async function tap() {
      if (done || !stillMine()) return;
      done = true;
      go.disabled = true;
      const body = { id: round.id, choice: "Tap" };
      if (token) body.token = token;
      try { await finish(await post("/answer", body), host, stillMine); }
      catch (error) { await recover(error.message, true); }
      release();
    }
    go.addEventListener("click", () => tap());
    bindKeys(event => {
      if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); tap(); }
    });
    try {
      while (!done && stillMine()) {
        let signal;
        try { signal = await post("/signal", { id: round.id }); }
        catch (error) {
          if (!done && stillMine()) await recover(error.message);
          break;
        }
        if (done || !stillMine()) break;
        if (signal.state === "countdown") {
          readout.textContent = String(signal.count);
          go.textContent = "Wait";
        } else if (signal.state === "wait") {
          readout.textContent = "Wait for it";
          go.textContent = "Wait";
        } else if (signal.state === "go") {
          token = signal.token;
          readout.textContent = "GO";
          go.textContent = "GO";
          go.classList.add("is-go");
          go.setAttribute("aria-label", "GO");
          window.HollowValleyArcadeFx && window.HollowValleyArcadeFx.playGo();
          break;
        } else {
          if (stillMine() && !done) await recover("Too slow. That round has closed.");
          break;
        }
        await sleep(150);
      }
    } finally {
      if (mine !== epoch) release();
      else if (!done && !token) release();
    }
    await settled;
  }
  async function play(game) {
    const ticket = ++switchTicket;
    let round;
    try {
      round = await startGame(game);
    } catch (error) {
      if (ticket !== switchTicket) return;
      status(error.message);
      const playButton = document.getElementById("play");
      if (playButton) playButton.disabled = false;
      try {
        if (window.HollowValleyArcade && window.HollowValleyArcade.refresh) await window.HollowValleyArcade.refresh();
      } catch (refreshError) {
        status(refreshError.message);
      }
      return;
    }
    if (ticket !== switchTicket) return;
    clearKeys();
    epoch += 1;
    activeId = round.id;
    if (game === "reaction") return playReaction(round);
    if (game === "higher-lower") await playHigher(round);
    else if (game === "memory-match") await playMemory(round);
    const playButton = document.getElementById("play");
    if (playButton) playButton.disabled = false;
  }
  window.HollowValleyArcadeGames = { handles, play, games: GAMES };
})();
