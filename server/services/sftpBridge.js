const crypto = require("node:crypto");
const { Readable, Writable } = require("node:stream");

let SftpClient = null;
try {
  SftpClient = require("ssh2-sftp-client");
} catch (e) {
  console.warn("[SFTP Bridge] ssh2-sftp-client module not available, SFTP actions will be disabled.");
}

let FtpClient = null;
try {
  FtpClient = require("basic-ftp").Client;
} catch (e) {
  console.warn("[File Bridge] basic-ftp module not available, FTP actions will be disabled.");
}

function getFileBridgeProtocol() {
  const protocol = (process.env.GAME_FILE_PROTOCOL || process.env.FILE_BRIDGE_PROTOCOL || "sftp").trim().toLowerCase();
  if (!["sftp", "ftp"].includes(protocol)) {
    throw new Error(`Unsupported game file bridge protocol: ${protocol}`);
  }
  return protocol;
}

function getFileBridgeConfig() {
  const port = Number(process.env.SFTP_PORT);
  const missing = [];
  if (!process.env.SFTP_HOST) missing.push("SFTP_HOST");
  if (!Number.isFinite(port)) missing.push("SFTP_PORT");
  if (!process.env.SFTP_USER) missing.push("SFTP_USER");
  if (!process.env.SFTP_PASSWORD) missing.push("SFTP_PASSWORD");

  if (missing.length) {
    throw new Error(`SFTP bridge is not configured. Missing: ${missing.join(", ")}`);
  }

  return {
    host: process.env.SFTP_HOST,
    port,
    user: process.env.SFTP_USER,
    password: process.env.SFTP_PASSWORD,
    readyTimeout: 10000,
  };
}

function bufferWritable() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  stream.toBuffer = () => Buffer.concat(chunks);
  return stream;
}

function createSftpBridgeClient() {
  const client = new SftpClient();
  return {
    async connect(config) {
      await client.connect({
        ...config,
        username: config.user,
      });
    },
    async mkdir(remotePath, recursive) {
      return client.mkdir(remotePath, recursive);
    },
    async append(buffer, remotePath) {
      return client.append(buffer, remotePath);
    },
    async exists(remotePath) {
      return client.exists(remotePath);
    },
    async get(remotePath) {
      return client.get(remotePath);
    },
    async put(buffer, remotePath) {
      return client.put(buffer, remotePath);
    },
    async delete(remotePath) {
      return client.delete(remotePath);
    },
    async end() {
      return client.end();
    },
  };
}

function createFtpBridgeClient() {
  const client = new FtpClient();
  return {
    async connect(config) {
      await client.access({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        secure: (process.env.FTP_SECURE || process.env.GAME_FILE_SECURE || "").toLowerCase() === "true",
      });
    },
    async mkdir(remotePath) {
      await client.ensureDir(remotePath);
      await client.cd("/");
    },
    async exists(remotePath) {
      try {
        await client.size(remotePath);
        return true;
      } catch (e) {
        return false;
      }
    },
    async get(remotePath) {
      const writable = bufferWritable();
      await client.downloadTo(writable, remotePath);
      return writable.toBuffer();
    },
    async put(buffer, remotePath) {
      await client.uploadFrom(Readable.from([buffer]), remotePath);
    },
    async delete(remotePath) {
      await client.remove(remotePath);
    },
    async end() {
      client.close();
    },
  };
}

function createFileBridgeClient() {
  const protocol = getFileBridgeProtocol();
  if (protocol === "ftp") {
    if (!FtpClient) {
      throw new Error("FTP bridge client is not installed or configured on this server.");
    }
    return createFtpBridgeClient();
  }
  if (!SftpClient) {
    throw new Error("SFTP bridge client is not installed or configured on this server.");
  }
  return createSftpBridgeClient();
}

function getSftpBasePath() {
  if (!process.env.SFTP_BASE_PATH) {
    throw new Error("SFTP bridge is not configured. Missing: SFTP_BASE_PATH");
  }
  return process.env.SFTP_BASE_PATH.replace(/^\/+|\/+$/g, "");
}

function getBaseRemotePath() {
  const basePath = getSftpBasePath();
  return `/${basePath}/TheIsle/Binaries/Win64/ue4ss/Mods/HollowValleyPark/Saved`;
}

function getBodyDropInboxRemotePath() {
  const configuredPath = (process.env.BODYDROP_INBOX_PATH || "Mods/HollowValleyBodyDrop/Saved/inbox.ndjson").trim();
  if (configuredPath.startsWith("/")) {
    return configuredPath.replace(/\/+/g, "/");
  }
  const basePath = getSftpBasePath();
  const inboxPath = configuredPath.replace(/^\/+/, "");
  if (inboxPath.split("/").some((part) => part === "..")) {
    throw new Error("BODYDROP_INBOX_PATH cannot contain parent-directory segments");
  }
  return `/${basePath}/TheIsle/Binaries/Win64/ue4ss/${inboxPath}`;
}

