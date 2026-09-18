const fileBridge = require('../adapters/fileBridge');

const TEXT_EXTENSIONS = /\.(?:ini|cfg|conf|json|toml|yaml|yml|lua|txt)$/i;
const KEYWORDS = /(?:slot|limit|max|storage|stored|dino)/i;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DEPTH = 3;
const MAX_FILES = 80;

async function readTextFile(client, fileName, size) {
  if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) return null;
  const sink = fileBridge.bufferWritable();
  await client.downloadTo(sink, fileName);
  const buffer = sink.toBuffer();
  if (buffer.length > MAX_FILE_BYTES) return null;
  return buffer.toString('utf8');
}

async function probeDinoStorageConfig() {
  const root = `${fileBridge.getUe4ssRemotePath()}/Mods/DinoStorage`;
  const findings = [];
  let scannedFiles = 0;

  await fileBridge.withClient(async (client) => {
    async function walk(directory, depth) {
      if (depth > MAX_DEPTH || scannedFiles >= MAX_FILES) return;
      let entries;
      try {
        await client.cd(directory);
        entries = await client.list();
      } catch (error) {
        findings.push({ path: directory, error: String(error?.code || error?.name || 'unavailable') });
        return;
      }

      for (const entry of entries) {
        if (scannedFiles >= MAX_FILES) break;
        const fullPath = `${directory}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile || !TEXT_EXTENSIONS.test(entry.name)) continue;
        scannedFiles += 1;
        let text;
        try {
          await client.cd(directory);
          text = await readTextFile(client, entry.name, Number(entry.size));
        } catch (error) {
          findings.push({ path: fullPath, error: String(error?.code || error?.name || 'read_failed') });
          continue;
        }
        if (text === null) continue;
        const matches = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && KEYWORDS.test(line))
          .slice(0, 30);
        if (matches.length) findings.push({ path: fullPath, matches });
      }
    }

    await walk(root, 0);
  });

  console.log(`[dinostorage-config-probe] scannedFiles=${scannedFiles}`);
  if (!findings.length) {
    console.log('[dinostorage-config-probe] findings=none');
    return;
  }
  for (const finding of findings) {
    if (finding.error) {
      console.log(`[dinostorage-config-probe] path=${finding.path} error=${finding.error}`);
      continue;
    }
    console.log(`[dinostorage-config-probe] path=${finding.path}`);
    for (const line of finding.matches) console.log(`[dinostorage-config-probe] ${line.slice(0, 300)}`);
  }
}

module.exports = { probeDinoStorageConfig };
