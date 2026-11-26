'use strict';

// Display helpers for the Arcade lobby. Odds stay the server's weight table;
// this only rounds a probability the server already computed.

const ARCADE_FAMILY_NAMES = {
  valley: 'Valley crate',
  alpha: 'Alpha crate',
  prime: 'Prime crate',
  event: 'Event crate',
};

function isRawId(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^\d{17}$/.test(text)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return true;
  if (!/\s/.test(text) && /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(text)) return true;
  return false;
}

function titleSpecies(species) {
  return String(species || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function arcadeFamilyName(family) {
  return ARCADE_FAMILY_NAMES[String(family || '').toLowerCase()] || 'Earned crate';
}

function arcadeRewardName(reward) {
  if (!reward || typeof reward !== 'object') return 'Earned reward';
  const label = typeof reward.label === 'string' ? reward.label.trim() : '';
  const blocked = new Set([reward.id, reward.presetId, reward.species].filter((value) => value != null && value !== '').map(String));
  if (label && !blocked.has(label) && !isRawId(label)) return label;
  const species = titleSpecies(reward.species);
  const growth = Number(reward.growthPercent);
  if (species && Number.isFinite(growth)) return `${growth}% ${species}`;
  if (species) return species;
  const amount = Number(reward.amount);
  if (reward.type === 'coins' && Number.isFinite(amount)) {
    return `${amount.toLocaleString('en-AU')} Valley Coins`;
  }
  return 'Earned reward';
}

function arcadePercent(probability) {
  const pct = Number(probability) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  const rounded = Math.round(pct);
  if (rounded < 1) return '<1%';
  return `${rounded}%`;
}

function arcadeRowProbability(row, rows) {
  if (row && Number.isFinite(Number(row.probability))) return Number(row.probability);
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((sum, item) => sum + (Number(item && item.weight) || 0), 0);
  if (total <= 0) return 0;
  return (Number(row && row.weight) || 0) / total;
}

function arcadeOddsLine(row, rows) {
  const chance = arcadePercent(arcadeRowProbability(row, rows));
  let line = `${arcadeRewardName(row)}: ${chance}`;
  const conversion = Number(row && row.duplicateConversion);
  if (Number.isFinite(conversion) && conversion > 0) {
    line += `. Already owned: ${conversion.toLocaleString('en-AU')} Valley Coins`;
  }
  return line;
}

function arcadeEntitlementLine(entry, delivery) {
  const name = arcadeRewardName(entry && entry.reward);
  if (delivery && delivery.status === 'delivered') {
    const slot = Number(delivery.slot);
    return Number.isFinite(slot) ? `${name} · Delivered to Dino Storage · slot ${slot}` : `${name} · Delivered to Dino Storage`;
  }
  const message = delivery && typeof delivery.message === 'string' ? delivery.message.trim() : '';
  if (message && !isRawId(message) && !/\b\d{17}\b/.test(message)) return `${name} · ${message}`;
  if (delivery) return `${name} · Queued for Dino Storage`;
  return `${name} · Owned`;
}

function arcadeHistoryLine(entry, when) {
  const family = arcadeFamilyName(entry && entry.family);
  const name = arcadeRewardName(entry && entry.reward);
  return when ? `${when} · ${family} · ${name}` : `${family} · ${name}`;
}

const arcadePresent = {
  arcadeFamilyName,
  arcadeRewardName,
  arcadePercent,
  arcadeRowProbability,
  arcadeOddsLine,
  arcadeEntitlementLine,
  arcadeHistoryLine,
};

if (typeof module !== 'undefined' && module.exports) module.exports = arcadePresent;
