// Run on the Hollow Valley game host with CHAT_FEED_URL and PRESENCE_FEED_TOKEN.
// CHAT_LINE_PATTERN can override the confirmed LogTheIsleChatData format.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createChatLineRegex, parseChatLine } = require('./game-chat-line');
const { parseCombatLine } = require('./game-combat-line');

const path = process.env.CHAT_LOG_PATH || 'C:\\HollowValley\\TheIsleServer\\TheIsle\\Saved\\Logs\\TheIsle.log';
const presenceUrl = String(process.env.PRESENCE_FEED_URL || '');
const url = process.env.CHAT_FEED_URL || presenceUrl.replace(/\/api\/presence-feed\/snapshot\/?$/, '/api/chat-feed/messages');
const combatUrl = process.env.COMBAT_FEED_URL || presenceUrl.replace(/\/api\/presence-feed\/snapshot\/?$/, '/api/presence-feed/combat-events');
const token = process.env.PRESENCE_FEED_TOKEN;
const pattern = process.env.CHAT_LINE_PATTERN;
if (!path || !url || !combatUrl || !token || !/^https:\/\//.test(url) || !/^https:\/\//.test(combatUrl)) {
  throw new Error('Set HTTPS PRESENCE_FEED_URL (or CHAT_FEED_URL/COMBAT_FEED_URL) and PRESENCE_FEED_TOKEN.');
}
const regex = createChatLineRegex(pattern || undefined);

let offset = 0;
let remainder = '';
let pending = [];
let pendingCombat = [];
let fileId = '';
let batchLimit = 50;
let combatBatchLimit = 50;
let retryAfter = 0;
let combatRetryAfter = 0;

function lineId(cursor, line) {
  return crypto.createHash('sha256').update(`${fileId}:${cursor}:${line}`).digest('hex');
}

async function postChatBatch() {
  if (!pending.length || Date.now() < retryAfter) return;
  const batch = pending.slice(0, batchLimit);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: batch }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 400 && batch.length > 1) {
      batchLimit = Math.max(1, Math.floor(batch.length / 2));
      return;
    }
    if (response.status === 400 && /Invalid chat message|timestamp is outside the 24-hour window/i.test(detail)) {
      console.error(`[game-chat-forwarder] Skipping invalid chat log entry ${batch[0].id}: ${detail}`);
      pending.shift();
      batchLimit = 50;
      return;
    }
    retryAfter = Date.now() + 30000;
    throw new Error(`Chat feed returned HTTP ${response.status}: ${detail}`);
  }
  pending = pending.slice(batch.length);
  batchLimit = 50;
  retryAfter = 0;
}

async function postCombatBatch() {
  if (!pendingCombat.length || Date.now() < combatRetryAfter) return;
  const batch = pendingCombat.slice(0, combatBatchLimit);
  const response = await fetch(combatUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: batch }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    if ((response.status === 400 || response.status === 207) && batch.length > 1) {
      combatBatchLimit = Math.max(1, Math.floor(batch.length / 2));
      return;
    }
    if ((response.status === 400 || response.status === 207) && batch.length === 1) {
      console.error(`[game-chat-forwarder] Skipping invalid combat log entry ${batch[0].eventId}: ${detail}`);
      pendingCombat.shift();
      combatBatchLimit = 50;
      return;
    }
    combatRetryAfter = Date.now() + 30000;
    throw new Error(`Combat feed returned HTTP ${response.status}: ${detail}`);
  }

  pendingCombat = pendingCombat.slice(batch.length);
  combatBatchLimit = 50;
  combatRetryAfter = 0;
}

async function poll() {
  const stat = await fs.stat(path);
  const identity = `${stat.dev}:${stat.ino}`;
  if (fileId !== identity || stat.size < offset) {
    fileId = identity;
    // Read a larger recent window so a forwarder restart can recover recent combat
    // events as well as chat. Backend event IDs make replays safe.
    offset = Math.max(0, stat.size - 1024 * 1024);
    remainder = '';
  }
  if (stat.size > offset) {
    const handle = await fs.open(path, 'r');
    try {
      const bytes = Math.min(stat.size - offset, 1024 * 1024);
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, offset);
      const start = offset;
      offset += bytesRead;
      const lines = (remainder + buffer.subarray(0, bytesRead).toString('utf8')).split(/\r?\n/);
      remainder = lines.pop().slice(-4096);
      let cursor = start;
      for (const line of lines) {
        const id = lineId(cursor, line);
        const chat = parseChatLine(line, regex);
        if (chat) {
          pending.push({
            id,
            ...chat,
            at: new Date().toISOString(),
          });
        }

        const combat = parseCombatLine(line);
        if (combat) {
          pendingCombat.push({
            eventId: `islelog:${id}`,
            ...combat,
          });
        }
        cursor += Buffer.byteLength(line) + 1;
      }
    } finally { await handle.close(); }
  }

  await postChatBatch();
  await postCombatBatch();
}

async function loop() {
  try { await poll(); } catch (error) { console.error('[game-chat-forwarder]', error.message); }
  if (pending.length > 500) pending = pending.slice(-500);
  if (pendingCombat.length > 500) pendingCombat = pendingCombat.slice(-500);
  setTimeout(loop, 2000);
}
if (require.main === module) loop();

module.exports = { poll };
