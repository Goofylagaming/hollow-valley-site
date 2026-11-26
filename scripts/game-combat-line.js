function parseUnrealUtcTimestamp(line) {
  const match = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})(?::(\d{3}))?\]/.exec(String(line || '').trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millis = '000'] = match;
  const value = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseIsleLocalTimestamp(value) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  // Historical fallback only. Normal combat parsing uses the outer Unreal UTC
  // timestamp so daylight-saving changes on the Windows host cannot skew events.
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

function parseKillLocation(text) {
  // The Isle labels this the same way as RCON: X is east/west and Y is north/south.
  // territoryCombatSync swaps those axes before comparing them with the map.
  const match = /at:\s*X=([-+0-9.]+)\s+Y=([-+0-9.]+)\s+Z=([-+0-9.]+)/i.exec(String(text || ""));
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function parseCombatLine(line) {
  const text = String(line || '');
  if (!text.includes('LogTheIsleKillData:')) return null;

  const payload = text.split('LogTheIsleKillData:').slice(1).join('LogTheIsleKillData:').trim();
  const actor = /^\[([^\]]+)\]\s*(.*?)\s*\[(\d{17})\]\s+Dino:\s*.*?\s+-\s+(.*)$/.exec(payload);
  if (!actor) return null;

  const [, rawTime, actorName, actorSteamId, outcome] = actor;
  const occurredAt = parseUnrealUtcTimestamp(text) || parseIsleLocalTimestamp(rawTime);
  if (!occurredAt) return null;

  const kill = /^Killed the following player:\s*(.*?),\s*\[(\d{17})\],\s*Dino:/i.exec(outcome);
  if (kill) {
    const location = parseKillLocation(outcome) || parseKillLocation(text);
    return {
      occurredAt,
      killerSteamId: actorSteamId,
      killerName: cleanName(actorName),
      victimSteamId: kill[2],
      victimName: cleanName(kill[1]),
      victimSpecies: outcome.slice(kill[0].length).split(',')[0].trim() || null,
      killerLocation: location,
      victimLocation: location,
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

module.exports = { parseUnrealUtcTimestamp, parseIsleLocalTimestamp, parseCombatLine, parseKillLocation };
