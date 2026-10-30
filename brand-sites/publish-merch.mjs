import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const source = new URL('./merch/', import.meta.url);
const output = new URL('./dist/hollow-valley/merch/', import.meta.url);
const production = process.argv.includes('--production');
await mkdir(output, { recursive: true });
let html = await readFile(new URL('index.html', source), 'utf8');
html = html.replace('href="./styles.css"', 'href="/merch/styles.css"')
  .replace('src="./app.js"', 'src="/merch/app.js"');
if (!production) {
  html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="robots" content="noindex,nofollow">');
  html = html.replace('<div class="announcement">',
    '<div class="announcement"><span class="sr-only">Staging preview.</span>');
}
await writeFile(new URL('index.html', output), html, 'utf8');
await copyFile(new URL('styles.css', source), new URL('styles.css', output));
await copyFile(new URL('app.js', source), new URL('app.js', output));
await mkdir(new URL('assets/', output),{recursive:true});
await copyFile(new URL('assets/chromie-hoodie-front-back.webp',source),new URL('assets/chromie-hoodie-front-back.webp',output));
console.log('Published '+(production ? 'production-ready' : 'noindex staging')+' merch preview assets.');
