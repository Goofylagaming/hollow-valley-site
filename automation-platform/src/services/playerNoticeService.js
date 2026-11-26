'use strict';

const { randomUUID } = require('node:crypto');

const UNAVAILABLE = 'Prime tracker unavailable right now';
const COOLDOWN_MS = 60 * 1000;
const NOTICE_TTL_MS = 60 * 1000;
const MAX_CLAIM = 20;
const MAX_QUEUE = 200;
const PRIME_ID_TTL_MS = 30 * 60 * 1000;

const SHORT_SPECIES = Object.freeze({
  tyrannosaurus: 'Rex',
  allosaurus: 'Allo',
  carnotaurus: 'Carno',
  ceratosaurus: 'Cera',
  deinosuchus: 'Deino',
  dilophosaurus: 'Dilo',
  herrerasaurus: 'Herra',
  omniraptor: 'Omni',
  troodon: 'Troodon',
  pteranodon: 'Ptera',
  diabloceratops: 'Dibble',
  dryosaurus: 'Dryo',
  tenontosaurus: 'Teno',
  maiasaura: 'Maia',
  pachycephalosaurus: 'Pachy',
  stegosaurus: 'Stego',
  triceratops: 'Trike',
  gallimimus: 'Galli',
  hypsilophodon: 'Hypsi',
  beipiaosaurus: 'Beipi',
});

function zoneNotifyEnabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.PLAYER_MILESTONES_EVENTAI_NOTIFY || '').trim());
}

function primeChatNotifyEnabled(env = process.env) {
  const raw = env.PRIME_CHAT_NOTIFY_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  return !/^(0|false|no)$/i.test(String(raw).trim());
}

