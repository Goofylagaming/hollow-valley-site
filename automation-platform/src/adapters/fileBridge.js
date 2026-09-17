const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const { Client } = require('basic-ftp');

const MAX_RESULTS_BYTES = 8 * 1024 * 1024;

function normalizeRemotePath(value, name = 'remote path') {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || /[\x00-\x1f\x7f]/.test(normalized) || /^[a-z]:/i.test(normalized)) {
    throw new Error(`${name} must be a valid FTP path, not a local Windows path`);
  }
  if (normalized.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`${name} cannot contain current- or parent-directory segments`);
  }
  return normalized;
}

function getConfig() {
  const protocol = String(process.env.GAME_FILE_PROTOCOL || 'ftp').trim().toLowerCase();
  if (protocol !== 'ftp') {
    throw new Error('The isolated automation service currently supports GAME_FILE_PROTOCOL=ftp only');
  }

  const port = Number(process.env.SFTP_PORT || 21);
  const missing = [];
  if (!process.env.SFTP_HOST) missing.push('SFTP_HOST');
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('SFTP_PORT');
  if (!process.env.SFTP_USER) missing.push('SFTP_USER');
  if (!process.env.SFTP_PASSWORD) missing.push('SFTP_PASSWORD');
  if (!process.env.SFTP_BASE_PATH?.trim()) missing.push('SFTP_BASE_PATH');
  if (missing.length) throw new Error(`FTP bridge is not configured: ${missing.join(', ')}`);

  return {
    host: process.env.SFTP_HOST,
    port,
    user: process.env.SFTP_USER,
    password: process.env.SFTP_PASSWORD,
    secure: String(process.env.FTP_SECURE || '').toLowerCase() === 'true',
  };
}

function getUe4ssRemotePath() {
  const base = normalizeRemotePath(process.env.SFTP_BASE_PATH, 'SFTP_BASE_PATH').replace(/^\/+|\/+$/g, '');
  return `${base ? `/${base}` : ''}/TheIsle/Binaries/Win64/ue4ss`;
}

function getCommandBridgePaths() {
  const configured = normalizeRemotePath(
    process.env.COMMAND_BRIDGE_SAVED_PATH || 'Mods/CommandBridge/Saved',
    'COMMAND_BRIDGE_SAVED_PATH'
  ).replace(/\/$/, '');
  if (/^(ue4ss|TheIsle)\//i.test(configured)) {
    throw new Error('COMMAND_BRIDGE_SAVED_PATH must be relative to ue4ss or an absolute FTP path');
  }
  const saved = configured.startsWith('/') ? configured : `${getUe4ssRemotePath()}/${configured}`;
  return {
    saved,
    commands: `${saved}/commands.ndjson`,
    results: `${saved}/results.ndjson`,
  };
}

function bufferWritable() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  stream.toBuffer = () => Buffer.concat(chunks);
  return stream;
}

function isMissingFtpError(error) {
  const code = Number(error?.code);
  return (code === 450 || code === 550) && /no such file|not found|does not exist/i.test(String(error?.message || ''));
}

async function exists(client, remotePath) {
  try {
    await client.size(remotePath);
    return true;
  } catch (error) {
    if (isMissingFtpError(error)) return false;
    throw error;
  }
}

async function cdRobust(client, directory) {
  try {
    await client.cd(directory);
    return;
  } catch (absoluteError) {
    await client.cd('/');
    try {
      for (const segment of directory.split('/').filter(Boolean)) await client.cd(segment);
    } catch (relativeError) {
      relativeError.message = `${relativeError.message} (absolute CWD also failed: ${absoluteError.message})`;
      throw relativeError;
    }
  }
}

async function publishAtomic(client, remotePath, buffer) {
  const normalized = normalizeRemotePath(remotePath, 'CommandBridge queue path');
  const slash = normalized.lastIndexOf('/');
  if (slash <= 0 || slash === normalized.length - 1) throw new Error('Invalid CommandBridge queue path');

  const directory = normalized.slice(0, slash);
  const fileName = normalized.slice(slash + 1);
  const tempName = `${fileName}.upload-${crypto.randomUUID()}`;
  let tempMayExist = false;

  await cdRobust(client, directory);
  try {
    if (await exists(client, fileName)) {
      throw new Error(`CommandBridge queue is busy at ${remotePath}; refusing to overwrite an unconsumed command`);
    }
    tempMayExist = true;
    await client.uploadFrom(Readable.from([buffer]), tempName);
    if (await exists(client, fileName)) {
      throw new Error(`CommandBridge queue appeared while staging ${remotePath}; refusing to overwrite it`);
    }
    await client.rename(tempName, fileName);
    tempMayExist = false;
  } finally {
    if (tempMayExist) await client.remove(tempName).catch(() => {});
    await client.cd('/').catch(() => {});
  }
}

async function withClient(callback) {
  const config = getConfig();
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      secure: config.secure,
      secureOptions: config.secure ? { rejectUnauthorized: false } : undefined,
    });
    return await callback(client);
  } finally {
    client.close();
  }
}

async function publishCommandLine(line) {
  const paths = getCommandBridgePaths();
  await withClient((client) => publishAtomic(client, paths.commands, Buffer.from(`${line}\n`, 'utf8')));
  return paths;
}

async function readResultsText() {
  const paths = getCommandBridgePaths();
  return withClient(async (client) => {
    if (!await exists(client, paths.results)) return '';
    const size = await client.size(paths.results);
    if (size > MAX_RESULTS_BYTES) throw new Error('CommandBridge results exceed 8 MiB; rotate the results log before continuing');
    const writable = bufferWritable();
    await client.downloadTo(writable, paths.results);
    const buffer = writable.toBuffer();
    if (buffer.length > MAX_RESULTS_BYTES) throw new Error('CommandBridge results exceed 8 MiB');
    return buffer.toString('utf8');
  });
}

module.exports = {
  getConfig,
  getUe4ssRemotePath,
  getCommandBridgePaths,
  normalizeRemotePath,
  isMissingFtpError,
  bufferWritable,
  withClient,
  publishCommandLine,
  readResultsText,
};
