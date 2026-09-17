const net = require('node:net');

const AUTH_PREFIX = 0x01;
const COMMAND_PREFIX = 0x02;
const TERMINATOR = 0x00;
const AUTH_SUCCESS = 'Password Accepted';
const PLAYERS_COMMAND_CODE = 0x40;
const SERVER_DETAILS_COMMAND_CODE = 0x12;
const PLAYER_DATA_COMMAND_CODE = 0x77;
const PLAYER_DATA_END = 'PlayerDataEnd';
const ENCODING = 'latin1';

function commandPacket(code, params = '') {
  return `${String.fromCharCode(COMMAND_PREFIX)}${String.fromCharCode(code)}${params}${String.fromCharCode(TERMINATOR)}`;
}

function sendAndReceive(socket, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners('data');
      reject(new Error('RCON response timeout'));
    }, timeoutMs);

    socket.once('data', (chunk) => {
      clearTimeout(timer);
      resolve(chunk.toString(ENCODING));
    });

    socket.write(data, ENCODING, (err) => {
      if (!err) return;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendAndReceiveUntil(socket, data, sentinel, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(buffer);
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString(ENCODING);
      if (buffer.includes(sentinel)) {
        cleanup();
        resolve(buffer);
      }
    };
    socket.on('data', onData);
    socket.write(data, ENCODING, (err) => {
      if (!err) return;
      cleanup();
      reject(err);
    });
  });
}

function parsePlayersResponse(response) {
  const lines = response.split('\n').filter((line) => line.trim());
  let start = 0;
  if (lines[0] && lines[0].toLowerCase() === 'playerlist') start = 1;
  const steamIds = (lines[start] || '').split(',').map((value) => value.trim()).filter(Boolean);
  const names = (lines[start + 1] || '').split(',').map((value) => value.trim()).filter(Boolean);
  return steamIds.map((steamId, index) => ({ steamId, name: names[index] || 'Unknown' }));
}

function parseMaxPlayers(response) {
  for (const pair of response.split(/[,\n]/)) {
    const [rawKey, rawValue] = pair.split(/[:=]/);
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.trim().toLowerCase();
    const value = Number.parseInt(rawValue.trim(), 10);
    if (Number.isFinite(value) && /(max.?player|player.?limit|max.?slot|slots)/.test(key)) return value;
  }
  return null;
}

function parsePlayerData(response) {
  const players = [];
  for (const rawLine of response.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('Name:')) continue;
    const brackets = [];
    const masked = line.replace(/\[[^\]]*\]/g, (match) => {
      brackets.push(match);
      return `\u0000${brackets.length - 1}\u0000`;
    });
    const fields = {};
    for (const part of masked.split(',')) {
      const splitAt = part.indexOf(':');
      if (splitAt === -1) continue;
      const key = part.slice(0, splitAt).trim();
      const value = part.slice(splitAt + 1).trim().replace(/\u0000(\d+)\u0000/g, (_, index) => brackets[Number(index)]);
      if (key) fields[key] = value;
    }
    if (!fields.PlayerID) continue;
    const numeric = (key) => {
      const value = Number(fields[key]);
      return Number.isFinite(value) ? value : null;
    };
    players.push({
      steamId: fields.PlayerID,
      name: fields.Name || 'Unknown',
      species: fields.Class || null,
      growth: numeric('Growth'),
      health: numeric('Health'),
    });
  }
  return players;
}

async function fetchServerStatus({ host, port, password, timeoutMs = 6000 }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs, () => fail(new Error('RCON connection timeout')));
    socket.once('error', fail);
    socket.connect(port, host, async () => {
      try {
        const authPacket = `${String.fromCharCode(AUTH_PREFIX)}${password}${String.fromCharCode(TERMINATOR)}`;
        const authResponse = await sendAndReceive(socket, authPacket, timeoutMs);
        if (!authResponse.includes(AUTH_SUCCESS)) throw new Error('RCON authentication failed');

        const playerResponse = await sendAndReceive(socket, commandPacket(PLAYERS_COMMAND_CODE), timeoutMs);
        const players = parsePlayersResponse(playerResponse);

        let maxPlayers = null;
        try {
          maxPlayers = parseMaxPlayers(await sendAndReceive(socket, commandPacket(SERVER_DETAILS_COMMAND_CODE), timeoutMs));
        } catch {}

        let characters = [];
        if (players.length) {
          try {
            characters = parsePlayerData(await sendAndReceiveUntil(socket, commandPacket(PLAYER_DATA_COMMAND_CODE), PLAYER_DATA_END, timeoutMs));
          } catch {}
        }

        finish({ players, characters, maxPlayers });
      } catch (error) {
        fail(error);
      }
    });
  });
}

module.exports = { fetchServerStatus };
