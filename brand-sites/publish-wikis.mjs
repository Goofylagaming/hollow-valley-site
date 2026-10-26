import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guide HTML/CSS/JS are pinned snapshots generated from the Primalbound guide docs.
// Never write into the game app or its save storage.
const src = fileURLToPath(new URL('./wiki-source/', import.meta.url));
const out = fileURLToPath(new URL('./dist/primalbound/', import.meta.url));
const production = process.argv.includes('--production');
for (const item of [
  'web/wiki/index.html', 'world/wiki/index.html',
  'assets/wiki.css', 'assets/wiki.js'
]) {
  let contents = await readFile(join(src, item), 'utf8');
  if (!production && item.endsWith('index.html')) {
    if (!contents.includes('</head>')) throw new Error('Invalid wiki document: ' + item);
    contents = contents.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>');
  }
  const target = join(out, item);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}
console.log('Published complete Web and World guide snapshots into the Primalbound site.');
