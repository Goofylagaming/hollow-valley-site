function parseIsleLocalTimestamp(value) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const millis = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}+10:00`);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function cleanName(value) {
  const name = String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return name ? name.slice(0, 80) : null;
}

function parseCombatLine(line) {
  const text = String(line || '');
  if (!text.includes('LogTheIsleKillData:')) return null;

  const payload = text.split('LogTheIsleKillData:').slice(1).join('LogTheIsleKillData:').trim();
  const actor = /^\[([^\]]+)\]\s*(.*?)\s*\[(\d{17})\]\s+Dino:\s*.*?\s+-\s+(.*)$/.exec(payload);
  if (!actor) return null;

  const [, rawTime, actorName, actorSteamId, outcome] = actor;
  const occurredAt = parseIsleLocalTimestamp(rawTime);
  if (!occurredAt) return null;

  const kill = /^Killed the following player:\s*(.*?),\s*\[(\d{17})\],\s*Dino:/i.exec(outcome);
  if (kill) {
    return {
      occurredAt,
      killerSteamId: actorSteamId,
      killerName: cleanName(actorName),
      victimSteamId: kill[2],
      victimName: cleanName(kill[1]),
    };
  }

  if (/^Died from\b/i.test(outcome)) {
    return {
      occurredAt,
      killerSteamId: null,
      killerName: null,
      victimSteamId: actorSteamId,
      victimName: cleanName(actorName),
    };
  }

  return null;
}

module.exports = { parseIsleLocalTimestamp, parseCombatLine };
