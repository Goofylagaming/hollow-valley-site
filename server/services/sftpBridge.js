const crypto = require("node:crypto");

let SftpClient = null;
try {
  SftpClient = require("ssh2-sftp-client");
} catch (e) {
  console.warn("[SFTP Bridge] ssh2-sftp-client module not available, SFTP actions will be disabled.");
}

function getSftpConfig() {
  return {
    host: process.env.SFTP_HOST || "103.193.81.65",
    port: Number(process.env.SFTP_PORT) || 8822,
    username: process.env.SFTP_USER || "Goofy",
    password: process.env.SFTP_PASSWORD || "Squishyhollow!1987",
    readyTimeout: 10000,
  };
}

function getBaseRemotePath() {
  const basePath = process.env.SFTP_BASE_PATH || "103.193.81.65_5565";
  return `/${basePath}/TheIsle/Binaries/Win64/ue4ss/Mods/HollowValleyPark/Saved`;
}

function getBodyDropInboxRemotePath() {
  if (process.env.BODYDROP_INBOX_PATH?.startsWith("/")) {
    return process.env.BODYDROP_INBOX_PATH;
  }
  const basePath = process.env.SFTP_BASE_PATH || "103.193.81.65_5565";
  const inboxPath = process.env.BODYDROP_INBOX_PATH || "Mods/HollowValleyBodyDrop/Saved/inbox.ndjson";
  return `/${basePath}/TheIsle/Binaries/Win64/ue4ss/${inboxPath.replace(/^\/+/, "")}`;
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

async function executeGameAction({ action, steamId, species, growth, prime, dropType, bodyDropRequestId }) {
  if (!SftpClient) {
    return {
      ok: false,
      error: "SFTP bridge client is not installed or configured on this server.",
    };
  }

  const sftp = new SftpClient();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

  try {
    await sftp.connect(getSftpConfig());

    if (action === "body_drop") {
      await appendTextFile(sftp, getBodyDropInboxRemotePath(), `${payload}\n`);
      await sftp.end();
      return {
        ok: true,
        requestId,
        queued: true,
        message: "Body drop request queued for the game server.",
      };
    }

    // Upload request JSON
    await sftp.put(Buffer.from(payload), reqPath);

    // Poll for result
    const startTime = Date.now();
    const timeoutMs = 12000; // 12s timeout

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1000));
      const exists = await sftp.exists(resPath);
      if (exists) {
        const resBuffer = await sftp.get(resPath);
        await sftp.delete(resPath).catch(() => {});
        await sftp.end();

        const resultText = resBuffer.toString("utf8");
        const parsed = JSON.parse(resultText);
        return parsed;
      }
    }

    // Clean up unhandled request file on timeout
    await sftp.delete(reqPath).catch(() => {});
    await sftp.end();

    return {
      ok: false,
      error: "Game server did not process request in time. Please ensure you are spawned in-game on the server.",
    };
  } catch (err) {
    await sftp.end().catch(() => {});
    console.error("[SFTP Bridge Error]", err);
    return {
      ok: false,
      error: `SFTP Bridge error: ${err.message}`,
    };
  }
}

module.exports = {
  executeGameAction,
  getBodyDropInboxRemotePath,
};