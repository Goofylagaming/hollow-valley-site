"use strict";
// Crate, XP and UI tones are synthesized in the browser with the Web Audio API.
// No sound files are shipped and nothing is loaded from a third-party host.
(() => {
  const SOUND_KEY = "hv-arcade-sound";
  let audioContext = null;
  let shownXp = null;

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) === "1"; }
    catch { return false; }
  }
  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function context() {
    if (!soundOn()) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = audioContext || new Ctx();
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }
  function tone(freq, duration, type, gainValue, delay) {
    const ac = context();
    if (!ac) return;
    const start = ac.currentTime + (delay || 0);
    const oscillator = ac.createOscillator();
    const gain = ac.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(gainValue == null ? 0.04 : gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(ac.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
  function installSound() {
    if (document.getElementById("arcade-sound")) return;
    const header = document.querySelector(".arcade header") || document.body;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "arcade-sound";
    function paint() {
      const on = soundOn();
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.textContent = on ? "Sound on" : "Sound off";
    }
    button.addEventListener("click", () => {
      try { localStorage.setItem(SOUND_KEY, soundOn() ? "0" : "1"); } catch { return; }
      paint();
      if (soundOn()) tone(660, 0.06, "sine", 0.03);
    });
    paint();
    header.append(button);
  }
  function animateXp(bar, target) {
    if (!bar) return;
    const next = Number(target) || 0;
    const from = shownXp == null ? next : shownXp;
    shownXp = next;
    if (reducedMotion() || from === next) {
      bar.value = next;
      return;
    }
    tone(640, 0.05, "sine", 0.025);
    const started = performance.now();
    const step = now => {
      const t = Math.min(1, (now - started) / 700);
      bar.value = from + (next - from) * t;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function celebrateCrate(result) {
    const stage = document.getElementById("arcade-crate-stage");
    const label = result && result.reward && result.reward.label ? result.reward.label : "Reward collected";
    tone(392, 0.08, "triangle", 0.04);
    tone(523, 0.1, "triangle", 0.04, 0.09);
    tone(659, 0.16, "triangle", 0.045, 0.18);
    if (!stage) return Promise.resolve();
    stage.replaceChildren();
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");
    stage.classList.toggle("is-static", reducedMotion());
    const chest = document.createElement("div");
    chest.className = "arcade-chest";
    chest.setAttribute("aria-hidden", "true");
    const lid = document.createElement("div");
    lid.className = "arcade-chest-lid";
    const body = document.createElement("div");
    body.className = "arcade-chest-body";
    chest.append(lid, body);
    const prize = document.createElement("p");
    prize.className = "arcade-prize";
    prize.textContent = label;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Nice";
    stage.append(chest, prize, close);
    close.focus();
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKey);
        stage.replaceChildren();
        stage.hidden = true;
        stage.setAttribute("aria-hidden", "true");
        resolve();
      };
      const onKey = event => {
        if (event.key === "Escape" || event.key === "Enter") finish();
      };
      close.addEventListener("click", finish);
      document.addEventListener("keydown", onKey);
      setTimeout(finish, reducedMotion() ? 900 : 2800);
    });
  }
  window.HollowValleyArcadeFx = {
    animateXp,
    celebrateCrate,
    playGo: () => tone(880, 0.12, "square", 0.045),
    playFlip: () => tone(420, 0.04, "square", 0.02),
    playResult(result) {
      if (result && result.score) {
        tone(523, 0.08, "sine", 0.04);
        tone(784, 0.14, "sine", 0.04, 0.09);
      } else tone(180, 0.16, "triangle", 0.035);
    }
  };
  installSound();
})();
