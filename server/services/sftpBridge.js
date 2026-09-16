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
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push("SFTP_PORT (integer 1-65535)");
  if (!process.env.SFTP_USER) missing.push("SFTP_USER");
  if (!process.env.SFTP_PASSWORD) missing.push("SFTP_PASSWORD");

  if (missing.length) {
    throw new Error(`File bridge is not configured. Missing or invalid: ${missing.join(", ")}`);
  }

  const protocol = getFileBridgeProtocol();
  if (protocol === "sftp" && port === 21) {
    throw new Error("SFTP is configured on FTP port 21. Set GAME_FILE_PROTOCOL=ftp for this plain-FTP server.");
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
    async size(remotePath) {
      return (await client.stat(remotePath)).size;
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

function isMissingFtpError(err) {
  const code = Number(err?.code);
  const message = String(err?.message || "");
  return (code === 450 || code === 550) && /no such file|not found|does not exist/i.test(message);
}

async function ftpPathExists(client, remotePath) {
  try {
    await client.size(remotePath);
    return true;
  } catch (err) {
    if (isMissingFtpError(err)) return false;
    throw err;
  }
}

function isCommandBridgeQueue(remotePath) {
  return /\/Mods\/CommandBridge\/Saved\/commands\.ndjson$/i.test(remotePath.replace(/\\/g, "/"));
}

async function publishFtpCommand(client, buffer, remotePath) {
  const normalizedPath = remotePath.replace(/\\/g, "/");
  const separator = normalizedPath.lastIndexOf("/");
  if (separator <= 0 || separator === normalizedPath.length - 1) {
    throw new Error(`Invalid FTP command queue path: ${remotePath}`);
  }

  const directory = normalizedPath.slice(0, separator);
  const queueName = normalizedPath.slice(separator + 1);
  const tempName = `${queueName}.upload-${crypto.randomUUID()}`;
  let enteredDirectory = false;
  let tempMayExist = false;

  try {
    // VeryGames normally accepts the full absolute CWD, but some remote
    // connections are routed through an FTP frontend that rejects the same
    // absolute path. Fall back to walking from / one segment at a time.
    try {
      await client.cd(directory);
    } catch (absoluteCwdError) {
      await client.cd("/");
      const segments = directory.split("/").filter(Boolean);
      try {
        for (const segment of segments) {
          await client.cd(segment);
        }
      } catch (relativeCwdError) {
        relativeCwdError.message = String(relativeCwdError.message || relativeCwdError) + " (absolute CWD also failed: " + String(absoluteCwdError.message || absoluteCwdError) + ")";
        throw relativeCwdError;
      }
    }
    enteredDirectory = true;

    if (await ftpPathExists(client, queueName)) {
      throw new Error(`FTP command queue already exists at ${remotePath}; refusing to overwrite it`);
    }

    // Mark the temp name as potentially present before STOR so a transfer that
    // disconnects after server-side creation is cleaned up when possible.
    tempMayExist = true;
    await client.uploadFrom(Readable.from([buffer]), tempName);

    // Re-check immediately before publication so a command created while this upload
    // was in flight is never deliberately overwritten.
    if (await ftpPathExists(client, queueName)) {
      throw new Error(`FTP command queue appeared while staging ${remotePath}; refusing to overwrite it`);
    }

    // RNFR/RNTO publishes the completed file without opening another data socket.
    await client.rename(tempName, queueName);
    tempMayExist = false;
  } finally {
    if (tempMayExist) {
      await client.remove(tempName).catch(() => {});
    }
    if (enteredDirectory) {
      await client.cd("/").catch(() => {});
    }
  }
}

function createFtpBridgeClient() {
  const client = new FtpClient();
  return {
    async connect(config) {
      const secure = (process.env.FTP_SECURE || process.env.GAME_FILE_SECURE || "").toLowerCase() === "true";
    await client.access({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      secure,
      secureOptions: secure ? { rejectUnauthorized: false } : undefined,
    });
    },
    async mkdir(remotePath) {
      await client.ensureDir(remotePath);
      await client.cd("/");
    },
    async append(buffer, remotePath) {
      if (isCommandBridgeQueue(remotePath)) {
        return publishFtpCommand(client, buffer, remotePath);
      }
      return client.appendFrom(Readable.from([buffer]), remotePath);
    },
    async exists(remotePath) {
      return ftpPathExists(client, remotePath);
    },
    async size(remotePath) {
      return client.size(remotePath);
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

function normalizeRemotePath(value, name) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized || /[\x00-\x1f\x7f]/.test(normalized) || /^[a-z]:/i.test(normalized)) {
    throw new Error(`${name} must be a path in the FTP/SFTP file manager, not a Windows drive path`);
  }
  if (normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error(`${name} cannot contain current- or parent-directory segments`);
  }
  return normalized;
}

function getSftpBasePath() {
  if (!process.env.SFTP_BASE_PATH?.trim()) {
    throw new Error("File bridge is not configured. Missing: SFTP_BASE_PATH (use / when TheIsle is at the file-access root)");
  }
  return normalizeRemotePath(process.env.SFTP_BASE_PATH, "SFTP_BASE_PATH").replace(/^\/+|\/+$/g, "");
}

function getUe4ssRemotePath() {
  const basePath = getSftpBasePath();
  return `${basePath ? `/${basePath}` : ""}/TheIsle/Binaries/Win64/ue4ss`;
}

function getBaseRemotePath() {
  return `${getUe4ssRemotePath()}/Mods/HollowValleyPark/Saved`;
}

function getBodyDropInboxRemotePath() {
  const configuredPath = normalizeRemotePath(
    process.env.BODYDROP_INBOX_PATH || "Mods/HollowValleyBodyDrop/Saved/inbox.ndjson",
    "BODYDROP_INBOX_PATH"
  );
  if (configuredPath.endsWith("/")) {
    throw new Error("BODYDROP_INBOX_PATH must include the inbox filename");
  }
  if (configuredPath.startsWith("/")) {
    return configuredPath;
  }
  if (/^(ue4ss|TheIsle)\//i.test(configuredPath)) {
    throw new Error("BODYDROP_INBOX_PATH is relative to ue4ss: use Mods/HollowValleyBodyDrop/Saved/inbox.ndjson, or an absolute FTP/SFTP path");
  }
  return `${getUe4ssRemotePath()}/${configuredPath}`;
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
  let stage = "configuration";
  let protocol;
  let remotePath;

  try {
    protocol = getFileBridgeProtocol();
    const config = getFileBridgeConfig();
    remotePath = action === "body_drop" ? getBodyDropInboxRemotePath() : getBaseRemotePath();
    fileClient = createFileBridgeClient();
    stage = "connect";
    await fileClient.connect(config);

    if (action === "body_drop") {
      stage = "build job";
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
      stage = "append inbox";
      // Do not create a parallel mod tree when the host prefix is wrong.
      await fileClient.append(Buffer.from(`${job}\n`), remotePath);
      console.info("[Body Drop Bridge] uploaded; spawn unconfirmed", {
        requestId, bodyDropRequestId, protocol, remotePath,
      });
      await fileClient.end().catch((err) => {
        console.warn("[Body Drop Bridge] connection cleanup failed after upload", { requestId, error: err.message });
      });
      return {
        ok: true,
        requestId,
        queued: true,
        message: "Body drop uploaded to the game-server inbox. In-game spawning is not yet confirmed.",
      };
    }

    stage = "request/result exchange";
    const baseDir = remotePath;
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
    console.error("[File Bridge Error]", { requestId, action, protocol, stage, remotePath, error: err.message });
    return {
      ok: false,
      requestId,
      error: `File bridge error (${stage}): ${err.message}${stage === "append inbox" ? " Check the server log destination, existing Saved folder, and file-write permissions." : ""}`,
    };
  }
}

module.exports = {
  executeGameAction,
  buildBodyDropJob,
  getBodyDropInboxRemotePath,
  getFileBridgeProtocol,
  createFileBridgeClient,
  getFileBridgeConfig,
  getUe4ssRemotePath,
  normalizeRemotePath,
};
