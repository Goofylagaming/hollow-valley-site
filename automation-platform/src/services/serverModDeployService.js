const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fileBridge = require('../adapters/fileBridge');

const CONFIRM_PHRASE = 'DEPLOY SERVER MODS';

const APPROVED_MODS = Object.freeze([
  {
    id: 'skin-studio',
    name: 'SkinStudio',
    source: path.resolve(__dirname, '..', '..', '..', 'server-mods', 'SkinStudio', 'Scripts', 'main.lua'),
    relativeRemote: 'Mods/SkinStudio/Scripts/main.lua',
  },
  {
    id: 'command-bridge',
    name: 'CommandBridge',
    source: path.resolve(__dirname, '..', '..', '..', 'server-mods', 'CommandBridge', 'Scripts', 'main.lua'),
    relativeRemote: 'Mods/CommandBridge/Scripts/main.lua',
  },
]);

function deployEnabled() {
  return String(process.env.SERVER_MOD_DEPLOY_ENABLED || '').trim().toLowerCase() === 'true';
}

function parseModVersion(content, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^--\\s*' + escaped + '\\s+([^\\r\\n]+)', 'mi').exec(String(content || ''));
  return match ? match[1].trim() : null;
}

function readApprovedMod(mod) {
  const content = fs.readFileSync(mod.source);
  const text = content.toString('utf8');
  const version = parseModVersion(text, mod.name);
  if (!version) throw new Error(`Approved server mod ${mod.name} is missing its version header`);
  return {
    ...mod,
    bytes: content.length,
    version,
    content,
  };
}

function remotePathFor(mod) {
  return `${fileBridge.getUe4ssRemotePath()}/${mod.relativeRemote}`;
}

async function remoteFileExists(client, fileName) {
  try {
    await client.size(fileName);
    return true;
  } catch (error) {
    if (fileBridge.isMissingFtpError(error)) return false;
    throw error;
  }
}

async function downloadCurrentFile(client, fileName) {
  if (!await remoteFileExists(client, fileName)) return null;
  const writable = fileBridge.bufferWritable();
  await client.downloadTo(writable, fileName);
  return writable.toBuffer();
}

async function inspectRemoteMod(client, local) {
  const remotePath = remotePathFor(local);
  const slash = remotePath.lastIndexOf('/');
  const directory = remotePath.slice(0, slash);
  const fileName = remotePath.slice(slash + 1);

  try {
    await client.cd(directory);
  } catch (error) {
    if (fileBridge.isMissingFtpError(error) || Number(error?.code) === 550) {
      await client.cd('/').catch(() => {});
      return {
        id: local.id,
        name: local.name,
        localVersion: local.version,
        localBytes: local.bytes,
        remotePath,
        installed: false,
        remoteVersion: null,
        remoteBytes: 0,
        current: false,
      };
    }
    throw error;
  }

  try {
    const current = await downloadCurrentFile(client, fileName);
    if (!current) {
      return {
        id: local.id,
        name: local.name,
        localVersion: local.version,
        localBytes: local.bytes,
        remotePath,
        installed: false,
        remoteVersion: null,
        remoteBytes: 0,
        current: false,
      };
    }
    const remoteVersion = parseModVersion(current.toString('utf8'), local.name);
    return {
      id: local.id,
      name: local.name,
      localVersion: local.version,
      localBytes: local.bytes,
      remotePath,
      installed: true,
      remoteVersion,
      remoteBytes: current.length,
      current: remoteVersion === local.version && current.equals(local.content),
    };
  } finally {
    await client.cd('/').catch(() => {});
  }
}

