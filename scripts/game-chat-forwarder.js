// Run on the Hollow Valley game host with PRESENCE_FEED_URL and PRESENCE_FEED_TOKEN.
// CHAT_FEED_URL / COMBAT_FEED_URL can override the derived endpoints.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createChatLineRegex, parseChatLine } = require('./game-chat-line');
const { parseCombatLine } = require('./game-combat-line');

const path = process.env.CHAT_LOG_PATH || 'C:\\HollowValley\\TheIsleServer\\TheIsle\\Saved\\Logs\\TheIsle.log';
const presenceUrl = String(process.env.PRESENCE_FEED_URL || '');
const url = process.env.CHAT_FEED_URL || presenceUrl.replace(/\/api\/presence-feed\/snapshot\/?$/, '/api/chat-feed/messages');
const combatUrl = process.env.COMBAT_FEED_URL || presenceUrl.replace(/\/api\/presence-feed\/snapshot\/?$/, '/api/combat/events');
const token = process.env.PRESENCE_FEED_TOKEN;
const pattern = process.env.CHAT_LINE_PATTERN;
const replayBytes = Math.max(0, Math.min(128 * 1024 * 1024, Number(process.env.CHAT_FORWARDER_REPLAY_BYTES) || 16 * 1024 * 1024));
const readChunkBytes = 4 * 1024 * 1024;

if (!path || !url || !combatUrl || !token || !/^https:\/\//.test(url) || !/^https:\/\//.test(combatUrl)) {
  throw new Error('Set HTTPS PRESENCE_FEED_URL (or CHAT_FEED_URL/COMBAT_FEED_URL) and PRESENCE_FEED_TOKEN.');
}
const regex = createChatLineRegex(pattern || undefined);

let offset = 0;
let remainder = '';
let remainderStart = 0;
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

function queueLine(line, cursor) {
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
    const event = {
      eventId: `islelog:${id}`,
      ...combat,
    };
    pendingCombat.push(event);
    const actor = event.killerName ? `${event.killerName} -> ${event.victimName}` : `${event.victimName} natural/environmental death`;
    console.log(`[CombatFeed] Parsed ${actor}; queued=${pendingCombat.length}`);
  }
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

  const detail = await response.text();
  if (!response.ok) {
    const shortDetail = detail.slice(0, 500);
    if ((response.status === 400 || response.status === 207) && batch.length > 1) {
      combatBatchLimit = Math.max(1, Math.floor(batch.length / 2));
      return;
    }
    if ((response.status === 400 || response.status === 207) && batch.length === 1) {
      console.error(`[game-chat-forwarder] Skipping invalid combat log entry ${batch[0].eventId}: ${shortDetail}`);
      pendingCombat.shift();
      combatBatchLimit = 50;
      return;
    }
    combatRetryAfter = Date.now() + 30000;
    throw new Error(`Combat feed returned HTTP ${response.status}: ${shortDetail}`);
  }

  let result = null;
  try { result = detail ? JSON.parse(detail) : null; } catch {}
  console.log(`[CombatFeed] Sent ${batch.length} event(s) successfully${result ? `; inserted=${Number(result.inserted || 0)} duplicates=${Number(result.duplicates || 0)}` : ''}`);
  pendingCombat = pendingCombat.slice(batch.length);
  combatBatchLimit = 50;
  combatRetryAfter = 0;
}

function processTextChunk(text, chunkStart) {
  const combinedStart = remainder ? remainderStart : chunkStart;
  const combined = remainder + text;
  let consumedBytes = 0;
  let lastIndex = 0;
  const linePattern = /([^\r\n]*)(\r\n|\n|\r)/g;
  let match;

  while ((match = linePattern.exec(combined)) !== null) {
    const line = match[1];
    const lineOffset = combinedStart + consumedBytes;
    queueLine(line, lineOffset);
    consumedBytes += Buffer.byteLength(match[0]);
    lastIndex = linePattern.lastIndex;
  }

  remainder = combined.slice(lastIndex);
  remainderStart = combinedStart + consumedBytes;
  if (remainder.length > 4096) {
    const original = remainder;
    remainder = original.slice(-4096);
    remainderStart += Buffer.byteLength(original.slice(0, original.length - remainder.length));
  }
}

async function poll() {
  const stat = await fs.stat(path);
  const identity = `${stat.dev}:${stat.ino}`;
  if (fileId !== identity || stat.size < offset) {
    fileId = identity;
    offset = Math.max(0, stat.size - replayBytes);
    remainder = '';
    remainderStart = offset;
    console.log(`[game-chat-forwarder] Log detected. Priming from ${Math.max(0, stat.size - offset)} byte(s) back.`);
  }

  if (stat.size > offset) {
    const handle = await fs.open(path, 'r');
    try {
      const target = stat.size;
      while (offset < target) {
        const bytes = Math.min(target - offset, readChunkBytes);
        const buffer = Buffer.alloc(bytes);
        const start = offset;
        const { bytesRead } = await handle.read(buffer, 0, bytes, offset);
        if (!bytesRead) break;
        offset += bytesRead;
        processTextChunk(buffer.subarray(0, bytesRead).toString('utf8'), start);
      }
    } finally {
      await handle.close();
    }
  }

  try {
    await postChatBatch();
  } catch (error) {
    console.error('[game-chat-forwarder] Chat delivery:', error.message);
  }

  try {
    await postCombatBatch();
  } catch (error) {
    console.error('[game-chat-forwarder] Combat delivery:', error.message);
  }
}

async function loop() {
  try {
    await poll();
  } catch (error) {
    console.error('[game-chat-forwarder]', error.message);
  }
  if (pending.length > 500) pending = pending.slice(-500);
  if (pendingCombat.length > 500) pendingCombat = pendingCombat.slice(-500);
  setTimeout(loop, 2000);
}

if (require.main === module) {
  console.log(`[game-chat-forwarder] Log: ${path}`);
  console.log(`[game-chat-forwarder] Chat endpoint: ${url}`);
  console.log(`[game-chat-forwarder] Combat endpoint: ${combatUrl}`);
  loop();
}

module.exports = { poll };
