// Run on the Hollow Valley game host with CHAT_FEED_URL and PRESENCE_FEED_TOKEN.
// CHAT_LINE_PATTERN can override the confirmed LogTheIsleChatData format.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createChatLineRegex, parseChatLine } = require('./game-chat-line');

const path = process.env.CHAT_LOG_PATH || 'C:\\HollowValley\\TheIsleServer\\TheIsle\\Saved\\Logs\\TheIsle.log';
const url = process.env.CHAT_FEED_URL || String(process.env.PRESENCE_FEED_URL || '').replace(/\/api\/presence-feed\/snapshot\/?$/, '/api/chat-feed/messages');
const token = process.env.PRESENCE_FEED_TOKEN;
const pattern = process.env.CHAT_LINE_PATTERN;
if (!path || !url || !token || !/^https:\/\//.test(url)) {
  throw new Error('Set HTTPS CHAT_FEED_URL (or PRESENCE_FEED_URL) and PRESENCE_FEED_TOKEN.');
}
const regex = createChatLineRegex(pattern || undefined);

let offset = 0;
let remainder = '';
let pending = [];
let fileId = '';
let batchLimit = 50;
let retryAfter = 0;

async function poll() {
  const stat = await fs.stat(path);
  const identity = `${stat.dev}:${stat.ino}`;
  if (fileId !== identity || stat.size < offset) {
    fileId = identity;
    offset = Math.max(0, stat.size - 65536); // Include recent chat after startup or log rotation.
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
        const chat = parseChatLine(line, regex);
        if (chat) {
          pending.push({
            id: crypto.createHash('sha256').update(`${fileId}:${cursor}:${line}`).digest('hex'),
            ...chat,
            at: new Date().toISOString(),
          });
        }
        cursor += Buffer.byteLength(line) + 1;
      }
    } finally { await handle.close(); }
  }
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
      console.error(`[game-chat-forwarder] Skipping invalid log entry ${batch[0].id}: ${detail}`);
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

async function loop() {
  try { await poll(); } catch (error) { console.error('[game-chat-forwarder]', error.message); }
  if (pending.length > 500) pending = pending.slice(-500);
  setTimeout(loop, 2000);
}
if (require.main === module) loop();

module.exports = { poll };