function sanitizeNoticeText(value) {
  return String(value || '')
    .replace(/["\\\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function noticeError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'NOTICES_INVALID';
  return error;
}

function speciesKey(value) {
  return require('./primeTrackerService').normalizeSpecies(value);
}

function shortSpecies(species) {
  const key = speciesKey(species);
  if (SHORT_SPECIES[key]) return SHORT_SPECIES[key];
  const raw = sanitizeNoticeText(species);
  return raw ? raw.slice(0, 16) : 'Dino';
}

function growthPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const fraction = number > 1.5 ? number / 100 : number;
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function currentZoneLabel(zones = {}) {
  const names = [
    ...(Array.isArray(zones.migrations) ? zones.migrations : []),
    ...(Array.isArray(zones.patrolZones) ? zones.patrolZones : []),
    ...(Array.isArray(zones.sanctuaries) ? zones.sanctuaries : []),
  ].map(sanitizeNoticeText).filter(Boolean);
  return names.length ? names.join(', ') : 'none';
}

function formatPrimeReply(state) {
  if (!state || state.enabled === false || !state.activeLife || !state.progress) return UNAVAILABLE;
  const life = state.activeLife;
  const progress = state.progress;
  const percent = growthPercent(life.growth);
  const species = shortSpecies(life.species);
  const prime = progress.isPrime || life.isPrime
    ? `PRIME ${formatDuration(progress.primeSeconds ?? life.primeSeconds)}`
    : 'Not Prime';
  const counts = [
    `Migration ${Number(progress.migrationZonesVisited) || 0}`,
    `Patrol ${Number(progress.patrolZonesVisited) || 0}`,
    `Sanctuary ${Number(progress.sanctuariesVisited) || 0}`,
  ].join(' · ');
  const growth = percent === null ? '' : ` ${percent}%`;
  const text = sanitizeNoticeText(`${species}${growth} · ${prime} · ${counts} · now: ${currentZoneLabel(state.currentZones)}`);
  return text || UNAVAILABLE;
}

function zoneText(category, name) {
  const clean = sanitizeNoticeText(name);
  if (!clean) return '';
  if (category === 'migration-enter') return sanitizeNoticeText(`Entered migration zone: ${clean}`);
  if (category === 'patrol-enter') return sanitizeNoticeText(`Entered patrol zone: ${clean}`);
  if (category === 'sanctuary-enter') return sanitizeNoticeText(`Entered sanctuary: ${clean}`);
  if (category === 'sanctuary-leave') return sanitizeNoticeText(`Left sanctuary: ${clean}`);
  return '';
}

function validPrimeId(value) {
  const id = String(value || '');
  return id.length >= 1 && id.length <= 120 && !/["\\\u0000-\u001F\u007F]/.test(id);
}

function validSteam(value) {
  return /^\d{17}$/.test(String(value || ''));
}

function createPlayerNoticeService(options = {}) {
  let previousOnline = null;
  let snapshotSuppress = new Set();
  let queue = [];
  const lastNotice = new Map();
  const seenPrimeIds = new Map();
  let clock = () => Date.now();

  function flagEnabled(option, fallback) {
    if (typeof option === 'function') return option() === true;
    if (typeof option === 'boolean') return option;
    return fallback();
  }

  function zonesEnabled() {
    return flagEnabled(options.zoneNotifyEnabled, zoneNotifyEnabled);
  }

  function primeEnabled() {
    return flagEnabled(options.primeChatNotifyEnabled, primeChatNotifyEnabled);
  }

  function tracker() {
    return options.primeTracker || require('./primeTrackerService');
  }

  function prune(now) {
    queue = queue.filter(notice => now - notice.createdAt <= NOTICE_TTL_MS);
    if (queue.length > MAX_QUEUE) {
      // Prime replies are already marked answered. Drop zone toasts first so a
      // full queue cannot erase a !prime line that will not be retried.
      const primes = queue.filter(notice => notice.category === 'prime');
      const zones = queue.filter(notice => notice.category !== 'prime');
      const zoneRoom = Math.max(0, MAX_QUEUE - primes.length);
      queue = [...primes, ...zones.slice(Math.max(0, zones.length - zoneRoom))];
      if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
    }
    for (const [id, seenAt] of seenPrimeIds) {
      if (now - seenAt > PRIME_ID_TTL_MS) seenPrimeIds.delete(id);
    }
  }

  function cooling(steam, category, at) {
    const last = (lastNotice.get(steam) || {})[category];
    if (!Number.isFinite(last)) return false;
    if (!(at > last)) return true;
    return at - last < COOLDOWN_MS;
  }

  function stamp(steam, category, at) {
    const row = lastNotice.get(steam) || {};
    row[category] = at;
    lastNotice.set(steam, row);
  }

  function enqueue(steam, text, category) {
    const clean = sanitizeNoticeText(text);
    if (!validSteam(steam) || !clean) return false;
    queue.push({
      id: randomUUID(),
      steam: String(steam),
      text: clean,
      category,
      createdAt: clock(),
    });
    prune(clock());
    return true;
  }

  function enqueueNames(steam, category, names, at) {
    if (!Array.isArray(names) || !names.length || cooling(steam, category, at)) return;
    let queued = 0;
    for (const name of names) {
      const text = zoneText(category, name);
      if (text && enqueue(steam, text, category)) queued += 1;
    }
    if (queued) stamp(steam, category, at);
  }

  function beginSnapshot(steamIds = []) {
    const current = new Set();
    for (const value of steamIds) {
      const steam = String(value || '');
      if (validSteam(steam)) current.add(steam);
    }
    const suppress = new Set();
    if (previousOnline === null) {
      for (const steam of current) suppress.add(steam);
    } else {
      for (const steam of current) {
        if (!previousOnline.has(steam)) suppress.add(steam);
      }
    }
    snapshotSuppress = suppress;
    previousOnline = current;
  }

  function onZoneChange(detail = {}) {
    if (!zonesEnabled()) return;
    const steam = String(detail.steamId || '');
    const at = Number(detail.at);
    if (!validSteam(steam) || !Number.isFinite(at)) return;
    // The first accepted snapshot after this process starts, and the first
    // snapshot after a player was absent, must not announce the zone they
    // are already standing in.
    if (previousOnline === null || snapshotSuppress.has(steam)) return;
    const entered = Array.isArray(detail.entered) ? detail.entered : [];
    const left = Array.isArray(detail.left) ? detail.left : [];
    if (detail.kind === 'migration') enqueueNames(steam, 'migration-enter', entered, at);
    else if (detail.kind === 'patrol') enqueueNames(steam, 'patrol-enter', entered, at);
    else if (detail.kind === 'sanctuary') {
      enqueueNames(steam, 'sanctuary-enter', entered, at);
      enqueueNames(steam, 'sanctuary-leave', left, at);
    }
  }

  function rememberPrime(id, now) {
    prune(now);
    if (seenPrimeIds.has(id)) return false;
    seenPrimeIds.set(id, now);
    return true;
  }

  function primeTextFor(steam) {
    try {
      return formatPrimeReply(tracker().trackerState(steam));
    } catch (error) {
      console.warn('[player-notices] prime lookup failed:', error.message);
      return UNAVAILABLE;
    }
  }

  function acceptPrimeRequests(requests) {
    if (!primeEnabled()) return;
    const now = clock();
    const seenInBody = new Set();
    let room = MAX_CLAIM;
    for (const request of requests) {
      if (room <= 0) break;
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        console.warn('[player-notices] ignored prime request');
        continue;
      }
      const steam = String(request.steam || request.steamId || '');
      const id = String(request.id || '');
      if (!validSteam(steam) || !validPrimeId(id)) {
        console.warn('[player-notices] ignored prime request');
        continue;
      }
      if (seenInBody.has(id) || seenPrimeIds.has(id)) continue;
      seenInBody.add(id);
      if (!enqueue(steam, primeTextFor(steam), 'prime')) continue;
      rememberPrime(id, now);
      room -= 1;
    }
  }

  function claim(now = clock()) {
    prune(now);
    const zoneOn = zonesEnabled();
    const remaining = queue.filter(notice => zoneOn || notice.category === 'prime');
    const ordered = [
      ...remaining.filter(notice => notice.category === 'prime'),
      ...remaining.filter(notice => notice.category !== 'prime'),
    ];
    const ready = ordered.slice(0, MAX_CLAIM);
    const readyIds = new Set(ready.map(notice => notice.id));
    queue = ordered.filter(notice => !readyIds.has(notice.id));
    return ready.map(notice => ({ id: notice.id, steam: notice.steam, text: notice.text }));
  }

  function collect(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw noticeError('Notice request body must be an object');
    if (body.primeRequests !== undefined && !Array.isArray(body.primeRequests)) {
      throw noticeError('primeRequests must be an array');
    }
    const requests = body.primeRequests || [];
    // One response can carry MAX_CLAIM notices. Extra prime requests stay
    // unmarked so the caller can send them on the next call.
    if (requests.length > MAX_CLAIM) {
      console.warn(`[player-notices] prime batch capped at ${MAX_CLAIM}; resend the rest`);
    }
    acceptPrimeRequests(requests);
    return { notices: claim() };
  }

  function reset() {
    previousOnline = null;
    snapshotSuppress = new Set();
    queue = [];
    lastNotice.clear();
    seenPrimeIds.clear();
    clock = () => Date.now();
  }

  function setClock(fn) {
    clock = typeof fn === 'function' ? fn : () => Date.now();
  }

  return {
    beginSnapshot,
    onZoneChange,
    collect,
    reset,
    setClock,
    sanitizeNoticeText,
    formatPrimeReply,
  };
}

const singleton = createPlayerNoticeService();

module.exports = {
  beginSnapshot: (...args) => singleton.beginSnapshot(...args),
  onZoneChange: (...args) => singleton.onZoneChange(...args),
  collect: (...args) => singleton.collect(...args),
  reset: () => singleton.reset(),
  setClock: fn => singleton.setClock(fn),
  sanitizeNoticeText,
  formatPrimeReply,
  zoneNotifyEnabled,
  primeChatNotifyEnabled,
  createPlayerNoticeService,
  UNAVAILABLE,
};
