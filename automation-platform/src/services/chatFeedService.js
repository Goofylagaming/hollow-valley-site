const store = require('./automationStore');

const KEY = 'admin:chat-feed:v1';
const MAX_MESSAGES = 500;

function read() {
  return store.getState(KEY, { value: { messages: [], lastReceivedAt: null } })?.value || { messages: [], lastReceivedAt: null };
}

function ingest(entries) {
  if (!Array.isArray(entries) || entries.length > 50) throw new Error('Provide at most 50 chat messages.');
  const incoming = entries.map((entry) => {
    const id = String(entry?.id || '').trim();
    const name = String(entry?.name || '').trim();
    const steamId = entry?.steamId == null || entry.steamId === '' ? null : String(entry.steamId).trim();
    const message = String(entry?.message || '').trim();
    const rawChannel = String(entry?.channel || 'unknown').trim().toLowerCase();
    const channel = /^(global|server|world)$/.test(rawChannel) ? 'global'
      : /^(local|spatial|proximity|nearby)$/.test(rawChannel) ? 'local' : 'unknown';
    const timestamp = Date.parse(entry?.at);
    const at = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
    if (!/^[\w:.-]{1,128}$/.test(id) || !name || name.length > 80 || (steamId !== null && !/^\d{17}$/.test(steamId)) || !message || message.length > 500 || rawChannel.length > 32 || !at) {
      throw new Error('Invalid chat message.');
    }
    if (Math.abs(Date.now() - Date.parse(at)) > 24 * 60 * 60 * 1000) throw new Error('Chat timestamp is outside the 24-hour window.');
    return { id, name, steamId, message, channel, at };
  });
  const state = read();
  const seen = new Set(state.messages.map((entry) => entry.id));
  let accepted = 0;
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    state.messages.push(entry);
    seen.add(entry.id);
    accepted++;
  }
  state.messages = state.messages.slice(-MAX_MESSAGES);
  state.lastReceivedAt = new Date().toISOString();
  store.setState(KEY, state);
  return { accepted };
}

function list() {
  const state = read();
  return { messages: state.messages.slice(-150), lastReceivedAt: state.lastReceivedAt };
}

module.exports = { ingest, list };