async function getServerModDeployState({ inspectRemote = true } = {}) {
  const local = APPROVED_MODS.map(readApprovedMod);
  let ftpConfigured = true;
  let ftpError = null;

  try {
    fileBridge.getConfig();
  } catch (error) {
    ftpConfigured = false;
    ftpError = error.message;
  }

  let ue4ssRemotePath = null;
  if (ftpConfigured) {
    try {
      ue4ssRemotePath = fileBridge.getUe4ssRemotePath();
    } catch (error) {
      ftpConfigured = false;
      ftpError = error.message;
    }
  }

  const base = {
    enabled: deployEnabled(),
    ftpConfigured,
    ftpError,
    confirmationPhrase: CONFIRM_PHRASE,
    preservesSavedFolders: true,
    approvedOnly: true,
    mods: local.map((mod) => ({
      id: mod.id,
      name: mod.name,
      localVersion: mod.version,
      localBytes: mod.bytes,
      remotePath: ue4ssRemotePath ? `${ue4ssRemotePath}/${mod.relativeRemote}` : null,
      installed: null,
      remoteVersion: null,
      remoteBytes: null,
      current: null,
    })),
  };

  if (!inspectRemote || !ftpConfigured) return base;

  try {
    const mods = await fileBridge.withClient(async (client) => {
      const results = [];
      for (const mod of local) results.push(await inspectRemoteMod(client, mod));
      return results;
    });
    return { ...base, connected: true, mods };
  } catch (error) {
    return { ...base, connected: false, ftpError: error.message };
  }
}

async function deployOne(client, local) {
  const remotePath = remotePathFor(local);
  const slash = remotePath.lastIndexOf('/');
  const directory = remotePath.slice(0, slash);
  const fileName = remotePath.slice(slash + 1);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tempName = `.${fileName}.deploy-${suffix}`;
  const backupName = `${fileName}.backup-${suffix}`;
  let backupCreated = false;
  let tempExists = false;

  await client.ensureDir(directory);
  try {
    await client.uploadFrom(Readable.from([local.content]), tempName);
    tempExists = true;
    const stagedSize = await client.size(tempName);
    if (Number(stagedSize) !== local.bytes) {
      throw new Error(`${local.name} staged upload size mismatch`);
    }

    const existing = await downloadCurrentFile(client, fileName);
    const previousVersion = existing ? parseModVersion(existing.toString('utf8'), local.name) : null;

    if (existing) {
      await client.rename(fileName, backupName);
      backupCreated = true;
    }

    try {
      await client.rename(tempName, fileName);
      tempExists = false;
      const finalSize = await client.size(fileName);
      if (Number(finalSize) !== local.bytes) {
        throw new Error(`${local.name} final upload size mismatch`);
      }
    } catch (error) {
      if (backupCreated) {
        await client.remove(fileName).catch(() => {});
        await client.rename(backupName, fileName).catch(() => {});
        backupCreated = false;
      }
      throw error;
    }

    return {
      id: local.id,
      name: local.name,
      version: local.version,
      bytes: local.bytes,
      remotePath,
      installedNew: !existing,
      previousVersion,
      backupPath: existing ? `${directory}/${backupName}` : null,
    };
  } finally {
    if (tempExists) await client.remove(tempName).catch(() => {});
    await client.cd('/').catch(() => {});
  }
}

async function deployApprovedServerMods({ confirmation }) {
  if (!deployEnabled()) {
    const error = new Error('Server mod deployment is locked. Set SERVER_MOD_DEPLOY_ENABLED=true on the automation service to enable it.');
    error.code = 'SERVER_MOD_DEPLOY_DISABLED';
    throw error;
  }
  if (String(confirmation || '').trim() !== CONFIRM_PHRASE) {
    const error = new Error(`Confirmation must exactly match: ${CONFIRM_PHRASE}`);
    error.code = 'SERVER_MOD_DEPLOY_CONFIRMATION_REQUIRED';
    throw error;
  }

  fileBridge.getConfig();
  const local = APPROVED_MODS.map(readApprovedMod);

  return fileBridge.withClient(async (client) => {
    const deployed = [];
    for (const mod of local) deployed.push(await deployOne(client, mod));
    return {
      ok: true,
      deployedAt: new Date().toISOString(),
      restartRequired: true,
      preservesSavedFolders: true,
      deployed,
    };
  });
}

module.exports = {
  APPROVED_MODS,
  CONFIRM_PHRASE,
  deployEnabled,
  parseModVersion,
  getServerModDeployState,
  deployApprovedServerMods,
};
