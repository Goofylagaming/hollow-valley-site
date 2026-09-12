// Minimal client for The Isle: Evrima's RCON protocol.
//
// Evrima does NOT use the standard Source Engine RCON protocol, so generic
// RCON libraries don't work. The (reverse-engineered, community-documented)
// wire format is:
//   auth packet:    0x01 + password + 0x00
//   command packet: 0x02 + <command byte code> + params + 0x00
// A successful auth reply contains the string "Password Accepted".
const net = require("node:net");

const AUTH_PREFIX = 0x01;
const COMMAND_PREFIX = 0x02;
const TERMINATOR = 0x00;
const AUTH_SUCCESS = "Password Accepted";
const PLAYERS_COMMAND_CODE = 0x40;
const SERVER_DETAILS_COMMAND_CODE = 0x12;
const ENCODING = "latin1";

function sendAndReceive(socket, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners("data");
      reject(new Error("RCON response timeout"));
    }, timeoutMs);

    socket.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(chunk.toString(ENCODING));
    });

    socket.write(data, ENCODING, (err) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function commandPacket(code, params = "") {
  return `${String.fromCharCode(COMMAND_PREFIX)}${String.fromCharCode(code)}${params}${String.fromCharCode(TERMINATOR)}`;
}

function parsePlayersResponse(response) {
  const lines = response.split("\n").filter((line) => line.trim());
  let start = 0;
  if (lines[0] && lines[0].toLowerCase() === "playerlist") start = 1;

  const names = (lines[start + 1] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const steamIds = (lines[start] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return steamIds.map((steamId, i) => ({ steamId, name: names[i] || "Unknown" }));
}

// Server details replies aren't documented/consistent; be lenient and look
// for any key that plausibly means "max player slots" (e.g. MaxPlayers,
// PlayerLimit, MaxPlayerCount, Slots...). Falls back to null if none found.
function parseMaxPlayers(response) {
  const pairs = response.split(/[,\n]/);
  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split(/[:=]/);
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.trim().toLowerCase();
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value)) continue;
    if (/(max.?player|player.?limit|max.?slot|slots)/.test(key)) {
      return value;
    }
  }
  return null;
}

/**
 * Connects to an Evrima RCON server, authenticates once, then runs the
 * `players` command (always) and `srv:details` command (best-effort, for
 * the max player slot count) over the same connection before disconnecting.
 * Rejects on connection/auth/timeout errors; a failed srv:details call is
 * swallowed since it's optional (maxPlayers will just be null).
 */
async function fetchServerStatus({ host, port, password, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs, () => fail(new Error("RCON connection timeout")));
    socket.once("error", (err) => fail(err));

    socket.connect(port, host, async () => {
      try {
        const authPacket = `${String.fromCharCode(AUTH_PREFIX)}${password}${String.fromCharCode(TERMINATOR)}`;
        const authResponse = await sendAndReceive(socket, authPacket, timeoutMs);
        if (!authResponse.includes(AUTH_SUCCESS)) {
          throw new Error("RCON authentication failed");
        }

        const playersResponse = await sendAndReceive(socket, commandPacket(PLAYERS_COMMAND_CODE), timeoutMs);
        const players = parsePlayersResponse(playersResponse);

        let maxPlayers = null;
        try {
          const detailsResponse = await sendAndReceive(socket, commandPacket(SERVER_DETAILS_COMMAND_CODE), timeoutMs);
          maxPlayers = parseMaxPlayers(detailsResponse);
        } catch {
          // Optional - ignore failures fetching max player count.
        }

        finish({ players, maxPlayers });
      } catch (err) {
        fail(err);
      }
    });
  });
}

module.exports = { fetchServerStatus };

