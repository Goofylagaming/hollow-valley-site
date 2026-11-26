(function () {
  const STATUS = {
    checking: ["Checking voice…", "Proximity voice stays off until the page can confirm it is enabled."],
    disabled: ["Voice not enabled", "Voice is not enabled."],
    "signed-out": ["Sign in required", "Sign in with Steam to use proximity voice. Discord-only accounts cannot join."],
    steam: ["Steam sign-in required", "Voice needs a Steam account. Discord-only sign-in cannot join."],
    offline: ["Voice offline", "Voice is offline until a fresh server snapshot says you are on Hollow Valley."],
    "not-on-server": ["Voice offline", "Join the Hollow Valley Isle server, then leave this tab open. Voice starts when your Steam account is on a fresh snapshot."],
    livekit: ["Voice room unreachable", "The snapshot check passed, but this browser could not join the voice room."],
    mic: ["Microphone unavailable", "The microphone could not be opened. Another app may be using it."],
    blocked: ["Microphone blocked", "The browser blocked the microphone. Allow microphone access for this site, then try again."],
    connecting: ["Connecting", "Allow the microphone if your browser asks. It stays open while this tab is open."],
    on: ["Mic on", "Microphone is open. Quiet sound is not sent until you speak."],
    muted: ["Muted", "You are muted. Nearby players cannot hear you. Close the tab to release the microphone."],
  };

  const label = document.getElementById("voice-status-label");
  const detail = document.getElementById("voice-status-detail");
  const steamLink = document.getElementById("voice-steam-link");
  const enableButton = document.getElementById("voice-enable");
  const muteButton = document.getElementById("voice-mute");
  const nearby = document.getElementById("voice-nearby");
  if (!label || !detail || !enableButton || !muteButton || !nearby) return;

  const GATE_RMS = 0.02;
  const GATE_HOLD_MS = 300;
  const GAIN_POLL_MS = 1000;

  let room = null;
  let audioContext = null;
  let rawStream = null;
  let gatedTrack = null;
  let gateTimer = 0;
  let pollTimer = 0;
  let refreshTimer = 0;
  let reconnectTimer = 0;
  let leaving = false;
  let refreshing = false;
  let muted = false;
  let speaking = false;
  let micAttempts = 0;
  let connectFailed = false;
  let latest = new Map();
  let session = null;
  let connectChain = Promise.resolve();

  function setState(state, customDetail) {
    const copy = STATUS[state] || STATUS.offline;
    label.dataset.state = state === "not-on-server" ? "offline" : state;
    label.textContent = copy[0];
    if (state === "on" && speaking) detail.textContent = "Microphone is open and sending your voice.";
    else detail.textContent = customDetail || copy[1];
    if (steamLink) steamLink.hidden = state !== "signed-out" && state !== "steam";
    const retry = state === "connecting" || state === "blocked" || state === "offline" || state === "not-on-server";
    const needsSound = room && room.canPlaybackAudio === false && (state === "on" || state === "muted");
    enableButton.hidden = !retry && !needsSound;
    enableButton.textContent = needsSound ? "Enable sound" : (state === "blocked" ? "Try microphone again" : "Enable microphone");
    muteButton.hidden = state !== "on" && state !== "muted";
    muteButton.textContent = state === "muted" ? "Unmute" : "Mute";
    muteButton.setAttribute("aria-pressed", state === "muted" ? "true" : "false");
  }

  function enqueue(task) {
    connectChain = connectChain.then(task, task);
    return connectChain;
  }

  async function readJson(response) {
    try { return await response.json(); } catch { return {}; }
  }

  async function requestToken() {
    const response = await fetch("/api/voice/token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  }

  async function requestGains() {
    const response = await fetch("/api/voice/gains", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  }

  function failureState(result) {
    const code = result.body && result.body.code;
    if (result.status === 404 || code === "VOICE_DISABLED") return { state: "disabled" };
    if (result.status === 401 || code === "NOT_LOGGED_IN") return { state: "signed-out" };
    if (code === "STEAM_REQUIRED") return { state: "steam" };
    if (code === "NOT_ON_SERVER") return { state: "not-on-server" };
    if (code === "SNAPSHOT_STALE") return { state: "offline", detail: "The server snapshot is more than 30 seconds old, so voice is staying off." };
    if (code === "SNAPSHOT_UNAVAILABLE") return { state: "offline", detail: "The server snapshot is not marked online, so voice is staying off." };
    if (code === "VOICE_SCALE") return { state: "offline", detail: "Voice scale is not configured as a positive number." };
    if (code === "LIVEKIT_MINT_FAILED") return { state: "livekit", detail: "The server could not sign a voice token. Check the LiveKit URL, key, secret, and room." };
    if (code === "BAD_ORIGIN") return { state: "offline", detail: "Open this page on hollowvalleyisle.com and try again." };
    return { state: "offline" };
  }

  async function adminNote() {
    try {
      const me = window.HDS && await window.HDS.loadMe();
      if (!me || !me.user || !me.user.is_admin) return "";
      const response = await fetch("/api/voice/diagnosis", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) return "";
      const body = await response.json();
      const livekit = body.livekit && body.livekit.status ? body.livekit.status : "unknown";
      const age = Number.isFinite(body.ageMs) ? `${body.ageMs} ms` : "unknown";
      return ` Admin check: gate ${body.reason}, age ${age}, positioned ${body.selfPositioned ? "yes" : "no"}, LiveKit ${livekit}.`;
    } catch {
      return "";
    }
  }

  async function showFailure(state, detail) {
    setState(state, detail);
    const note = await adminNote();
    if (note) setState(state, `${detail || (STATUS[state] && STATUS[state][1]) || ""} ${note}`.trim());
  }

  function parseGains(body) {
    const rows = body && Array.isArray(body.gains) ? body.gains : [];
    const next = new Map();
    for (const entry of rows) {
      if (!entry || typeof entry !== "object") continue;
      const identity = String(entry.identity || "");
      if (!/^\d{17}$/.test(identity)) continue;
      const gain = Number(entry.gain);
      if (!Number.isFinite(gain) || gain < 0 || gain > 1) continue;
      const audible = entry.audible === true && gain > 0;
      const displayName = String(entry.displayName || "Survivor").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Survivor";
      next.set(identity, { gain: audible ? gain : 0, audible, displayName });
    }
    return next;
  }

  function applyVolumes() {
    nearby.replaceChildren();
    const heard = [];
    if (room && room.remoteParticipants) {
      for (const participant of room.remoteParticipants.values()) {
        const row = latest.get(participant.identity);
        const volume = row && row.audible ? row.gain : 0;
        try {
          if (typeof participant.setVolume === "function") participant.setVolume(volume);
          if (participant.audioTrackPublications) {
            for (const publication of participant.audioTrackPublications.values()) {
              if (publication.track && typeof publication.track.setVolume === "function") publication.track.setVolume(volume);
            }
          }
        } catch { /* missing audio output must not stop the poll */ }
        if (volume > 0 && row) heard.push(row.displayName);
      }
    }
    if (!heard.length) {
      const empty = document.createElement("li");
      empty.textContent = room ? "Nobody close enough to hear." : "Nobody yet.";
      nearby.append(empty);
      return;
    }
    for (const name of heard) {
      const item = document.createElement("li");
      item.textContent = name;
      nearby.append(item);
    }
  }

  function silenceAll() {
    latest = new Map();
    applyVolumes();
  }

  function releaseMic() {
    clearInterval(gateTimer);
    gateTimer = 0;
    speaking = false;
    if (gatedTrack) {
      try { gatedTrack.stop(); } catch { /* already stopped */ }
    }
    gatedTrack = null;
    if (rawStream) rawStream.getTracks().forEach((track) => { try { track.stop(); } catch { /* already stopped */ } });
    rawStream = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
  }

  function clearTimers() {
    clearTimeout(refreshTimer);
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    pollTimer = 0;
  }

  async function disconnectRoom() {
    clearTimers();
    releaseMic();
    silenceAll();
    if (!room) return;
    refreshing = true;
    try { await room.disconnect(); } catch { /* already closed */ }
    refreshing = false;
  }

  function sampleLevel(analyser, samples) {
    if (typeof analyser.getFloatTimeDomainData === "function") {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      return Math.sqrt(sum / samples.length);
    }
    const bytes = new Uint8Array(samples.length);
    analyser.getByteTimeDomainData(bytes);
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      const centered = (bytes[i] - 128) / 128;
      sum += centered * centered;
    }
    return Math.sqrt(sum / bytes.length);
  }

  function ensureGate() {
    if (gatedTrack && gatedTrack.readyState === "live" && audioContext && audioContext.state !== "closed") return;
    clearInterval(gateTimer);
    gateTimer = 0;
    if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(rawStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    const destination = audioContext.createMediaStreamDestination();
    source.connect(analyser);
    source.connect(gain);
    gain.connect(destination);
    const samples = new Float32Array(analyser.fftSize);
    let holdUntil = 0;
    gateTimer = setInterval(() => {
      if (!audioContext) return;
      if (muted || audioContext.state !== "running") {
        gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
        speaking = false;
        return;
      }
      const rms = sampleLevel(analyser, samples);
      const now = performance.now();
      if (rms >= GATE_RMS) holdUntil = now + GATE_HOLD_MS;
      const open = now < holdUntil;
      gain.gain.setTargetAtTime(open ? 1 : 0, audioContext.currentTime, 0.015);
      if (open !== speaking) {
        speaking = open;
        if (label.dataset.state === "on") setState("on");
      }
    }, 50);
    gatedTrack = destination.stream.getAudioTracks()[0];
  }

  async function publishMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error("Microphone API is unavailable");
      error.name = "NotAllowedError";
      throw error;
    }
    if (!rawStream || !rawStream.getAudioTracks().some((track) => track.readyState === "live")) {
      releaseMic();
      rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
        },
        video: false,
      });
    }
    ensureGate();
    if (audioContext.state === "suspended") await audioContext.resume();
    if (audioContext.state !== "running") {
      const error = new Error("Microphone audio is suspended");
      error.name = "NotAllowedError";
      throw error;
    }
    const source = window.LivekitClient.Track.Source.Microphone;
    const publications = room.localParticipant.audioTrackPublications;
    let published = false;
    if (publications) {
      for (const publication of publications.values()) {
        if (publication.track && publication.track.mediaStreamTrack === gatedTrack) published = true;
      }
    }
    if (!published) {
      await room.localParticipant.publishTrack(gatedTrack, { source, dtx: true, red: true });
    }
    gatedTrack.enabled = !muted;
  }

  function scheduleRefresh(expiresAt) {
    clearTimeout(refreshTimer);
    const expires = Date.parse(expiresAt || "");
    const delay = Number.isFinite(expires) ? Math.max(15000, expires - Date.now() - 5 * 60 * 1000) : 20 * 60 * 1000;
    refreshTimer = setTimeout(() => { enqueue(() => refreshSession()); }, delay);
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { pollGains(); }, GAIN_POLL_MS);
  }

  async function pollGains() {
    if (leaving || !room) return;
    try {
      const result = await requestGains();
      if (!result.ok) {
        silenceAll();
        const code = result.body && result.body.code;
        if (code === "NOT_ON_SERVER" || code === "SNAPSHOT_STALE" || code === "SNAPSHOT_UNAVAILABLE" || result.status === 401 || result.status === 404) {
          await disconnectRoom();
          const failure = failureState(result);
          await showFailure(failure.state, failure.detail);
        }
        return;
      }
      latest = parseGains(result.body);
      applyVolumes();
    } catch {
      silenceAll();
    }
  }

  function bindRoom(nextRoom) {
    const events = window.LivekitClient.RoomEvent;
    nextRoom.on(events.ParticipantConnected, (participant) => {
      try { if (typeof participant.setVolume === "function") participant.setVolume(0); } catch { /* ignore */ }
    });
    nextRoom.on(events.TrackSubscribed, (track) => {
      try { if (typeof track.setVolume === "function") track.setVolume(0); } catch { /* ignore */ }
      applyVolumes();
    });
    nextRoom.on(events.Disconnected, () => {
      if (leaving || refreshing || connectFailed) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { enqueue(() => refreshSession()); }, 2000);
    });
    nextRoom.on(events.AudioPlaybackStatusChanged, () => {
      if (!nextRoom.canPlaybackAudio && !leaving) {
        enableButton.hidden = false;
        enableButton.textContent = "Enable sound";
      }
    });
  }

  async function connectSession() {
    if (!window.LivekitClient || !window.LivekitClient.Room) {
      setState("offline", "Voice could not load. Refresh this page.");
      return;
    }
    if (!room) {
      room = new window.LivekitClient.Room();
      bindRoom(room);
    }
    connectFailed = false;
    if (room.state !== "connected") await room.connect(session.url, session.token);
    try { await room.startAudio(); } catch { /* a later click calls startAudio */ }
    await publishMic();
    micAttempts = 0;
    if (!muted) setState("on");
    else setState("muted");
    scheduleRefresh(session.expiresAt);
    startPolling();
    await pollGains();
  }

  async function refreshSession() {
    if (leaving) return;
    const result = await requestToken();
    if (!result.ok) {
      connectFailed = true;
      await disconnectRoom();
      const failure = failureState(result);
      await showFailure(failure.state, failure.detail);
      return;
    }
    session = result.body;
    if (!room || !window.LivekitClient) {
      setState("connecting");
      await connectSession();
      return;
    }
    refreshing = true;
    try {
      connectFailed = false;
      if (room.state === "connected") await room.disconnect();
      await room.connect(session.url, session.token);
      await publishMic();
    } catch (error) {
      connectFailed = true;
      await reportJoinError(error);
      return;
    } finally {
      refreshing = false;
    }
    scheduleRefresh(session.expiresAt);
    applyVolumes();
    if (!muted) setState("on");
  }

  function safeErrorName(error) {
    const name = error && error.name;
    return typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
  }

  function mediaProblem(error) {
    const name = error && error.name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "blocked";
    if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError" || name === "AbortError") return "mic";
    return "";
  }

  async function reportJoinError(error) {
    const kind = mediaProblem(error);
    const name = safeErrorName(error);
    if (kind === "blocked") {
      micAttempts += 1;
      await showFailure(micAttempts > 1 ? "blocked" : "connecting", "Click Enable microphone to start. The microphone then stays on while this tab is open.");
      return;
    }
    if (kind === "mic") {
      await showFailure("mic", `The microphone could not be opened (${name}). Another app may be using it.`);
      return;
    }
    await showFailure("livekit", `The voice room did not connect (${name}). The snapshot check had already allowed a token.`);
  }

  async function startVoice() {
    if (leaving) return;
    if (room && room.canPlaybackAudio === false && typeof room.startAudio === "function") {
      try { await room.startAudio(); } catch { /* the button can be pressed again */ }
    }
    if (session && room && room.state === "connected" && gatedTrack && gatedTrack.readyState === "live") {
      if (audioContext && audioContext.state === "suspended") await audioContext.resume();
      if (!muted) setState("on");
      return;
    }
    setState("connecting");
    const result = session ? { ok: true, body: session } : await requestToken();
    if (!result.ok) {
      const failure = failureState(result);
      await showFailure(failure.state, failure.detail);
      return;
    }
    session = result.body;
    try {
      await connectSession();
    } catch (error) {
      connectFailed = true;
      await reportJoinError(error);
    }
  }

  enableButton.addEventListener("click", () => { enqueue(() => startVoice()); });
  muteButton.addEventListener("click", () => {
    if (!gatedTrack) return;
    muted = !muted;
    gatedTrack.enabled = !muted;
    speaking = false;
    setState(muted ? "muted" : "on");
  });
  window.addEventListener("pagehide", () => {
    leaving = true;
    clearTimers();
    releaseMic();
    if (room) room.disconnect();
  });

  enqueue(async () => {
    setState("checking");
    try {
      const result = await requestToken();
      if (!result.ok) {
        const failure = failureState(result);
        await showFailure(failure.state, failure.detail);
        return;
      }
      session = result.body;
      await startVoice();
    } catch {
      setState("offline");
    }
  });
}());
