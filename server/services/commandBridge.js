const { randomUUID } = require("node:crypto");
const fileBridge = require("./sftpBridge");
const httpBridge = require("./commandBridgeHttp");

const SOURCES = { dino_store: "DinoStorage", dino_retrieve: "DinoStorage", bd: "BodyDrop" };
const MAX_RESULTS_BYTES = 8 * 1024 * 1024;

function getTimeoutMs() {
  const timeoutMs = Number(process.env.COMMAND_BRIDGE_TIMEOUT_MS || 20000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new Error("COMMAND_BRIDGE_TIMEOUT_MS must be an integer from 1000 to 60000");
  }
  return timeoutMs;
}

function getTransport() {
  const transport = String(process.env.COMMAND_BRIDGE_TRANSPORT || "file").trim().toLowerCase();
  if (!["file", "http_pull"].includes(transport)) {
    throw new Error("COMMAND_BRIDGE_TRANSPORT must be file or http_pull");
  }
  return transport;
}

function getConfig() {
  if (process.env.COMMAND_BRIDGE_ENABLED !== "true") {
    throw new Error("CommandBridge is disabled. Install compatible CommandBridge and sub-mods, verify their file paths, then set COMMAND_BRIDGE_ENABLED=true. Raw RCON chat commands are not supported.");
  }
  const configured = fileBridge.normalizeRemotePath(
    process.env.COMMAND_BRIDGE_SAVED_PATH || "Mods/CommandBridge/Saved",
    "COMMAND_BRIDGE_SAVED_PATH"
  ).replace(/\/$/, "");
  if (!configured || /^(ue4ss|TheIsle)\//i.test(configured)) {
    throw new Error("COMMAND_BRIDGE_SAVED_PATH must be relative to ue4ss or an absolute FTP/SFTP directory");
  }
  const saved = configured.startsWith("/") ? configured : `${fileBridge.getUe4ssRemotePath()}/${configured}`;
  return { commandsPath: `${saved}/commands.ndjson`, resultsPath: `${saved}/results.ndjson`, timeoutMs: getTimeoutMs() };
}

function buildCommand(verb, steam, tokens = []) {
  if (!Object.hasOwn(SOURCES, verb)) throw new Error("Unsupported CommandBridge action");
  if (!/^\d{17}$/.test(steam)) throw new Error("A valid Steam ID is required");
  if (!Array.isArray(tokens) || tokens.some((token) => typeof token !== "string" || /["\\\x00-\x1f]/.test(token))) {
    throw new Error("CommandBridge tokens must be strings without quotes, backslashes or control characters");
  }
  return { id: randomUUID(), ts: Math.floor(Date.now() / 1000), verb, steam, args: { args: tokens } };
}

function findResult(text, command) {
  const lines = text.slice(0, text.lastIndexOf("\n") + 1).split("\n");
  let acknowledged = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      throw new Error("CommandBridge results contain malformed NDJSON; inspect the results file before retrying");
    }
    if (!result || result.id !== command.id || result.steam !== command.steam) continue;
    if (typeof result.ok !== "boolean" || typeof result.msg !== "string") {
      throw new Error("CommandBridge result has an invalid ok/msg schema");
    }
    if (result.source === SOURCES[command.verb]) return { result, acknowledged: true };
    if (result.source === undefined && result.verb === command.verb) {
      if (!result.ok) return { result, acknowledged: true };
      acknowledged = true;
    }
  }
  return { result: null, acknowledged };
}

async function readResult(client, path, command) {
  if (!await client.exists(path)) return { result: null, acknowledged: false };
  if (await client.size(path) > MAX_RESULTS_BYTES) {
    throw new Error("CommandBridge results exceed 8 MiB; an operator must archive/rotate the log while the bridge is stopped");
  }
  const buffer = await client.get(path);
  if (buffer.length > MAX_RESULTS_BYTES) throw new Error("CommandBridge results exceed 8 MiB");
  return findResult(buffer.toString("utf8"), command);
}

