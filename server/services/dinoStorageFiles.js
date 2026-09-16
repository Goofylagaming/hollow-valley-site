const { Client: FtpClient } = require("basic-ftp");
const { Writable } = require("node:stream");
const fileBridge = require("./sftpBridge");

const MAX_STORED_DINO_BYTES = 512 * 1024;
const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;

function validateSteamId(steamId) {
  const value = String(steamId || "");
  if (!/^\d{17}$/.test(value)) throw new Error("A valid Steam ID is required");
  return value;
}

function validateSlot(slot) {
  const value = String(slot || "");
  if (!SLOT_RE.test(value)) throw new Error("Invalid DinoStorage slot");
  return value;
}

function isMissingError(err) {
  const code = Number(err?.code);
  const message = String(err?.message || "");
  return (code === 450 || code === 550) && /no such file|not found|does not exist/i.test(message);
}

function bufferWritable() {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  sink.toBuffer = () => Buffer.concat(chunks);
  return sink;
}

function speciesFromClassPath(classPath) {
  const path = String(classPath || "");
  const match = /BP_([^./]+?)(?:_C)?(?:\.|$)/i.exec(path);
  return match ? match[1].replace(/_C$/i, "") : "Unknown";
}

function mutationList(mutations) {
  if (!mutations || typeof mutations !== "object") return [];
  return [...new Set(Object.values(mutations)
    .filter((value) => typeof value === "string" && value && value !== "None"))];
}

function normalizeStoredDino(state, fallbackSlot) {
  const slot = validateSlot(state?.slot || fallbackSlot);
  return {
    ...state,
    slot,
    species: speciesFromClassPath(state?.classPath),
    gender: state?.isFemale === true ? "Female" : state?.isFemale === false ? "Male" : null,
    mutationList: mutationList(state?.mutations),
  };
}

async function connectFtp() {
  if (fileBridge.getFileBridgeProtocol() !== "ftp") {
    throw new Error("Direct DinoStorage listing currently requires GAME_FILE_PROTOCOL=ftp");
  }
  const config = fileBridge.getFileBridgeConfig();
  const client = new FtpClient(20000);
  await client.access({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    secure: (process.env.FTP_SECURE || process.env.GAME_FILE_SECURE || "").toLowerCase() === "true",
    secureOptions: (process.env.FTP_SECURE || process.env.GAME_FILE_SECURE || "").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : undefined,
  });
  return client;
}

function storedDirectory(steamId) {
  const steam = validateSteamId(steamId);
  return `${fileBridge.getUe4ssRemotePath()}/Mods/DinoStorage/Saved/stored/${steam}`;
}

async function listStoredDinos(steamId) {
  const directory = storedDirectory(steamId);
  const client = await connectFtp();
  try {
    try {
      await client.cd(directory);
    } catch (err) {
      if (isMissingError(err)) return [];
      throw err;
    }

    const entries = await client.list();
    const files = entries
      .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
      .map((entry) => ({ entry, slot: entry.name.slice(0, -5) }))
      .filter(({ slot }) => SLOT_RE.test(slot));

    const dinos = [];
    for (const { entry, slot } of files) {
      if (Number(entry.size) > MAX_STORED_DINO_BYTES) continue;
      const sink = bufferWritable();
      await client.downloadTo(sink, entry.name);
      const buffer = sink.toBuffer();
      if (buffer.length > MAX_STORED_DINO_BYTES) continue;
      let state;
      try {
        state = JSON.parse(buffer.toString("utf8"));
      } catch (err) {
        throw new Error(`Stored DinoStorage slot ${slot} contains invalid JSON: ${err.message}`);
      }
      dinos.push(normalizeStoredDino(state, slot));
    }

    dinos.sort((a, b) => Number(b.capturedAt || 0) - Number(a.capturedAt || 0));
    return dinos;
  } finally {
    client.close();
  }
}

module.exports = {
  listStoredDinos,
  validateSlot,
  validateSteamId,
  speciesFromClassPath,
  normalizeStoredDino,
};
