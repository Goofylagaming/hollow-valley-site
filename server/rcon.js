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

/**
 * Connects to an Evrima RCON server, authenticates, fetches the online
 * player list, and disconnects. Rejects on any connection/auth/timeout error.
 */
async function fetchPlayers({ host, port, password, timeoutMs = 8000 }) {
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

        const playersPacket = `${String.fromCharCode(COMMAND_PREFIX)}${String.fromCharCode(PLAYERS_COMMAND_CODE)}${String.fromCharCode(TERMINATOR)}`;
        const playersResponse = await sendAndReceive(socket, playersPacket, timeoutMs);
        finish(parsePlayersResponse(playersResponse));
      } catch (err) {
        fail(err);
      }
    });
  });
}

module.exports = { fetchPlayers };