function validateResultMode(verb, resultMode) {
  if (!["submod", "bridge_ack"].includes(resultMode) ||
      (resultMode === "bridge_ack" && SOURCES[verb] !== "DinoStorage")) {
    throw new Error("DinoStorage result mode must be submod or bridge_ack; other actions require submod results");
  }
}

async function executeCommand(verb, steam, tokens = [], { resultMode = "submod" } = {}) {
  let command;
  try {
    command = buildCommand(verb, steam, tokens);
    validateResultMode(verb, resultMode);
    if (process.env.COMMAND_BRIDGE_ENABLED !== "true") {
      throw new Error("CommandBridge is disabled");
    }

    if (getTransport() === "http_pull") {
      return await httpBridge.execute(command, SOURCES[verb], {
        resultMode,
        timeoutMs: getTimeoutMs(),
      });
    }
  } catch (err) {
    console.error("[CommandBridge HTTP]", { requestId: command?.id, verb, error: err.message });
    return {
      ok: false,
      queued: false,
      confirmed: false,
      requestId: command?.id,
      error: `CommandBridge HTTP error: ${err.message}`,
    };
  }

  let client;
  let config;
  let stage = "configuration";
  let uploadAttempted = false;
  let acknowledged = false;
  try {
    config = getConfig();
    const credentials = fileBridge.getFileBridgeConfig();
    client = fileBridge.createFileBridgeClient();
    stage = "connect";
    await client.connect(credentials);
    stage = "read results preflight";
    await readResult(client, config.resultsPath, command);
    stage = "append command";
    uploadAttempted = true;
    await client.append(Buffer.from(`${JSON.stringify(command)}\n`), config.commandsPath);
    console.info("[CommandBridge] uploaded; sub-mod unconfirmed", {
      requestId: command.id, verb, commandsPath: config.commandsPath, resultsPath: config.resultsPath,
    });
    stage = "await sub-mod result";
    const deadline = Date.now() + config.timeoutMs;
    while (Date.now() < deadline) {
      const found = await readResult(client, config.resultsPath, command);
      acknowledged ||= found.acknowledged;
      if (found.result) {
        const result = found.result;
        console.info("[CommandBridge] result", { requestId: command.id, verb, source: result.source || "CommandBridge", ok: result.ok });
        return {
          ok: result.ok, queued: false, confirmed: Boolean(result.source), requestId: command.id,
          acknowledged: true,
          source: result.source || "CommandBridge", message: result.msg, error: result.ok ? undefined : result.msg,
        };
      }
      if (acknowledged && resultMode === "bridge_ack") {
        console.info("[CommandBridge] routed; DinoStorage outcome unconfirmed", { requestId: command.id, verb });
        return {
          ok: false, accepted: true, queued: true, confirmed: false, acknowledged: true,
          requestId: command.id, source: "CommandBridge",
          message: `CommandBridge accepted request ${command.id} and queued it in DinoStorage's cmd.flag. DinoStorage processing and the deferred in-game kill/restore are not confirmed. Do not retry until an operator reconciles this request in cmd.flag, cmd.flag.processing and results.ndjson.`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(acknowledged
      ? `CommandBridge routed the request, but ${SOURCES[verb]} did not return a matching result before timeout`
      : "No matching CommandBridge acknowledgement or sub-mod result before timeout");
  } catch (err) {
    console.error("[CommandBridge]", {
      requestId: command?.id, verb, stage, commandsPath: config?.commandsPath,
      resultsPath: config?.resultsPath, error: err.message,
    });
    if (uploadAttempted) {
      return {
        ok: false, queued: true, confirmed: false, requestId: command.id,
        acknowledged,
        message: `Outcome unknown (${stage}): ${err.message}. Do not retry until an operator reconciles request ${command.id} in the queues and results.`,
      };
    }
    return { ok: false, queued: false, confirmed: false, requestId: command?.id, error: `CommandBridge error (${stage}): ${err.message}` };
  } finally {
    if (client) {
      await client.end().catch((err) => {
        console.warn("[CommandBridge] connection cleanup failed", { requestId: command?.id, error: err.message });
      });
    }
  }
}

module.exports = { executeCommand, buildCommand, findResult, getConfig, getTransport };
