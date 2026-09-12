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
const PLAYER_DATA_COMMAND_CODE = 0x77;
const PLAYER_DATA_END = "PlayerDataEnd";
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

// The playData reply is large and arrives across several TCP chunks, so unlike
// the single-chunk commands we have to accumulate until the server sends its
// "PlayerDataEnd" sentinel (or we hit the timeout, which on an empty server is
// the normal exit path since no sentinel is sent when nobody is online).
function sendAndReceiveUntil(socket, data, sentinel, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
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

    socket.on("data", onData);
    socket.write(data, ENCODING, (err) => {
      if (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

function parseMutationList(raw) {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((entry) => entry.replace(/^\d+=/, "").trim())
    .filter((entry) => entry && entry.toLowerCase() !== "none");
}

/**
 * Parses the `playData` reply into one record per online character.
 *
 * Each player is a single line of `Key: value` pairs separated by commas, but
 * some values themselves contain commas (the bracketed mutation lists), so we
 * can't just split on "," - we tokenise on "Key:" boundaries instead. Bracketed
 * segments are pulled out first and restored afterwards so their inner commas
 * survive.
 */
function parsePlayerData(response) {
  const players = [];

  for (const rawLine of response.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("Name:")) continue;

    // Stash "[...]" groups so their commas don't break field splitting.
    const brackets = [];
    const masked = line.replace(/\[[^\]]*\]/g, (match) => {
      brackets.push(match);
      return `\u0000${brackets.length - 1}\u0000`;
    });

    const fields = {};
    for (const part of masked.split(",")) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part
        .slice(idx + 1)
        .trim()
        .replace(/\u0000(\d+)\u0000/g, (_, i) => brackets[Number(i)]);
      if (key) fields[key] = value;
    }

    if (!fields.PlayerID) continue;

    // "Location" is the only field whose value is space-separated sub-keys.
    const location = { x: null, y: null, z: null };
    const locMatch = /X=(-?[\d.]+)\s+Y=(-?[\d.]+)\s+Z=(-?[\d.]+)/.exec(fields.Location || "");
    if (locMatch) {
      location.x = Number(locMatch[1]);
      location.y = Number(locMatch[2]);
      location.z = Number(locMatch[3]);
    }

    const num = (key) => {
      const value = Number(fields[key]);
      return Number.isFinite(value) ? value : null;
    };

    players.push({
      steamId: fields.PlayerID,
      name: fields.Name || "Unknown",
      gender: fields.Gender || null,
      species: fields.Class || null,
      growth: num("Growth"),
      health: num("Health"),
      stamina: num("Stamina"),
      hunger: num("Hunger"),
      thirst: num("Thirst"),
      isPrime: String(fields.PrimeElder).toLowerCase() === "true",
      mutations: parseMutationList(fields.MutationSlots),
      location,
    });
  }

  return players;
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

        // Per-character detail (species, growth, vitals, position). Runs LAST
        // because it's the only streaming, multi-chunk reply - its trailing
        // packets would otherwise be misread as the next command's response.
        // Skipped on an empty server, where no PlayerDataEnd sentinel is sent
        // and we'd just burn the full timeout waiting for one.
        let characters = [];
        if (players.length) {
          try {
            const playDataResponse = await sendAndReceiveUntil(
              socket,
              commandPacket(PLAYER_DATA_COMMAND_CODE),
              PLAYER_DATA_END,
              timeoutMs
            );
            characters = parsePlayerData(playDataResponse);
          } catch {
            // Ignore - character detail is supplementary to the player list.
          }
        }

        finish({ players, characters, maxPlayers });
      } catch (err) {
        fail(err);
      }
    });
  });
}

module.exports = { fetchServerStatus, parsePlayerData };