function buildBodyDropJob({ bodyDropRequestId, steamId, species, growth, prime, location }) {
  if (!bodyDropRequestId) throw new Error("Body Drop request ID is required");
  if (!steamId) throw new Error("Steam ID is required");
  if (!species) throw new Error("Body Drop species is required");
  if (!location || !["x", "y", "z"].every((axis) => Number.isFinite(location[axis]))) {
    throw new Error("Body Drop location must contain finite x, y, and z coordinates");
  }

  return {
    id: bodyDropRequestId,
    action: "spawn",
    steamId: String(steamId),
    species,
    growth: Number.isFinite(Number(growth)) ? Math.max(0, Math.min(1, Number(growth))) : 1,
    prime: Boolean(prime),
    x: location.x,
    y: location.y,
    z: location.z,
    requestedAt: new Date().toISOString(),
  };
}

async function appendTextFile(sftp, remotePath, text) {
  const directory = remotePath.slice(0, remotePath.lastIndexOf("/"));
  if (directory) {
    await sftp.mkdir(directory, true).catch(() => {});
  }

  if (typeof sftp.append === "function") {
    await sftp.append(Buffer.from(text), remotePath);
    return;
  }

  let existing = "";
  if (await sftp.exists(remotePath)) {
    const existingBuffer = await sftp.get(remotePath);
    existing = existingBuffer.toString("utf8");
  }
  await sftp.put(Buffer.from(existing + text), remotePath);
}

function signPayload(payload) {
  const secret = process.env.BODYDROP_SHARED_SECRET || process.env.BRIDGE_SHARED_SECRET || process.env.SESSION_SECRET;
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
}

async function executeGameAction({ action, steamId, species, growth, prime, dropType, bodyDropRequestId, location }) {
  let fileClient = null;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  try {
    fileClient = createFileBridgeClient();
    await fileClient.connect(getFileBridgeConfig());

    if (action === "body_drop") {
      // The HollowValleyBodyDrop mod's main.lua reads its own job schema from
      // the inbox.ndjson queue - it does NOT understand our "body_drop"
      // action name, dropType tiers, or bodyDropRequestId field. It only
      // processes lines where action=="spawn" and expects id/species/x/y/z.
      // Signing is included for future-proofing but the current mod doesn't
      // verify it (config.lua has no secret field).
      const jobBody = buildBodyDropJob({ bodyDropRequestId, steamId, species, growth, prime, location });
      const job = JSON.stringify({
        ...jobBody,
        signature: signPayload(jobBody),
      });
      await appendTextFile(fileClient, getBodyDropInboxRemotePath(), `${job}\n`);
      await fileClient.end();
      return {
        ok: true,
        requestId,
        queued: true,
        message: "Body drop request queued for the game server.",
      };
    }

    const baseDir = getBaseRemotePath();
    const reqPath = `${baseDir}/requests/${requestId}.json`;
    const resPath = `${baseDir}/results/${requestId}.json`;
    const payloadBody = {
      requestId,
      action,
      steamId: String(steamId),
      species,
      growth,
      prime: Boolean(prime),
      dropType,
      bodyDropRequestId,
      requestedAt: new Date().toISOString(),
    };
    const payload = JSON.stringify({
      ...payloadBody,
      signature: signPayload(payloadBody),
    });

    // Upload request JSON
    await fileClient.mkdir(`${baseDir}/requests`, true).catch(() => {});
    await fileClient.mkdir(`${baseDir}/results`, true).catch(() => {});
    await fileClient.put(Buffer.from(payload), reqPath);

    // Poll for result
    const startTime = Date.now();
    const timeoutMs = 12000; // 12s timeout

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1000));
      const exists = await fileClient.exists(resPath);
      if (exists) {
        const resBuffer = await fileClient.get(resPath);
        await fileClient.delete(resPath).catch(() => {});
        await fileClient.end();

        const resultText = resBuffer.toString("utf8");
        const parsed = JSON.parse(resultText);
        return parsed;
      }
    }

    // Clean up unhandled request file on timeout
    await fileClient.delete(reqPath).catch(() => {});
    await fileClient.end();

    return {
      ok: false,
      error: "Game server did not process request in time. Please ensure you are spawned in-game on the server.",
    };
  } catch (err) {
    await fileClient?.end().catch(() => {});
    console.error("[File Bridge Error]", err);
    return {
      ok: false,
      error: `File bridge error: ${err.message}`,
    };
  }
}

module.exports = {
  executeGameAction,
  buildBodyDropJob,
  getBodyDropInboxRemotePath,
  getFileBridgeProtocol,
};