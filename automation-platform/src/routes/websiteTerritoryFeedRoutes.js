const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const outbox = require('../services/herbyBotOutboxService');

const router = express.Router();
router.use(requireWebsiteToken);

const ALLOWED_KINDS = new Set(['status', 'attack', 'contest', 'capture', 'defence', 'kill']);
const TW_URL = 'https://hollowvalleyisle.com/groups/territory-wars/';
const ID_PATTERN = /^\d{17,20}$/;

function clean(value, fallback = '', max = 240) {
  // No arbitrary Markdown mentions from server logs or player-entered names.
  return (String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/@/g, '@\u200b')
    .replace(/\s+/g, ' ').trim() || fallback).slice(0, max);
}

function messageFor(event) {
  const kind = String(event?.kind || '').toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) throw new Error('Unsupported Territory Wars feed event');
  const region = clean(event.territoryName, 'Territory', 80);
  const text = clean(event.message, 'Territory updated', 300);
  const owner = clean(event.ownerName, 'Admin', 80);
  const challenger = clean(event.challengerName, 'Challenger', 80);
  const warning = kind === 'attack' && event.fiveMinuteWarning === true;
  const ids = warning && Array.isArray(event.defenderDiscordIds)
    ? [...new Set(event.defenderDiscordIds.map(String).filter(id => ID_PATTERN.test(id)))].slice(0, 6)
    : [];
  const mentions = ids.map(id => `<@${id}>`).join(' ');
  const starting = Date.parse(String(event.attackStartsAt || ''));
  const start = Number.isFinite(starting) && warning
    ? `\n**Attack begins:** <t:${Math.floor(starting / 1000)}:R>`
    : '';
  let headline = '📣 TERRITORY WARS';
  if (warning) headline = '⚔️ 5-MINUTE TERRITORY ATTACK WARNING';
  else if (kind === 'attack') headline = '⚔️ TERRITORY ATTACK';
  else if (kind === 'contest') headline = '🔥 CLAIM ZONE CONTESTED';
  else if (kind === 'capture') headline = '🏴 TERRITORY CAPTURED';
  else if (kind === 'defence') headline = '🛡️ TERRITORY DEFENDED';
  else if (kind === 'kill') headline = '☠️ BATTLEFIELD KILL';
  else if (/ended|frozen/i.test(text)) headline = '🏁 TERRITORY WAR ENDED';

  return `**${headline} — ${region}**\n${text}\n**Defender:** ${owner} · **Challenger:** ${challenger}${start}${mentions ? `\n**Defenders:** ${mentions}` : ''}\n${TW_URL}`;
}

router.post('/feed', (req, res) => {
  try {
    const input = req.body || {};
    const eventId = Number(input.eventId);
    const logId = Number(input.logId);
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || !Number.isSafeInteger(logId) || logId <= 0) {
      return res.status(400).json({ error: 'Valid event and log IDs are required' });
    }
    if (!ALLOWED_KINDS.has(String(input.kind || '').toLowerCase())) {
      return res.status(400).json({ error: 'Unsupported Territory Wars event' });
    }
    const nonce = `territory:${eventId}:log:${logId}`;
    const event = outbox.queueTerritoryWar(messageFor(input), { nonce });
    return res.status(202).json({ ok: true, id: event.id, nonce });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Territory Wars event could not be queued' });
  }
});

module.exports = router;
module.exports._test = { messageFor, clean, ALLOWED_KINDS };
